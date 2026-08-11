import { createAnnotationIndex } from '@annotorious/core-spatial';
import type { AnnotationIndex, SpatialAnnotation, SpatialAnnotationTarget } from '@annotorious/core-spatial';
import type { Store } from '@annotorious/core';

/**
 * One `AnnotationIndex` per image (`source`), each in that image's own
 * local pixel space - the same space the annotations are actually stored
 * in, so no retransformation is needed on every edit. Rebuilding a
 * world-space-transformed index on every keystroke of a drag gesture would
 * be far too expensive at scale; this way, a single-target edit is a single
 * O(log n) index update, and geometry only gets transformed to world space
 * for the (much smaller) set of candidates that survive a viewport query -
 * see `gatherCandidates` in `render-loop.ts`.
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
    (changes.created || []).forEach(a => indexFor(a.target.source).insert(a.target));

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
