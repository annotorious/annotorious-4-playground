import type Map from 'ol/Map.js';
import {
  createAnnotatorState,
  createBaseAnnotator,
  createLifecycleObserver,
  createUndoStack
} from '@annotorious/core';
import type {
  AnnotationState,
  DrawingStyleExpression,
  Filter,
  FormatAdapter,
  User,
  UserSelectActionExpression
} from '@annotorious/core';
import { createDraftStore, createImageIndexes, listTools, toRenderStyle } from '@annotorious/core-spatial';
import type { DrawingMode, SnappingProvider, SpatialAnnotation, SpatialAnnotationTarget, SpatialAnnotator } from '@annotorious/core-spatial';
import { createDeckOverlay } from './deck-overlay';
import { createEditorOverlay } from './editor-overlay';
import { createImageRegistry } from './image-registry';
import type { ImageRegistry } from './image-registry';
import { createPointerHandling } from './pointer';

export interface OpenLayersAnnotatorOpts<E = SpatialAnnotation> {

  adapter?: FormatAdapter<SpatialAnnotation, E>;

  /** @default 'drag' **/
  drawingMode?: DrawingMode;

  initialUser?: User;

  multiSelect?: boolean;

  snapping?: SnappingProvider;

  userSelectAction?: UserSelectActionExpression<E>;

  /**
   * The annotatable image's pixel dimensions - required rather than
   * inferred from the map's view/projection, so construction doesn't
   * silently assume the caller configured the view to this package's
   * coordinate contract (see `projection.ts`) via some other means we can't
   * verify. `ol/source/IIIF` satisfies the contract by default; anything
   * else should be built via `createImageProjection(width, height)`.
   */
  width: number;

  height: number;

}

export interface OpenLayersAnnotator<E = SpatialAnnotation> extends SpatialAnnotator<E> {

  map: Map;

  cancelDrawing(): void;

  getDrawingTool(): string | undefined;

  /**
   * Resolves which registered image a target belongs to (and its current
   * viewer placement) - `imageRegistry.get(target.source)` paired with
   * `getEditorTransform(map, image)` (from `./coordinates`) is what a
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

export const createOLAnnotator = <E = SpatialAnnotation>(
  map: Map,
  opts: OpenLayersAnnotatorOpts<E>
): OpenLayersAnnotator<E> => {

  const state = createAnnotatorState<SpatialAnnotation, E>({
    ...(opts.adapter ? { adapter: opts.adapter } : {}),
    ...(opts.userSelectAction ? { userSelectAction: opts.userSelectAction } : {})
  });

  const { hover, selection, store } = state;

  const undoStack = createUndoStack(store);
  const lifecycle = createLifecycleObserver<SpatialAnnotation, E>(state, undoStack, opts.adapter);

  const imageRegistry = createImageRegistry({ width: opts.width, height: opts.height });
  const imageIndexes = createImageIndexes(store);

  // This session's own in-progress drawing (and, in a collaborative setup,
  // other authors' too) - see draft-store.ts. Shared between pointer
  // handling (writes the local entry as the shape develops) and the deck
  // overlay (renders whatever's currently in it).
  const draftStore = createDraftStore<SpatialAnnotationTarget>();

  // Populate the index for the (only) registered image, from whatever's
  // already in the store.
  imageRegistry.all().forEach(({ source }) => imageIndexes.rebuild(source));

  let currentStyle: DrawingStyleExpression<SpatialAnnotation> | undefined;
  let currentFilter: Filter<SpatialAnnotation> | undefined;

  // `state` is passed in explicitly by the render loop - always `{}` for
  // the base (non-highlighted) layer, always the real, live state for the
  // highlight layer - rather than read independently from `selection`/
  // `hover` here. The base layer is rebuilt at unpredictable times (a
  // debounced viewport-settle, a data change), so if this read live state
  // itself, whatever happened to be selected/hovered at that arbitrary
  // moment would get baked into the base layer permanently, until some
  // later, unrelated rebuild happened to overwrite it - visible as a
  // shape's hover/selected styling getting stuck (see render-loop.ts).
  const getStyle = (target: SpatialAnnotationTarget, state: AnnotationState) => {
    if (!currentStyle) return undefined;

    const annotation = store.getAnnotation(target.annotation);
    if (!annotation) return undefined;

    const computed = typeof currentStyle === 'function'
      ? currentStyle(annotation, state)
      : currentStyle;

    return computed ? toRenderStyle(computed) : undefined;
  }

  const getFilter = () => currentFilter;

  const deckOverlay = createDeckOverlay(map, store, imageRegistry, imageIndexes, draftStore, state.viewport, {
    getStyle,
    getFilter
  });

  // Selection/hover are their own state slices, separate from the store -
  // a style callback that reads `state.selected`/`state.hovered` (see
  // getStyle above) needs the render layer refreshed whenever either
  // changes, or the shape keeps showing whatever style was last computed
  // before the change (e.g. still unselected-colored right after being
  // selected). Routed through `setSelected`/`setHovered`, not `render()` -
  // and deliberately kept as two separate calls, not merged into one
  // combined state map the way they used to be: hover fires on every
  // mousemove crossing a shape boundary, far more often than a selection
  // click, and `setHovered` takes a dedicated, much cheaper path through
  // deck.gl's own `highlightedObjectIndex` instead of a row rebuild - see
  // render-loop.ts's module doc for the full story (measured ~40fps ->
  // ~57-59fps at 100k polygons from this split alone).
  const unsubscribeSelection = selection.subscribe(() => deckOverlay.setSelected(selection.selected.map(s => s.id)));
  const unsubscribeHover = hover.subscribe(id => deckOverlay.setHovered(id));

  const pointerHandling = createPointerHandling(map, state, imageRegistry, imageIndexes, draftStore, {
    ...(opts.multiSelect !== undefined ? { multiSelect: opts.multiSelect } : {}),
    ...(opts.drawingMode ? { drawingMode: opts.drawingMode } : {}),
    getFilter,
    onHint: (hints, source) => deckOverlay.setHints(hints, imageRegistry.get(source)),
    onClickAnnotation: (annotation, event) => lifecycle.emit('clickAnnotation', annotation, event)
  });

  const editorOverlay = createEditorOverlay(map, state, imageRegistry, {
    ...(opts.snapping ? { snapping: opts.snapping } : {})
  });

  const base = createBaseAnnotator<SpatialAnnotation, E>(state, undoStack, opts.adapter, opts.initialUser);

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
    map,
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
