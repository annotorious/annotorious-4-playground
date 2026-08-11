import type { Annotation, AnnotationTarget } from '@annotorious/core';
import type { SpatialShape } from '../geometry';

/**
 * A spatial annotation target: the core `AnnotationTarget`, narrowed to a
 * concrete geometry (box/polygon/point) as its selector.
 *
 * `source` identifies *which* piece of spatial media this geometry is
 * relative to - e.g. an image id/URL. It's optional: a single-image
 * OpenSeadragon annotator, or an OpenLayers annotator (where geometry
 * already lives directly in one shared map projection) has no need for it.
 * A multi-image OpenSeadragon world - several images placed freely - is the
 * case that requires it, to know which image's local pixel space (and
 * therefore which placement transform) a given geometry belongs to.
 */
export interface SpatialAnnotationTarget<G extends SpatialShape = SpatialShape> extends AnnotationTarget {

  selector: G;

  source?: string;

}

export interface SpatialAnnotation<G extends SpatialShape = SpatialShape> extends Annotation {

  target: SpatialAnnotationTarget<G>;

}

export const isSpatialAnnotationTarget = (target: AnnotationTarget): target is SpatialAnnotationTarget => {
  const selector = (target as SpatialAnnotationTarget).selector;
  return Boolean(selector) && typeof selector === 'object' && 'type' in selector && 'geometry' in selector;
}
