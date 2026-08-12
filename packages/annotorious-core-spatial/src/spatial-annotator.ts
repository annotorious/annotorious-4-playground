import type { Annotator } from '@annotorious/core';
import type { DraftStore } from './draft-store';
import type { SpatialAnnotation, SpatialAnnotationTarget } from './model';

/**
 * The shape every spatial viewer backend's annotator satisfies (OpenSeadragon,
 * OpenLayers, ...) - the base `Annotator` (from `@annotorious/core`, which
 * must stay media-agnostic) plus `draftStore`, the observable collection of
 * in-progress shapes (see `draft-store.ts`). Exists specifically so a
 * viewer-agnostic plugin (e.g. a multiplayer sync plugin) can depend on one
 * shared interface instead of a specific viewer package.
 */
export interface SpatialAnnotator<E = SpatialAnnotation> extends Annotator<SpatialAnnotation, E> {

  draftStore: DraftStore<SpatialAnnotationTarget>;

}
