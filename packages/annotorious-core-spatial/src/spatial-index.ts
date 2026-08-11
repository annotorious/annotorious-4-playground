import RBush from 'rbush';
import type { Bounds } from './geometry';

interface IndexedItem<T> extends Bounds {

  id: string;

  item: T;

}

export type SpatialIndex<T> = ReturnType<typeof createSpatialIndex<T>>;

/**
 * A generic id + bounds spatial index, backed by RBush.
 *
 * Deliberately coordinate-space agnostic: it indexes whatever bounds it's
 * given, with no assumptions about what those bounds mean. That matters for
 * multi-image OpenSeadragon in particular - annotation geometry lives in each
 * image's own local pixel space, but a single shared index needs everything
 * in one common (world) space to be useful for viewport queries. It's the
 * caller's job to transform bounds into that common space before indexing
 * (for a single coordinate space - OpenLayers, or single-image OpenSeadragon -
 * that transform is just the identity, which is exactly what
 * `createAnnotationIndex` below assumes).
 */
export const createSpatialIndex = <T>() => {

  const tree = new RBush<IndexedItem<T>>();

  const byId = new Map<string, IndexedItem<T>>();

  const insert = (id: string, bounds: Bounds, item: T) => {
    const entry: IndexedItem<T> = { id, item, ...bounds };
    tree.insert(entry);
    byId.set(id, entry);
  }

  const remove = (id: string) => {
    const entry = byId.get(id);
    if (entry) {
      tree.remove(entry);
      byId.delete(id);
    }
  }

  const update = (id: string, bounds: Bounds, item: T) => {
    remove(id);
    insert(id, bounds, item);
  }

  const clear = () => {
    tree.clear();
    byId.clear();
  }

  /** Bulk-loads the index. Faster than repeated `insert` for large collections. **/
  const set = (items: { id: string, bounds: Bounds, item: T }[], replace = true) => {
    if (replace)
      clear();

    const entries = items.map(({ id, bounds, item }) => ({ id, item, ...bounds }));
    entries.forEach(entry => byId.set(entry.id, entry));
    tree.load(entries);
  }

  /** All items whose bounds intersect the given rectangle - a cheap bbox-only query. **/
  const getIntersecting = (bounds: Bounds): T[] =>
    tree.search(bounds).map(entry => entry.item);

  /**
   * All items whose bounds intersect the point (optionally expanded by
   * `buffer` on each side) - a cheap bbox-only query. For a precise
   * hit-test against actual shape geometry (not just its bounding box), the
   * annotation-aware convenience index below layers that on top.
   */
  const getAt = (x: number, y: number, buffer = 0): T[] =>
    tree.search({ minX: x - buffer, minY: y - buffer, maxX: x + buffer, maxY: y + buffer })
      .map(entry => entry.item);

  const all = () => [...byId.values()].map(entry => entry.item);

  const size = () => byId.size;

  return { all, clear, getAt, getIntersecting, insert, remove, set, size, update };

}
