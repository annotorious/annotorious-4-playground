import { createNanoEvents, type Unsubscribe } from 'nanoevents';
import type { Annotation } from '../model';
import type { Store } from './store';
import { mergeChanges, Origin } from './store-observer';
import type { ChangeSet, StoreChangeEvent, Update } from './store-observer';

// Duration within which fast successive changes get merged into the last
// undo step, rather than getting pushed as a new one (e.g. while dragging).
const DEBOUNCE = 250;

export interface UndoStack<T extends Annotation> {

  canRedo(): boolean;

  canUndo(): boolean;

  destroy(): void;

  getHistory(): History<T>;

  on<E extends keyof UndoStackEvents<T>>(event: E, callback: UndoStackEvents<T>[E]): Unsubscribe;

  redo(): void;

  undo(): void;

}

export interface UndoStackEvents<T extends Annotation> {

  redo(change: ChangeSet<T>): void;

  undo(change: ChangeSet<T>): void;

}

export interface History<T extends Annotation> {

  changes: ChangeSet<T>[];

  pointer: number;

}

export const createUndoStack = <T extends Annotation>(store: Store<T>, history?: History<T>): UndoStack<T> => {

  const emitter = createNanoEvents<UndoStackEvents<T>>();

  const changeStack: ChangeSet<T>[] = history?.changes || [];

  let pointer = history ? history.pointer : -1;

  let muteEvents = false;

  let lastEvent = 0;

  const onChange = (event: StoreChangeEvent<T>) => {
    if (muteEvents) return;

    const { changes } = event;
    const now = performance.now();

    // `pointer === -1` means there's nothing to merge into yet (either the
    // very first change, or right after an undo back to the start) - always
    // push in that case, regardless of how much wall-clock time has passed.
    if (pointer === -1 || now - lastEvent > DEBOUNCE) {
      // Put this change on the stack, discarding any redo-able future
      changeStack.splice(pointer + 1);
      changeStack.push(changes);
      pointer = changeStack.length - 1;
    } else {
      // Merge this change into the one at the current position
      changeStack[pointer] = mergeChanges(changeStack[pointer]!, changes);
    }

    lastEvent = now;
  }

  store.observe(onChange, { origin: Origin.LOCAL });

  const undoCreated = (created?: T[]) =>
    created && created.length > 0 && store.bulkDeleteAnnotations(created);

  const redoCreated = (created?: T[]) =>
    created && created.length > 0 && store.bulkUpsertAnnotations(created);

  // SILENT: consumers (e.g. the lifecycle observer) that want to react to
  // undo/redo-driven updates specifically should listen via `on('undo'/'redo')`
  // below, which reports the correct old/new pair once per change. If these
  // went out as regular LOCAL updates, a generic store.observe(LOCAL) listener
  // would see them too and could double-report alongside the dedicated event.
  const undoUpdated = (updated?: Update<T>[]) =>
    updated && updated.length > 0 &&
      store.bulkUpdateAnnotations(updated.map(({ oldValue }) => oldValue), Origin.SILENT);

  const redoUpdated = (updated?: Update<T>[]) =>
    updated && updated.length > 0 &&
      store.bulkUpdateAnnotations(updated.map(({ newValue }) => newValue), Origin.SILENT);

  const undoDeleted = (deleted?: T[]) =>
    deleted && deleted.length > 0 && store.bulkUpsertAnnotations(deleted);

  const redoDeleted = (deleted?: T[]) =>
    deleted && deleted.length > 0 && store.bulkDeleteAnnotations(deleted);

  const canUndo = () => pointer > -1;

  const undo = () => {
    if (!canUndo()) return;

    muteEvents = true;

    const change = changeStack[pointer]!;
    undoCreated(change.created);
    undoUpdated(change.updated);
    undoDeleted(change.deleted);

    muteEvents = false;

    emitter.emit('undo', change);

    pointer -= 1;
  }

  const canRedo = () => changeStack.length - 1 > pointer;

  const redo = () => {
    if (!canRedo()) return;

    muteEvents = true;

    const change = changeStack[pointer + 1]!;
    redoCreated(change.created);
    redoUpdated(change.updated);
    redoDeleted(change.deleted);

    muteEvents = false;

    emitter.emit('redo', change);

    pointer += 1;
  }

  const destroy = () => store.unobserve(onChange);

  const getHistory = () => ({ changes: [...changeStack], pointer });

  const on = <E extends keyof UndoStackEvents<T>>(event: E, callback: UndoStackEvents<T>[E]) =>
    emitter.on(event, callback);

  return { canRedo, canUndo, destroy, getHistory, on, redo, undo };

}
