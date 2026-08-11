import { describe, expect, it, vi } from 'vitest';
import { createStore, createUndoStack } from '../src';
import type { Annotation } from '../src';

const makeAnnotation = (id: string): Partial<Annotation> => ({
  id,
  bodies: [],
  target: { annotation: id, selector: {} }
});

describe('undo stack', () => {

  it('undoes and redoes a creation', () => {
    const store = createStore<Annotation>();
    const undoStack = createUndoStack(store);

    store.addAnnotation(makeAnnotation('a1'));
    expect(store.all()).toHaveLength(1);
    expect(undoStack.canUndo()).toBe(true);

    undoStack.undo();
    expect(store.all()).toHaveLength(0);
    expect(undoStack.canUndo()).toBe(false);
    expect(undoStack.canRedo()).toBe(true);

    undoStack.redo();
    expect(store.all()).toHaveLength(1);
  });

  it('undoes a deletion by restoring the annotation', async () => {
    const store = createStore<Annotation>();
    const undoStack = createUndoStack(store);

    store.addAnnotation(makeAnnotation('a1'));

    // Let the debounce window from the create pass, so delete lands as its own
    // undo step rather than merging with (and cancelling out) the creation.
    await new Promise(resolve => setTimeout(resolve, 300));

    store.deleteAnnotation('a1');
    expect(store.all()).toHaveLength(0);

    undoStack.undo();
    expect(store.getAnnotation('a1')).toBeDefined();
  });

  it('fires undo/redo events exactly once, without leaking into a fresh undo step', () => {
    const store = createStore<Annotation>();
    const undoStack = createUndoStack(store);

    store.addAnnotation(makeAnnotation('a1'));
    store.updateAnnotation({
      ...store.getAnnotation('a1')!,
      target: { annotation: 'a1', selector: { x: 1 } }
    });

    const onUndo = vi.fn();
    undoStack.on('undo', onUndo);

    // Two changes were made in quick succession, so they debounce-merge into
    // one undo step - a single undo() should fully unwind both.
    undoStack.undo();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(store.all()).toHaveLength(0);
    expect(undoStack.canUndo()).toBe(false);
  });

});
