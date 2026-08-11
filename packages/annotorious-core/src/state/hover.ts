import { atom } from 'nanostores';
import type { Annotation } from '../model';
import type { Store } from './store';

export type HoverState<T extends Annotation> = ReturnType<typeof createHoverState<T>>;

export const createHoverState = <T extends Annotation>(store: Store<T>) => {

  const hovered = atom<string | null>(null);

  // Track store delete and update events
  store.observe(({ changes }) => {
    const current = hovered.get();
    if (!current) return;

    if ((changes.deleted || []).some(a => a.id === current)) {
      hovered.set(null);
      return;
    }

    const updated = (changes.updated || []).find(({ oldValue }) => oldValue.id === current);
    if (updated)
      hovered.set(updated.newValue.id);
  });

  return {
    get current() { return hovered.get(); },
    subscribe: hovered.subscribe.bind(hovered),
    set: hovered.set.bind(hovered)
  };

}
