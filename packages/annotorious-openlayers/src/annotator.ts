import type Map from 'ol/Map.js';
import {
  createAnnotatorState,
  createBaseAnnotator,
  createLifecycleObserver,
  createUndoStack
} from '@annotorious/core';
import type {
  Annotator,
  DrawingStyleExpression,
  Filter,
  FormatAdapter,
  User,
  UserSelectActionExpression
} from '@annotorious/core';
import { createDraftStore, createImageIndexes, listTools, toRenderStyle } from '@annotorious/core-spatial';
import type { LODOptions, SnappingProvider, SpatialAnnotation, SpatialAnnotationTarget } from '@annotorious/core-spatial';
import { createDeckOverlay } from './deck-overlay';
import { createEditorOverlay } from './editor-overlay';
import { createImageRegistry } from './image-registry';
import { createPointerHandling } from './pointer';

export interface OpenLayersAnnotatorOpts<E = SpatialAnnotation> {

  adapter?: FormatAdapter<SpatialAnnotation, E>;

  autoSave?: boolean;

  initialUser?: User;

  lod?: LODOptions;

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

export interface OpenLayersAnnotator<E = SpatialAnnotation> extends Annotator<SpatialAnnotation, E> {

  map: Map;

  cancelDrawing(): void;

  getDrawingTool(): string | undefined;

  isDrawingEnabled(): boolean;

  listDrawingTools(): string[];

  setDrawingEnabled(enabled: boolean): void;

  setDrawingTool(name: string): void;

}

export const createOLAnnotator = <E = SpatialAnnotation>(
  map: Map,
  opts: OpenLayersAnnotatorOpts<E>
): OpenLayersAnnotator<E> => {

  const state = createAnnotatorState<SpatialAnnotation, E>({
    ...(opts.adapter ? { adapter: opts.adapter } : {}),
    ...(opts.userSelectAction ? { userSelectAction: opts.userSelectAction } : {})
  });

  const { store } = state;

  const undoStack = createUndoStack(store);
  const lifecycle = createLifecycleObserver<SpatialAnnotation, E>(state, undoStack, opts.adapter, opts.autoSave);

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

  const getStyle = (target: SpatialAnnotationTarget) => {
    if (!currentStyle) return undefined;

    const annotation = store.getAnnotation(target.annotation);
    if (!annotation) return undefined;

    const computed = typeof currentStyle === 'function' ? currentStyle(annotation, undefined) : currentStyle;
    return computed ? toRenderStyle(computed) : undefined;
  }

  const getFilter = () => currentFilter;

  const deckOverlay = createDeckOverlay(map, store, imageRegistry, imageIndexes, draftStore, {
    getStyle,
    getFilter,
    ...(opts.lod ? { lod: opts.lod } : {})
  });

  const pointerHandling = createPointerHandling(map, state, imageRegistry, imageIndexes, draftStore, {
    ...(opts.multiSelect !== undefined ? { multiSelect: opts.multiSelect } : {}),
    getFilter,
    onHint: (hints, source) => deckOverlay.setHints(hints, imageRegistry.get(source))
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
    getDrawingTool: pointerHandling.getDrawingTool,
    isDrawingEnabled: pointerHandling.isDrawingEnabled,
    listDrawingTools: listTools,
    on: lifecycle.on,
    off: lifecycle.off,
    setDrawingEnabled: pointerHandling.setDrawingEnabled,
    setDrawingTool: pointerHandling.setDrawingTool,
    setFilter,
    setStyle,
    state
  };

}
