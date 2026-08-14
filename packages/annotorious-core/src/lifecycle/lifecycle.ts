import { dequal } from 'dequal/lite';
import type { AnnotatorState, FormatAdapter, RuntimeAnnotation } from '../model';
import { Origin } from '../state';
import type { UndoStack } from '../state';
import type { LifecycleEvents } from './lifecycle-events';

export type Lifecycle<I extends RuntimeAnnotation, E extends unknown> = ReturnType<typeof createLifecycleObserver<I, E>>;

// How long to wait for inactivity before flushing pending target changes.
const UPDATE_DEBOUNCE_MS = 1000;

/**
 * Bridges the low-level store/selection/hover/viewport state onto the public,
 * high-level CRUD events that the annotator emits.
 */
export const createLifecycleObserver = <I extends RuntimeAnnotation, E extends unknown>(
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
  //
  // Queued rather than given its own `setTimeout` per call: a single bulk
  // operation (e.g. `setAnnotations` on 100,000 annotations) fires this once
  // per annotation, all within the same synchronous turn - scheduling
  // 100,000 independent timers (each with its own V8 timer-heap entry and
  // callback frame) costs real, measurable time on top of whatever the
  // listeners themselves do, even when a listener does nothing. Batching
  // every emission queued within one turn into a single flush keeps the
  // exact same public behavior (one listener call per emission, still
  // deferred past the current transaction, still in order) while paying for
  // one timer instead of thousands.
  const pendingEmissions: Array<{ event: keyof LifecycleEvents<E>, arg0: I | I[], arg1: I | PointerEvent | undefined }> = [];
  let flushScheduled = false;

  const flushEmissions = () => {
    flushScheduled = false;

    // Emissions queued *while* this flush runs (a listener that itself
    // triggers a store change, say) are left for the next flush rather than
    // processed in this pass, so a listener can't inadvertently starve the
    // event loop by chaining emissions forever within one synchronous flush.
    const toProcess = pendingEmissions.splice(0, pendingEmissions.length);

    toProcess.forEach(({ event, arg0, arg1 }) => {
      const callbacks = listeners.get(event);
      if (!callbacks || callbacks.size === 0) return;

      const serialized0 = Array.isArray(arg0) ? arg0.map(serialize) : serialize(arg0);
      const isPointerEvent = typeof PointerEvent !== 'undefined' && arg1 instanceof PointerEvent;
      const serialized1 = isPointerEvent ? arg1 : (arg1 ? serialize(arg1 as I) : undefined);

      callbacks.forEach(callback => {
        // One listener throwing shouldn't stop the rest of the batch -
        // matches the old one-`setTimeout`-per-emission behavior, where an
        // exception in one callback couldn't affect any other's timer.
        try {
          (callback as (a: unknown, b: unknown) => void)(serialized0, serialized1);
        } catch (error) {
          console.error(`Error in '${String(event)}' listener:`, error);
        }
      });
    });
  }

  const emit = (event: keyof LifecycleEvents<E>, arg0: I | I[], arg1?: I | PointerEvent) => {
    const callbacks = listeners.get(event);
    if (!callbacks || callbacks.size === 0) return;

    pendingEmissions.push({ event, arg0, arg1 });

    if (!flushScheduled) {
      flushScheduled = true;
      setTimeout(flushEmissions, 1);
    }
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
