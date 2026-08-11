import { atom } from 'nanostores';
import type { SpatialAnnotationTarget } from './model';

export interface DraftEntry<T extends SpatialAnnotationTarget = SpatialAnnotationTarget> {

  /**
   * Whose in-progress shape this is - the local session for local drawing,
   * a remote user/session id for a draft synced in from elsewhere.
   */
  authorId: string;

  target: T;

}

/**
 * Observable collection of in-progress (not-yet-committed) annotation
 * targets, keyed by author. This is the extension point for realtime
 * collaborative drawing: a local drawing tool writes its own entry here as
 * the shape develops (see how the OpenSeadragon package's pointer wiring
 * uses it), a rendering layer subscribes to draw whatever's currently in
 * the map, and a collab/presence plugin can do both - subscribe to
 * broadcast the local entry outward, and write entries for remote users'
 * drafts arriving over the wire so they render locally too, live, the same
 * way the local user's own in-progress shape does.
 *
 * Deliberately kept separate from the main annotation `Store`: an
 * in-progress shape isn't a committed annotation - no undo history, no
 * lifecycle events, discarded outright on cancel - and routing it through
 * the store as real mutations would conflate "here's a live preview" with
 * "the document changed", which most collaborative tools want to keep
 * apart (per-keystroke draft noise doesn't belong in an edit history).
 */
export const createDraftStore = <T extends SpatialAnnotationTarget = SpatialAnnotationTarget>() => {

  const drafts = atom<Map<string, DraftEntry<T>>>(new Map());

  const set = (authorId: string, target: T | undefined) => {
    const current = drafts.get();

    if (target) {
      current.set(authorId, { authorId, target });
    } else {
      current.delete(authorId);
    }

    // Mutated in place - notify() is nanostores' documented low-level way to
    // trigger listeners for a mutable collection without cloning it (a plain
    // .set() would no-op, since it gates on reference equality).
    drafts.notify();
  }

  const get = (authorId: string): T | undefined => drafts.get().get(authorId)?.target;

  const all = (): DraftEntry<T>[] => [...drafts.get().values()];

  return {
    all,
    get,
    set,
    subscribe: drafts.subscribe.bind(drafts)
  };

}

export type DraftStore<T extends SpatialAnnotationTarget = SpatialAnnotationTarget> = ReturnType<typeof createDraftStore<T>>;
