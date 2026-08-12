import type OpenSeadragon from 'openseadragon';
import { getTool } from '@annotorious/core-spatial';
import type { DraftStore, DrawingTool, SpatialAnnotation, SpatialAnnotationTarget, SpatialShape, ToolContext, ToolHint } from '@annotorious/core-spatial';
import type { AnnotatorState, Filter } from '@annotorious/core';
import { createImageTransforms, screenPixelsToLocalUnits } from './coordinates';
import { draftAnnotationId, LOCAL_AUTHOR_ID } from './draft';
import { eventToWorld, getRenderViewport } from './viewport';
import type { ImageIndexes } from './image-indexes';
import type { ImageRegistry } from './image-registry';

const HIT_BUFFER_PX = 4;

export interface PointerHandlingOptions {

  multiSelect?: boolean;

  /**
   * Called whenever the drawing tool's local hint set changes (or is
   * cleared), together with the `source` id of the image being drawn on -
   * lets the host render them (see `deck-overlay.ts`'s `setHints`). Purely
   * local UX, deliberately not routed through `DraftStore` - see
   * `tool-hint.ts`.
   */
  onHint?: (hints: ToolHint[], source: string | undefined) => void;

  /** Read fresh on every hit-test - lets `setFilter` take effect without recreating pointer handling. **/
  getFilter?: () => Filter<SpatialAnnotation> | undefined;

}

