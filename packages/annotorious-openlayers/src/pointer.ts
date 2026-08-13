import type Map from 'ol/Map.js';
import { draftAnnotationId, getTool, LOCAL_AUTHOR_ID } from '@annotorious/core-spatial';
import type { DraftStore, DrawingMode, DrawingTool, ImageIndexes, SpatialAnnotation, SpatialAnnotationTarget, SpatialShape, ToolContext, ToolHint } from '@annotorious/core-spatial';
import type { AnnotatorState, Filter } from '@annotorious/core';
import { createImageTransforms, screenPixelsToLocalUnits } from './coordinates';
import { eventToWorld, getRenderViewport } from './viewport';
import { resumeNavigation, suspendNavigation } from './navigation';
import type { ImageRegistry } from './image-registry';

const HIT_BUFFER_PX = 4;

export interface PointerHandlingOptions {

  multiSelect?: boolean;

  /** @default 'drag' **/
  drawingMode?: DrawingMode;

  /**
   * Called whenever the drawing tool's local hint set changes (or is
   * cleared), together with the `source` id of the image being drawn on -
   * lets the host render them (see `deck-overlay.ts`'s `setHints`). Purely
   * local UX, deliberately not routed through `DraftStore` - see
   * `tool-hint.ts`.
   */
  onHint?: (hints: ToolHint[], source: string | undefined) => void;

  /**
   * Called whenever the pointer goes down while hovering an annotation -
   * a raw "the user just clicked on this shape" signal, independent of
   * whether the click actually changes the selection (see the
   * `clickAnnotation` lifecycle event).
   */
  onClickAnnotation?: (annotation: SpatialAnnotation, event: PointerEvent) => void;

  /** Read fresh on every hit-test - lets `setFilter` take effect without recreating pointer handling. **/
  getFilter?: () => Filter<SpatialAnnotation> | undefined;

}

