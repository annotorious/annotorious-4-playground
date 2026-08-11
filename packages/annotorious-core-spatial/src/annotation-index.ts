import { computeArea, hitTest } from './geometry';
import type { SpatialAnnotationTarget } from './model';
import { createSpatialIndex } from './spatial-index';

export type AnnotationIndex<T extends SpatialAnnotationTarget> = ReturnType<typeof createAnnotationIndex<T>>;

/**
 * Convenience spatial index over annotation targets directly, for the common
 * case where a target's own geometry is already in the right query space -
 * true for OpenLayers (geometry lives directly in map projection units) and
 * for single-image OpenSeadragon (local pixel space *is* world space).
 *
 * A multi-image OpenSeadragon world, where each target's geometry is local
 * to its own image, needs bounds transformed into a shared world space
 * first - use `createSpatialIndex` directly for that, feeding it
 * world-transformed bounds per target.
 */
export const createAnnotationIndex = <T extends SpatialAnnotationTarget>() => {

  const index = createSpatialIndex<T>();

  const insert = (target: T) => index.insert(target.annotation, target.selector.geometry.bounds, target);

  const remove = (target: T) => index.remove(target.annotation);

  const update = (previous: T, updated: T) => index.update(updated.annotation, updated.selector.geometry.bounds, updated);

  const set = (targets: T[], replace = true) =>
    index.set(targets.map(target => ({ id: target.annotation, bounds: target.selector.geometry.bounds, item: target })), replace);

  /** Precise hit test: bbox-filtered by the index, then exact-tested against each shape's real geometry. **/
  const getAt = (x: number, y: number, buffer = 0): T[] => {
    const candidates = index.getAt(x, y, buffer);
    const hits = candidates.filter(({ selector }) => hitTest(selector, x, y, buffer));

    // Smallest shape wins - lets a small annotation nested inside a larger
    // one still be selectable, rather than always resolving to the larger.
    return hits.sort((a, b) => computeArea(a.selector) - computeArea(b.selector));
  }

  const { all, clear, getIntersecting, size } = index;

  return { all, clear, getAt, getIntersecting, insert, remove, set, size, update };

}
