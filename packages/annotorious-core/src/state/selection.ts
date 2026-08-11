import { atom } from 'nanostores';
import { dequal } from 'dequal/lite';
import type { Annotation, FormatAdapter } from '../model';
import type { Store } from './store';

export interface Selection {

  selected: { id: string, editable?: boolean }[];

  event?: PointerEvent | KeyboardEvent;

}

export type SelectionState<I extends Annotation, E extends unknown> = ReturnType<typeof createSelectionState<I, E>>;

export enum UserSelectAction {

  EDIT = 'EDIT', // Make annotation target(s) editable on pointer select

  SELECT = 'SELECT', // Just select, but don't make editable

  NONE = 'NONE' // Click won't select - the annotation is completely inert

}

export type UserSelectActionExpression<T extends unknown> = UserSelectAction | ((a: T) => UserSelectAction);

const EMPTY: Selection = { selected: [] };

export const createSelectionState = <I extends Annotation, E extends unknown>(
  store: Store<I>,
  defaultSelectionAction?: UserSelectActionExpression<E>,
  adapter?: FormatAdapter<I, E>
) => {
  const selection = atom<Selection>(EMPTY);

  let currentUserSelectAction = defaultSelectionAction;

  const clear = () => {
    if (!dequal(selection.get(), EMPTY))
      selection.set(EMPTY);
  }

  const isEmpty = () => selection.get().selected.length === 0;

  const isSelected = (annotationOrId: I | string) => {
    if (isEmpty())
      return false;

    const id = typeof annotationOrId === 'string' ? annotationOrId : annotationOrId.id;
    return selection.get().selected.some(s => s.id === id);
  }

  // Utility to evaluate what the select action will be for the given annotation
  const evalSelectAction = (annotation: I) =>
    onUserSelect(annotation, currentUserSelectAction, adapter);

  const userSelect = (idOrIds: string | string[], event?: Selection['event']) => {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];

    const annotations = ids.map(id => store.getAnnotation(id)).filter((a): a is I => Boolean(a));
    if (annotations.length < ids.length) {
      console.warn('Invalid selection: ' + ids.filter(id => !annotations.some(a => a.id === id)));
      return;
    }

    const selected = annotations.reduce<Selection['selected']>((sel, a) => {
      const action = evalSelectAction(a);
      return action === UserSelectAction.EDIT ? [...sel, { id: a.id, editable: true }]
        : action === UserSelectAction.SELECT ? [...sel, { id: a.id }]
        : sel;
    }, []);

    selection.set(event ? { selected, event } : { selected });
  }

  const setSelected = (idOrIds: string | string[], editable?: boolean) => {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];

    const annotations = ids.map(id => store.getAnnotation(id)).filter((a): a is I => Boolean(a));

    selection.set({
      selected: annotations.map(annotation => ({
        id: annotation.id,
        editable: editable === undefined ? evalSelectAction(annotation) === UserSelectAction.EDIT : editable
      }))
    });

    if (annotations.length !== ids.length)
      console.warn('Invalid selection', idOrIds);
  }

  const removeFromSelection = (ids: string[]) => {
    if (isEmpty())
      return;

    const { selected } = selection.get();
    if (selected.some(s => ids.includes(s.id)))
      selection.set({ selected: selected.filter(s => !ids.includes(s.id)) });
  }

  const setUserSelectAction = (action: UserSelectActionExpression<E> | undefined) => {
    currentUserSelectAction = action;
    setSelected(selection.get().selected.map(s => s.id));
  }

  // Deselect annotations that get deleted from the store
  store.observe(({ changes }) => removeFromSelection((changes.deleted || []).map(a => a.id)));

  return {
    get event() {
      return selection.get().event;
    },
    get selected() {
      return [...selection.get().selected];
    },
    get userSelectAction() {
      return currentUserSelectAction;
    },
    clear,
    evalSelectAction,
    isEmpty,
    isSelected,
    setSelected,
    setUserSelectAction,
    subscribe: selection.subscribe.bind(selection),
    userSelect
  };

}

export const onUserSelect = <I extends Annotation, E extends unknown>(
  annotation: I,
  action?: UserSelectActionExpression<E>,
  adapter?: FormatAdapter<I, E>
): UserSelectAction => {
  const crosswalked = adapter ? adapter.serialize(annotation) : annotation as unknown as E;
  return typeof action === 'function' ? action(crosswalked) : (action || UserSelectAction.EDIT);
}
