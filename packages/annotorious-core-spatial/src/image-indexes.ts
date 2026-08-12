import { createAnnotationIndex } from './annotation-index';
import type { AnnotationIndex } from './annotation-index';
import type { SpatialAnnotation, SpatialAnnotationTarget } from './model';
import type { Store } from '@annotorious/core';

/**
 * One `AnnotationIndex` per image (`source`), each in that image's own
 * local pixel space - the same space the annotations are actually stored
 * in, so no retransformation is needed on every edit. Rebuilding a
 * world-space-transformed index on every keystroke of a drag gesture would
 * be far too expensive at scale; this way, a single-target edit is a single
 * O(log n) index update, and geometry only gets transformed to world space
 * for the (much smaller) set of candidates that survive a viewport query -
 * see `gatherCandidates` in a viewer package's deck-overlay.
 *
 * Viewer-agnostic - lives here (not in a viewer package) since it depends
 * only on `Store`/`AnnotationIndex`, and both OpenSeadragon and OpenLayers
 * need the exact same per-source indexing.
 */
export const createImageIndexes = (store: Store<SpatialAnnotation>) => {

  const indexes = new Map<string | undefined, AnnotationIndex<SpatialAnnotationTarget>>();

  const indexFor = (source: string | undefined): AnnotationIndex<SpatialAnnotationTarget> => {
    let index = indexes.get(source);
    if (!index) {
      index = createAnnotationIndex();
      indexes.set(source, index);
    }
    return index;
  }

  /** (Re)builds the index for one image from scratch, from whatever's currently in the store. **/
  const rebuild = (source: string | undefined) => {
    const targets = store.all()
      .filter(a => a.target.source === source)
      .map(a => a.target);

    indexFor(source).set(targets);
  }

  store.observe(({ changes }) => {
    const created = changes.created || [];
    if (created.length > 0) {
      // Bulk-load per source rather than inserting one at a time - a batch
      // of thousands of new annotations (e.g. a bulk `setAnnotations` call)
      // would otherwise mean thousands of sequential RBush inserts, which is
      // both slower to build *and* produces a worse-balanced tree than a
      // bulk load - degrading every viewport/hit-test query against it for
      // as long as that data lives in the index. `set(..., false)` merges
      // in without clearing what's already there (see spatial-index.ts).
      const bySource = new Map<string | undefined, SpatialAnnotationTarget[]>();
      created.forEach(a => {
        const targets = bySource.get(a.target.source);
        if (targets) targets.push(a.target);
        else bySource.set(a.target.source, [a.target]);
      });

      bySource.forEach((targets, source) => indexFor(source).set(targets, false));
    }

    (changes.deleted || []).forEach(a => indexFor(a.target.source).remove(a.target));

    (changes.updated || []).forEach(({ oldValue, newValue }) => {
      if (oldValue.target.source !== newValue.target.source) {
        // Reassigned to a different image - move it between indexes
        indexFor(oldValue.target.source).remove(oldValue.target);
        indexFor(newValue.target.source).insert(newValue.target);
      } else {
        indexFor(newValue.target.source).update(oldValue.target, newValue.target);
      }
    });
  });

  const get = (source: string | undefined) => indexes.get(source);

  const sources = () => [...indexes.keys()];

  return { get, indexFor, rebuild, sources };

}

export type ImageIndexes = ReturnType<typeof createImageIndexes>;