// Generic over E (the external/adapted representation) purely so this
// accepts whatever AnnotatorState<SpatialAnnotation, E> the caller has -
// none of the logic here ever touches E, it only works with the internal
// SpatialAnnotation representation (store, selection, hover).
export const createPointerHandling = <E>(
  map: Map,
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
  let drawingMode: DrawingMode = opts.drawingMode || 'drag';

  const hitTestAt = (worldPoint: [number, number]): SpatialAnnotationTarget | undefined => {
    const registered = imageRegistry.getImageAt(worldPoint);
    if (!registered) return undefined;

    const index = imageIndexes.get(registered.source);
    if (!index) return undefined;

    // world == local for single-image MVP (see coordinates.ts module doc).
    const [localX, localY] = worldPoint;
    const resolution = getRenderViewport(map).resolution;
    const buffer = screenPixelsToLocalUnits(resolution, registered, HIT_BUFFER_PX);

    const hits = index.getAt(localX, localY, buffer);
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
    resumeNavigation();
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

    const world = eventToWorld(map, event);
    const registered = imageRegistry.getImageAt(world);
    if (!registered) return; // pointer isn't over any image - nothing to draw on

    const { source } = registered;
    // Tools never render their own screen-space overlay (they report shapes
    // via onChange/onComplete and the host renders the preview through
    // DeckGL, in world space) - only toLocalCoordinates is needed here.
    const { toLocalCoordinates } = createImageTransforms(map, registered);

    suspendNavigation(map);

    const ctx: ToolContext<SpatialShape> = {
      toLocalCoordinates,
      drawingMode,
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

  // The last pointermove we saw - kept around so hover can be re-evaluated
  // when the *viewport* changes without the pointer itself moving (see
  // onPostRender below). Not just a screen position: eventToWorld needs
  // the original event.
  let lastPointerEvent: PointerEvent | undefined;

  const onPointerMove = (event: PointerEvent) => {
    if (activeTool) {
      activeTool.onPointerMove(event);
      return;
    }

    if (drawingEnabled) return;

    lastPointerEvent = event;

    // Hover is suspended while anything is selected (see the `selection`
    // guard below) OR while the pointer is held down at all, selected or
    // not: a click-drag with nothing selected pans/zooms the viewer,
    // sweeping the cursor across whatever shapes lie along the way - without
    // this, every one of those re-hit-tests and re-highlights, adding real
    // per-frame cost on top of the pan itself, and looking wrong even at
    // small scale (shapes flashing "hovered" as the cursor merely crosses
    // them mid-pan, not actually pointing at anything). Hover is cleared up
    // front in `onPointerDown`, not here, so it doesn't need re-checking on
    // every move for the whole gesture.
    if (!selection.isEmpty() || pointerDownAt) return;

    const hit = hitTestAt(eventToWorld(map, event));
    console.log("[DEBUG onPointerMove]", hit ? hit.annotation : null, "pointerDownAt:", pointerDownAt);
    hover.set(hit ? hit.annotation : null);
  }

  // Without this, hover gets stuck on whatever was last under the pointer:
  // `onPointerMove` only ever runs (and updates hover) while the pointer is
  // actually moving *inside* the viewport - it never fires again once the
  // pointer leaves, so a shape hovered right before the cursor exits the
  // map (or a drag/gesture elsewhere steals pointer capture) stays
  // "hovered" indefinitely.
  const onPointerLeave = () => {
    lastPointerEvent = undefined;
    hover.set(null);
  }

  // Re-evaluate hover whenever the *viewport* changes, not just on
  // pointermove: zooming (especially via mouse wheel) changes which shape
  // is under the pointer without the pointer's own screen position ever
  // moving, so pointermove alone never fires and hover is left showing
  // whatever was true before the zoom - re-hit-testing at the same last
  // known screen position (now mapped through the new viewport) is what
  // catches that. Hit-testing is a cheap, O(log n) spatial query - fine to
  // run on every viewport-change frame, unlike a full layer rebuild.
  const onPostRender = () => {
    if (!lastPointerEvent || activeTool || drawingEnabled || !selection.isEmpty() || pointerDownAt) return;
    const hit = hitTestAt(eventToWorld(map, lastPointerEvent));
    console.log("[DEBUG onPostRender]", hit ? hit.annotation : null, "pointerDownAt:", pointerDownAt);
    hover.set(hit ? hit.annotation : null);
  }

  // Hover tracking gets in the way while editing a selected annotation
  // (handles moving under the pointer constantly re-trigger hover, fighting
  // visually with the selected styling) - suspend it entirely whenever
  // there's an active selection, and clear anything it was showing right as
  // the selection is made rather than leaving it stuck on whatever was
  // hovered the instant before.
  const unsubscribeSelectionForHover = selection.subscribe(() => {
    if (!selection.isEmpty() && hover.current) hover.set(null);
  });

  // Select/deselect is decided on pointerup, not pointerdown - a pointerdown
  // on empty space is also how a pan gesture starts, and we don't know
  // which one it is until we see whether the pointer actually moved.
  const CLICK_THRESHOLD_PX = 5;
  let pointerDownAt: { x: number, y: number } | undefined;

  const onPointerDown = (event: PointerEvent) => {
    // Raw "clicked on this annotation" signal - fires regardless of drawing
    // state or whether the click ends up changing the selection, matching
    // v3's independent pointerdown-while-hovering listener.
    if (hover.current) {
      const hovered = store.getAnnotation(hover.current);
      if (hovered) opts.onClickAnnotation?.(hovered, event);
    }

    // Clear immediately, before it's known whether this turns into a click
    // or a drag/pan - `onPointerMove`/`onPostRender` stay suspended for as
    // long as `pointerDownAt` is set (see their own guards), so nothing sets
    // it again until the gesture ends and a fresh pointermove re-hits.
    hover.set(null);

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

    const hit = hitTestAt(eventToWorld(map, event));
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
    if (activeTool) {
      activeTool.onKeyDown?.(event);
      return;
    }

    // Escape to deselect - matters most exactly when there's no free canvas
    // space left to click to deselect (e.g. a dense field of annotations
    // covering the whole viewport).
    if (event.key === 'Escape' && !selection.isEmpty())
      selection.userSelect([], event);
  }

  const viewport = map.getViewport();
  viewport.addEventListener('pointermove', onPointerMove);
  viewport.addEventListener('pointerdown', onPointerDown);
  viewport.addEventListener('pointerup', onPointerUp);
  viewport.addEventListener('pointerleave', onPointerLeave);
  viewport.addEventListener('pointercancel', onPointerLeave);
  viewport.addEventListener('keydown', onKeyDown);
  map.on('postrender', onPostRender);

  const setDrawingEnabled = (enabled: boolean) => {
    drawingEnabled = enabled;
    // Drawing mode stops onPointerMove from updating hover at all (see
    // above) - clear it going in, rather than leaving it frozen on
    // whatever happened to be hovered the instant drawing was enabled.
    if (enabled) hover.set(null);
    if (!enabled && activeTool) endDrawingSession();
  }

  const setDrawingTool = (name: string) => {
    if (activeTool) endDrawingSession();
    currentToolName = name;
  }

  const setDrawingMode = (mode: DrawingMode) => {
    // A little defensive on the outside API, matching v3. Deliberately
    // doesn't cancel an in-progress shape (a tool reads `drawingMode` once,
    // at construction - see drawing-tool.ts) - so this takes effect on the
    // next shape, not by yanking away whatever's already half-drawn.
    drawingMode = mode || 'drag';
  }

  const cancelDrawing = () => {
    if (activeTool) endDrawingSession();
  }

  const isDrawingEnabled = () => drawingEnabled;

  const getDrawingTool = () => currentToolName;

  const destroy = () => {
    if (activeTool) endDrawingSession();
    viewport.removeEventListener('pointermove', onPointerMove);
    viewport.removeEventListener('pointerdown', onPointerDown);
    viewport.removeEventListener('pointerup', onPointerUp);
    viewport.removeEventListener('pointerleave', onPointerLeave);
    viewport.removeEventListener('pointercancel', onPointerLeave);
    viewport.removeEventListener('keydown', onKeyDown);
    map.un('postrender', onPostRender);
    unsubscribeSelectionForHover();
  }

  return { cancelDrawing, destroy, getDrawingTool, isDrawingEnabled, setDrawingEnabled, setDrawingMode, setDrawingTool };

}
