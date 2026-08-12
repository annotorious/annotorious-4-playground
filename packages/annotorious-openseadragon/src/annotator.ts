import type OpenSeadragon from 'openseadragon';
import {
  createAnnotatorState,
  createBaseAnnotator,
  createLifecycleObserver,
  createUndoStack
} from '@annotorious/core';
import type {
  DrawingStyleExpression,
  Filter,
  FormatAdapter,
  User,
  UserSelectActionExpression
} from '@annotorious/core';
import { createDraftStore, createImageIndexes, listTools, toRenderStyle } from '@annotorious/core-spatial';
import type { DrawingMode, LODOptions, SnappingProvider, SpatialAnnotation, SpatialAnnotationTarget, SpatialAnnotator } from '@annotorious/core-spatial';
import { createDeckOverlay } from './deck-overlay';
import { createEditorOverlay } from './editor-overlay';
import { createImageRegistry } from './image-registry';
import type { ImageRegistry } from './image-registry';
import { createPointerHandling } from './pointer';

export interface OpenSeadragonAnnotatorOpts<E = SpatialAnnotation> {

  adapter?: FormatAdapter<SpatialAnnotation, E>;

  /** @default 'drag' **/
  drawingMode?: DrawingMode;

  initialUser?: User;

  lod?: LODOptions;

  multiSelect?: boolean;

  snapping?: SnappingProvider;

  userSelectAction?: UserSelectActionExpression<E>;

}

export interface OpenSeadragonAnnotator<E = SpatialAnnotation> extends SpatialAnnotator<E> {

  viewer: OpenSeadragon.Viewer;

  /**
   * Adds an image to the OSD world under the given `source` id - annotations
   * on this image will carry `target.source === source`. Only needed for a
   * genuine multi-image world; a single image opened the normal OSD way
   * (`viewer.open(...)`/`tileSources`) needs no `source` at all.
   */
  addImage(tileSource: unknown, source: string, addOpts?: Record<string, unknown>): Promise<void>;

  cancelDrawing(): void;

  getDrawingTool(): string | undefined;

  /**
   * Resolves which registered image a target belongs to (and its current
   * viewer placement) - `imageRegistry.get(target.source)` paired with
   * `getEditorTransform(viewer, image)` (from `./coordinates`) is what a
   * plugin needs to position its own per-annotation overlay (a label, a
   * tooltip, ...) the same way the built-in editor handles position
   * themselves. Exposed specifically for that - see the arrows-plugin-style
   * "mount a Solid layer on the viewer" pattern discussed for a labels
   * plugin.
   */
  imageRegistry: ImageRegistry;

  isDrawingEnabled(): boolean;

  listDrawingTools(): string[];

  setDrawingEnabled(enabled: boolean): void;

  setDrawingMode(mode: DrawingMode): void;

  setDrawingTool(name: string): void;

  setVisible(visible: boolean): void;

}

