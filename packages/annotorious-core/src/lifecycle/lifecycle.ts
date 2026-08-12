import { dequal } from 'dequal/lite';
import type { Annotation, AnnotatorState, FormatAdapter } from '../model';
import { Origin } from '../state';
import type { UndoStack } from '../state';
import type { LifecycleEvents } from './lifecycle-events';

export type Lifecycle<I extends Annotation, E extends unknown> = ReturnType<typeof createLifecycleObserver<I, E>>;

// How long to wait for inactivity before flushing pending target changes.
// Unconditional - see module doc below for why this can't be opt-in.
const UPDATE_DEBOUNCE_MS = 1000;

/**
 * Bridges the low-level store/selection/hover/viewport state onto the public,
 * high-level `LifecycleEvents` an annotator emits.
 *
 * Most events (create/delete/hover/viewport/selection) map through directly.
 * `updateAnnotation` is the one with real policy behind it: body edits
 * (comments, tags, ...) are discrete, deliberate actions and get reported
 * immediately, but target changes (drag/resize) happen as a stream of many
 * small store updates during a single gesture - reporting each one would be
 * event spam. Those are batched: the annotation's state right before the
 * gesture started is remembered in `pending`, and compared against its
 * current state once the gesture is clearly over - either the annotation is
 * deselected, *or* (unconditionally, not behind an opt-in flag) the user has
 * paused for `UPDATE_DEBOUNCE_MS`. That second path used to be gated behind
 * an `autoSave` option (ported from v3, which had the exact same gate) -
 * removed, because gating it meant a host that never turns `autoSave` on
 * (the default) never hears about a completed drag/resize until the user
 * happens to deselect, which could be never. That's precisely the "always
 * fire, independently of selection, and simply debounce fast changes"
 * behavior https://github.com/annotorious/annotorious/issues/566 asked for -
 * deselect is still an equally-valid, *faster* way to flush early, it's just
 * no longer the only way.
 */
export const createLifecycleObserver = <I extends Annotation, E extends unknown>(
  state: AnnotatorState<I, E>,
  undoStack: UndoStack<I>,
  adapter?: FormatAdapter<I, E>
) => {
  const { hover, selection, store, viewport } = state;

  const listeners = new Map<keyof LifecycleEvents<E>, Set<Function>>();

  const on = <T extends keyof LifecycleEvents<E>>(event: T, callback: LifecycleEvents<E>[T]) => {
    if (!listeners.has(event))
      listeners.set(event, new Set());
    listeners.get(event)!.add(callback);
  }

  const off = <T extends keyof LifecycleEvents<E>>(event: T, callback: LifecycleEvents<E>[T]) => {
    listeners.get(event)?.delete(callback);
  }

  const serialize = (a: I): E => adapter ? adapter.serialize(a) : a as unknown as E;

  // Deferred to the next tick, so listeners never observe the store mid-transaction.
  const emit = (event: keyof LifecycleEvents<E>, arg0: I | I[], arg1?: I | PointerEvent) => {
    const callbacks = listeners.get(event);
    if (!callbacks || callbacks.size === 0) return;

    setTimeout(() => {
      const serialized0 = Array.isArray(arg0) ? arg0.map(serialize) : serialize(arg0);
      const isPointerEvent = typeof PointerEvent !== 'undefined' && arg1 instanceof PointerEvent;
      const serialized1 = isPointerEvent ? arg1 : (arg1 ? serialize(arg1 as I) : undefined);

      callbacks.forEach(callback => (callback as (a: unknown, b: unknown) => void)(serialized0, serialized1));
    }, 1);
  }

  // Baseline "before" snapshot for annotations with an unreported target
  // change, keyed by annotation id - see module doc above.
  const pending = new Map<string, I>();

  let idleTimeout: ReturnType<typeof setTimeout> | undefined;

  const flush = (id: string) => {
    const baseline = pending.get(id);
    pending.delete(id);
    if (!baseline) return;

    const current = store.getAnnotation(id);
    if (current && !dequal(baseline, current))
      emit('updateAnnotation', current, baseline);
  }

  const flushAll = () => [...pending.keys()].forEach(flush);

  selection.subscribe(({ selected }) => {
    const stillSelected = new Set(selected.map(s => s.id));

    // Report changes for anything that just dropped out of the selection
    [...pending.keys()]
      .filter(id => !stillSelected.has(id))
      .forEach(flush);

    // The "baseline" if a change is still pending, otherwise the live value -
    // i.e. the most recent value that has actually been reported.
    const snapshot = selected
      .map(({ id }) => pending.get(id) || store.getAnnotation(id))
      .filter((a): a is I => Boolean(a));

    emit('selectionChanged', snapshot);
  });

  let currentHover: string | null = null;

  hover.subscribe(id => {
    if (!currentHover && id) {
      emit('mouseEnterAnnotation', store.getAnnotation(id)!);
    } else if (currentHover && !id) {
      emit('mouseLeaveAnnotation', store.getAnnotation(currentHover)!);
    } else if (currentHover && id) {
      emit('mouseLeaveAnnotation', store.getAnnotation(currentHover)!);
      emit('mouseEnterAnnotation', store.getAnnotation(id)!);
    }

    currentHover = id;
  });

  viewport.subscribe(ids =>
    emit('viewportIntersect', ids.map(id => store.getAnnotation(id)).filter((a): a is I => Boolean(a))));

  store.observe(({ changes }) => {
    clearTimeout(idleTimeout);
    idleTimeout = setTimeout(flushAll, UPDATE_DEBOUNCE_MS);

    (changes.created || []).forEach(a => emit('createAnnotation', a));

    (changes.deleted || []).forEach(a => {
      pending.delete(a.id);
      emit('deleteAnnotation', a);
    });

    (changes.updated || []).forEach(({ oldValue, newValue, bodiesCreated, bodiesDeleted, bodiesUpdated, targetUpdated }) => {
      const hasBodyChange = Boolean(
        bodiesCreated?.length || bodiesDeleted?.length || bodiesUpdated?.length);

      if (hasBodyChange) {
        emit('updateAnnotation', newValue, oldValue);

        // Keep any still-pending target baseline's bodies in sync, so a later
        // flush doesn't re-report a body change already reported here.
        const baseline = pending.get(oldValue.id);
        if (baseline)
          pending.set(oldValue.id, { ...baseline, bodies: newValue.bodies });
      }

      // First change of a gesture (drag/resize/...) - remember the true "before".
      if (targetUpdated && !pending.has(oldValue.id))
        pending.set(oldValue.id, oldValue);
    });
  }, { origin: Origin.LOCAL });

  // Remote updates move the pending baseline forward, so a later local flush
  // doesn't misattribute a remote change as a local edit.
  store.observe(({ changes }) => {
    (changes.updated || []).forEach(({ oldValue, newValue }) => {
      if (pending.has(oldValue.id))
        pending.set(oldValue.id, newValue);
    });
  }, { origin: Origin.REMOTE });

  undoStack.on('undo', ({ updated }) => (updated || []).forEach(({ oldValue, newValue }) => {
    pending.delete(oldValue.id);
    emit('updateAnnotation', oldValue, newValue);
  }));

  undoStack.on('redo', ({ updated }) => (updated || []).forEach(({ oldValue, newValue }) => {
    pending.delete(oldValue.id);
    emit('updateAnnotation', newValue, oldValue);
  }));

  return { on, off, emit };

}
