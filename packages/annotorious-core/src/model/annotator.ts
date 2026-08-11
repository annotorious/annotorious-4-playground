import type { Annotation } from './annotation';
import type { User } from './user';
import { createAnonymousGuest } from './user';
import type { DrawingStyleExpression } from './drawing-style';
import type { Filter } from './filter';
import { type FormatAdapter, parseAll } from './format-adapter';
import {
  createHoverState,
  createSelectionState,
  createStore,
  createUndoStack,
  createViewportState,
  Origin
} from '../state';
import type {
  History,
  HoverState,
  SelectionState,
  Store,
  UndoStack,
  UserSelectActionExpression,
  ViewportState
} from '../state';
import type { LifecycleEvents } from '../lifecycle';
import { reviveDates } from '../utils';

/**
 * Base annotator interface, implemented by every media-specific annotator
 * (OpenSeadragon, OpenLayers, ...). `I` is the internal core data model,
 * `E` is the externally-facing (typically format-adapted) representation.
 */
export interface Annotator<I extends Annotation = Annotation, E extends unknown = Annotation> {

  addAnnotation(annotation: Partial<E>): void;

  cancelSelected(): void;

  canRedo(): boolean;

  canUndo(): boolean;

  clearAnnotations(): void;

  destroy(): void;

  getAnnotationById(id: string): E | undefined;

  getAnnotations(): E[];

  getHistory(): History<I>;

  getSelected(): E[];

  getUser(): User;

  loadAnnotations(url: string, replace?: boolean): Promise<E[]>;

  redo(): void;

  removeAnnotation(arg: Partial<E> | string): E | undefined;

  setAnnotations(annotations: Partial<E>[], replace?: boolean): void;

  setFilter(filter: Filter<I> | undefined): void;

  setSelected(arg?: string | string[], editable?: boolean): void;

  setStyle(style: DrawingStyleExpression<I> | undefined): void;

  setUser(user: User): void;

  setUserSelectAction(action: UserSelectActionExpression<E>): void;

  undo(): void;

  updateAnnotation(annotation: Partial<E>): E | undefined;

  on<T extends keyof LifecycleEvents<E>>(event: T, callback: LifecycleEvents<E>[T]): void;

  off<T extends keyof LifecycleEvents<E>>(event: T, callback: LifecycleEvents<E>[T]): void;

  state: AnnotatorState<I, E>;

}

export interface AnnotatorState<I extends Annotation, E extends unknown> {

  store: Store<I>;

  selection: SelectionState<I, E>;

  hover: HoverState<I>;

  viewport: ViewportState;

}

export interface AnnotatorOpts<I extends Annotation, E extends unknown> {

  adapter?: FormatAdapter<I, E>;

  userSelectAction?: UserSelectActionExpression<E>;

}

/** Creates the generic {store, selection, hover, viewport} state bundle every annotator needs. **/
export const createAnnotatorState = <I extends Annotation, E extends unknown>(
  opts: AnnotatorOpts<I, E> = {}
): AnnotatorState<I, E> => {
  const store = createStore<I>();

  return {
    store,
    selection: createSelectionState<I, E>(store, opts.userSelectAction, opts.adapter),
    hover: createHoverState<I>(store),
    viewport: createViewportState()
  };
}

/**
 * Implements the media-independent part of the `Annotator` contract: data
 * CRUD, selection and undo/redo. Rendering-dependent parts (`setFilter`,
 * `setStyle`, `destroy`, lifecycle `on`/`off`, ...) are the responsibility of
 * the concrete (media-specific) annotator, since core has no renderer to push
 * those into.
 */