// Generic over E (the external/adapted representation) purely so this
// accepts whatever AnnotatorState<SpatialAnnotation, E> the caller has -
// none of the logic here ever touches E, it only works with the internal
// SpatialAnnotation representation (store, selection, hover).
export const createPointerHandling = <E>(
  viewer: OpenSeadragon.Viewer,
  state: AnnotatorState<SpatialAnnotation, E>,
  imageRegistry: ImageRegistry,
  imageIndexes: ImageIndexes,
  draftStore: DraftStore<SpatialAnnotationTarget>,
  opts: PointerHandlingOptions = {}
) => {
  const { store, selection, hover } = state;

  let drawingEnabled = false;
  let currentToolName: string | undefined;
  let activeTool: DrawingTool | undefined;

  const hitTestAt = (worldPoint: OpenSeadragon.Point): SpatialAnnotationTarget | undefined => {
    const registered = imageRegistry.getImageAt(worldPoint);
    if (!registered) return undefined;

    const index = imageIndexes.get(registered.source);
    if (!index) return undefined;

    const local = registered.tiledImage.viewportToImageCoordinates(worldPoint, true);
    const resolution = getRenderViewport(viewer).resolution;
    const buffer = screenPixelsToLocalUnits(resolution, registered.tiledImage, HIT_BUFFER_PX);

    const hits = index.getAt(local.x, local.y, buffer);
    const filter = opts.getFilter?.();
    if (!filter) return hits[0];

    return hits.find(hit => {
      const annotation = store.getAnnotation(hit.annotation);
      return annotation && filter(annotation);
    });
  }

  const endDrawingSession = () => {
    activeTool?.destroy();
    activeTool = undefined;
    viewer.setMouseNavEnabled(true);
    draftStore.set(LOCAL_AUTHOR_ID, undefined);
    opts.onHint?.([], undefined);
  }

  const startDrawing = (event: PointerEvent) => {
    if (!currentToolName) return;

    const factory = getTool(currentToolName);
    if (!factory) {
      console.warn(`No drawing tool registered: "${currentToolName}"`);
      return;
    }

    const world = eventToWorld(viewer, event);
    const registered = imageRegistry.getImageAt(world);
    if (!registered) return; // pointer isn't over any image - nothing to draw on

    const { source, tiledImage } = registered;
    // Tools never render their own screen-space overlay (they report shapes
    // via onChange/onComplete and the host renders the preview through
    // DeckGL, in world space) - only toLocalCoordinates is needed here.
    const { toLocalCoordinates } = createImageTransforms(viewer, tiledImage);

    viewer.setMouseNavEnabled(false);

    const ctx: ToolContext<SpatialShape> = {
      toLocalCoordinates,
      onChange: (shape: SpatialShape | undefined) => {
        draftStore.set(LOCAL_AUTHOR_ID, shape
          ? { annotation: draftAnnotationId(LOCAL_AUTHOR_ID), selector: shape, ...(source ? { source } : {}) }
          : undefined);
      },
      onComplete: (shape: SpatialShape) => {
        const id = crypto.randomUUID();
        const target: SpatialAnnotationTarget = { annotation: id, selector: shape, ...(source ? { source } : {}) };
        store.addAnnotation({ id, bodies: [], target });
        endDrawingSession();
      },
      onHint: (hints: ToolHint[]) => opts.onHint?.(hints, source)
    };

    activeTool = factory(ctx);
    activeTool.onPointerDown(event);
  }

  const onPointerMove = (event: PointerEvent) => {
    if (activeTool) {
      activeTool.onPointerMove(event);
      return;
    }

    if (drawingEnabled) return;

    const hit = hitTestAt(eventToWorld(viewer, event));
    hover.set(hit ? hit.annotation : null);
  }

  // Select/deselect is decided on pointerup, not pointerdown - a pointerdown
  // on empty space is also how a pan gesture starts, and we don't know
  // which one it is until we see whether the pointer actually moved.
  const CLICK_THRESHOLD_PX = 5;
  let pointerDownAt: { x: number, y: number } | undefined;

  const onPointerDown = (event: PointerEvent) => {
    if (drawingEnabled) {
      if (activeTool) {
        activeTool.onPointerDown(event);
      } else {
        startDrawing(event);
      }
      return;
    }

    pointerDownAt = { x: event.clientX, y: event.clientY };
  }

  const onPointerUp = (event: PointerEvent) => {
    if (activeTool) {
      activeTool.onPointerUp(event);
      return;
    }

    if (!pointerDownAt) return;

    const moved = Math.hypot(event.clientX - pointerDownAt.x, event.clientY - pointerDownAt.y);
    pointerDownAt = undefined;
    if (moved > CLICK_THRESHOLD_PX) return; // a pan/drag, not a click

    const hit = hitTestAt(eventToWorld(viewer, event));
    const hasModifier = event.shiftKey || event.metaKey || event.ctrlKey;

    if (hit) {
      const nextIds = opts.multiSelect && hasModifier
        ? [...selection.selected.map(s => s.id), hit.annotation]
        : [hit.annotation];

      selection.userSelect(nextIds.length === 1 ? nextIds[0]! : nextIds, event);
    } else if (!selection.isEmpty() && (!opts.multiSelect || !hasModifier)) {
      selection.userSelect([], event);
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    activeTool?.onKeyDown?.(event);
  }

  viewer.element.addEventListener('pointermove', onPointerMove);
  viewer.element.addEventListener('pointerdown', onPointerDown);
  viewer.element.addEventListener('pointerup', onPointerUp);
  viewer.element.addEventListener('keydown', onKeyDown);

  const setDrawingEnabled = (enabled: boolean) => {
    drawingEnabled = enabled;
    if (!enabled && activeTool) endDrawingSession();
  }

  const setDrawingTool = (name: string) => {
    if (activeTool) endDrawingSession();
    currentToolName = name;
  }

  const cancelDrawing = () => {
    if (activeTool) endDrawingSession();
  }

  const isDrawingEnabled = () => drawingEnabled;

  const getDrawingTool = () => currentToolName;

  const destroy = () => {
    if (activeTool) endDrawingSession();
    viewer.element.removeEventListener('pointermove', onPointerMove);
    viewer.element.removeEventListener('pointerdown', onPointerDown);
    viewer.element.removeEventListener('pointerup', onPointerUp);
    viewer.element.removeEventListener('keydown', onKeyDown);
  }

  return { cancelDrawing, destroy, getDrawingTool, isDrawingEnabled, setDrawingEnabled, setDrawingTool };

}