export const createOSDAnnotator = <E = SpatialAnnotation>(
  viewer: OpenSeadragon.Viewer,
  opts: OpenSeadragonAnnotatorOpts<E> = {}
): OpenSeadragonAnnotator<E> => {

  const state = createAnnotatorState<SpatialAnnotation, E>({
    ...(opts.adapter ? { adapter: opts.adapter } : {}),
    ...(opts.userSelectAction ? { userSelectAction: opts.userSelectAction } : {})
  });

  const { hover, selection, store } = state;

  const undoStack = createUndoStack(store);
  const lifecycle = createLifecycleObserver<SpatialAnnotation, E>(state, undoStack, opts.adapter);

  const imageRegistry = createImageRegistry(viewer);
  const imageIndexes = createImageIndexes(store);

  // This session's own in-progress drawing (and, in a collaborative setup,
  // other authors' too) - see draft-store.ts. Shared between pointer
  // handling (writes the local entry as the shape develops) and the deck
  // overlay (renders whatever's currently in it).
  const draftStore = createDraftStore<SpatialAnnotationTarget>();

  // Populate indexes for whatever's already in the world - the common
  // single-image case (opened via `tileSources`) needs no further setup.
  imageRegistry.all().forEach(({ source }) => imageIndexes.rebuild(source));

  let currentStyle: DrawingStyleExpression<SpatialAnnotation> | undefined;
  let currentFilter: Filter<SpatialAnnotation> | undefined;

  const getStyle = (target: SpatialAnnotationTarget) => {
    if (!currentStyle) return undefined;

    const annotation = store.getAnnotation(target.annotation);
    if (!annotation) return undefined;

    const computed = typeof currentStyle === 'function'
      ? currentStyle(annotation, { selected: selection.isSelected(annotation.id), hovered: hover.current === annotation.id })
      : currentStyle;

    return computed ? toRenderStyle(computed) : undefined;
  }

  const getFilter = () => currentFilter;

  const deckOverlay = createDeckOverlay(viewer, store, imageRegistry, imageIndexes, draftStore, state.viewport, {
    getStyle,
    getFilter,
    ...(opts.lod ? { lod: opts.lod } : {})
  });

  // Selection/hover are their own state slices, separate from the store -
  // a style callback that reads `state.selected`/`state.hovered` (see
  // getStyle above) needs a fresh render whenever either changes, or the
  // shape keeps showing whatever style was last computed before the change
  // (e.g. still unselected-colored right after being selected).
  const unsubscribeSelection = selection.subscribe(() => deckOverlay.render());
  const unsubscribeHover = hover.subscribe(() => deckOverlay.render());

  const pointerHandling = createPointerHandling(viewer, state, imageRegistry, imageIndexes, draftStore, {
    ...(opts.multiSelect !== undefined ? { multiSelect: opts.multiSelect } : {}),
    ...(opts.drawingMode ? { drawingMode: opts.drawingMode } : {}),
    getFilter,
    onHint: (hints, source) => deckOverlay.setHints(hints, imageRegistry.get(source)),
    onClickAnnotation: (annotation, event) => lifecycle.emit('clickAnnotation', annotation, event)
  });

  const editorOverlay = createEditorOverlay(viewer, state, imageRegistry, {
    ...(opts.snapping ? { snapping: opts.snapping } : {})
  });

  const base = createBaseAnnotator<SpatialAnnotation, E>(state, undoStack, opts.adapter, opts.initialUser);

  const addImage = (tileSource: unknown, source: string, addOpts: Record<string, unknown> = {}): Promise<void> =>
    new Promise((resolve, reject) => {
      (viewer as unknown as { addTiledImage: (opts: Record<string, unknown>) => void }).addTiledImage({
        ...addOpts,
        tileSource,
        success: (event: { item: OpenSeadragon.TiledImage }) => {
          imageRegistry.register(event.item, source);
          imageIndexes.rebuild(source);
          deckOverlay.refresh();
          resolve();
        },
        error: (error: unknown) => reject(error)
      });
    });

  const setFilter = (filter: Filter<SpatialAnnotation> | undefined) => {
    currentFilter = filter;
    deckOverlay.render();
  }

  const setStyle = (style: DrawingStyleExpression<SpatialAnnotation> | undefined) => {
    currentStyle = style;
    deckOverlay.render();
  }

  const destroy = () => {
    unsubscribeSelection();
    unsubscribeHover();
    editorOverlay.destroy();
    pointerHandling.destroy();
    deckOverlay.destroy();
    imageRegistry.destroy();
    undoStack.destroy();
  }

  return {
    ...base,
    viewer,
    addImage,
    cancelDrawing: pointerHandling.cancelDrawing,
    destroy,
    draftStore,
    getDrawingTool: pointerHandling.getDrawingTool,
    imageRegistry,
    isDrawingEnabled: pointerHandling.isDrawingEnabled,
    listDrawingTools: listTools,
    on: lifecycle.on,
    off: lifecycle.off,
    setDrawingEnabled: pointerHandling.setDrawingEnabled,
    setDrawingMode: pointerHandling.setDrawingMode,
    setDrawingTool: pointerHandling.setDrawingTool,
    setFilter,
    setStyle,
    setVisible: deckOverlay.setVisible,
    state
  };

}