export const createBaseAnnotator = <I extends Annotation, E extends unknown>(
  state: AnnotatorState<I, E>,
  undoStack: UndoStack<I>,
  adapter?: FormatAdapter<I, E>,
  initialUser: User = createAnonymousGuest()
) => {

  const { store, selection } = state;

  let currentUser = initialUser;

  const addAnnotation = (annotation: E) => {
    if (adapter) {
      const { parsed, error } = adapter.parse(annotation);
      if (parsed) {
        store.addAnnotation(parsed, Origin.REMOTE);
      } else {
        console.error(error);
      }
    } else {
      store.addAnnotation(reviveDates<I>(annotation), Origin.REMOTE);
    }
  }

  const cancelSelected = () => selection.clear();

  const clearAnnotations = () => store.clear();

  const getAnnotationById = (id: string): E | undefined => {
    const annotation = store.getAnnotation(id);
    return annotation
      ? (adapter ? adapter.serialize(annotation) : annotation as unknown as E)
      : undefined;
  }

  const getAnnotations = () =>
    (adapter ? store.all().map(adapter.serialize) : store.all()) as E[];

  const getSelected = () => {
    const selected = (selection.selected || [])
      .map(({ id }) => store.getAnnotation(id))
      .filter((a): a is I => Boolean(a));

    return adapter ? selected.map(adapter.serialize) : selected as unknown as E[];
  }

  const getUser = () => currentUser;

  const setUser = (user: User) => { currentUser = user; }

  const loadAnnotations = (url: string, replace = true) =>
    fetch(url)
      .then(response => response.json())
      .then((annotations: E[]) => {
        setAnnotations(annotations, replace);
        return annotations;
      });

  const removeAnnotation = (arg: E | string): E | undefined => {
    if (typeof arg === 'string') {
      const annotation = store.getAnnotation(arg);
      if (!annotation) return undefined;

      store.deleteAnnotation(arg);
      return adapter ? adapter.serialize(annotation) : annotation as unknown as E;
    } else {
      const annotation = adapter ? adapter.parse(arg).parsed : (arg as unknown as I);
      if (!annotation) return undefined;

      store.deleteAnnotation(annotation);
      return arg;
    }
  }

  const setAnnotations = (annotations: E[], replace = true) => {
    const apply = replace ? store.syncAnnotations : store.bulkUpsertAnnotations;

    if (adapter) {
      const parseFn = adapter.parseAll || parseAll(adapter);
      const { parsed, failed } = parseFn(annotations);

      if (failed.length > 0)
        console.warn(`Discarded ${failed.length} invalid annotations`, failed);

      apply(parsed, Origin.REMOTE);
    } else {
      apply(annotations.map(reviveDates<I>), Origin.REMOTE);
    }
  }

  const setSelected = (arg?: string | string[], editable?: boolean) => {
    if (arg) {
      selection.setSelected(arg, editable);
    } else {
      selection.clear();
    }
  }

  const setUserSelectAction = (action: UserSelectActionExpression<E>) =>
    selection.setUserSelectAction(action);

  const updateAnnotation = (updated: E): E | undefined => {
    if (adapter) {
      const crosswalked = adapter.parse(updated).parsed;
      if (!crosswalked) return undefined;

      const existing = store.getAnnotation(crosswalked.id);
      const previous = existing ? adapter.serialize(existing) : undefined;

      store.updateAnnotation(crosswalked);
      return previous;
    } else {
      const previous = store.getAnnotation((updated as unknown as I).id);
      store.updateAnnotation(reviveDates<I>(updated));
      return previous as unknown as E;
    }
  }

  // Note: we don't spread the undoStack - it has a `.destroy()` method that
  // would silently get overwritten by other Annotator implementations otherwise.
  return {
    addAnnotation,
    cancelSelected,
    canRedo: undoStack.canRedo,
    canUndo: undoStack.canUndo,
    clearAnnotations,
    getAnnotationById,
    getAnnotations,
    getHistory: undoStack.getHistory,
    getSelected,
    getUser,
    loadAnnotations,
    redo: undoStack.redo,
    removeAnnotation,
    setAnnotations,
    setSelected,
    setUser,
    setUserSelectAction,
    undo: undoStack.undo,
    updateAnnotation
  };

}
