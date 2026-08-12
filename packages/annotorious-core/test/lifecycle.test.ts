import { describe, expect, it, vi } from 'vitest';
import { createAnnotatorState, createLifecycleObserver, createUndoStack } from '../src';
import type { Annotation } from '../src';

const makeAnnotation = (id: string): Partial<Annotation> => ({
  id,
  bodies: [],
  target: { annotation: id, selector: { x: 0 } }
});

const tick = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));

const setup = () => {
  const state = createAnnotatorState<Annotation, Annotation>();
  const undoStack = createUndoStack(state.store);
  const lifecycle = createLifecycleObserver(state, undoStack, undefined);
  return { state, undoStack, lifecycle };
}

describe('lifecycle', () => {

  it('fires createAnnotation and deleteAnnotation immediately', async () => {
    const { state, lifecycle } = setup();

    const onCreate = vi.fn();
    const onDelete = vi.fn();
    lifecycle.on('createAnnotation', onCreate);
    lifecycle.on('deleteAnnotation', onDelete);

    state.store.addAnnotation(makeAnnotation('a1'));
    await tick();
    expect(onCreate).toHaveBeenCalledTimes(1);

    state.store.deleteAnnotation('a1');
    await tick();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('fires updateAnnotation immediately for body changes', async () => {
    const { state, lifecycle } = setup();
    state.store.addAnnotation(makeAnnotation('a1'));

    const onUpdate = vi.fn();
    lifecycle.on('updateAnnotation', onUpdate);

    state.store.addBody({ id: 'b1', annotation: 'a1', value: 'hello' });
    await tick();

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [current, previous] = onUpdate.mock.calls[0];
    expect(current.bodies).toHaveLength(1);
    expect(previous.bodies).toHaveLength(0);
  });

  it('batches target-only changes and reports once on deselect', async () => {
    const { state, lifecycle } = setup();
    state.store.addAnnotation(makeAnnotation('a1'));

    const onUpdate = vi.fn();
    lifecycle.on('updateAnnotation', onUpdate);

    state.selection.userSelect('a1');

    // Simulate a multi-step drag: several target updates while selected
    state.store.updateTarget({ annotation: 'a1', selector: { x: 1 } });
    state.store.updateTarget({ annotation: 'a1', selector: { x: 2 } });
    state.store.updateTarget({ annotation: 'a1', selector: { x: 3 } });
    await tick();

    // No update reported yet - the gesture is still "in progress" (selected)
    expect(onUpdate).not.toHaveBeenCalled();

    state.selection.clear();
    await tick();

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [current, previous] = onUpdate.mock.calls[0];
    expect((previous.target.selector as any).x).toBe(0);
    expect((current.target.selector as any).x).toBe(3);
  });

  it('reports target-only changes after a debounce, even if never deselected', async () => {
    // https://github.com/annotorious/annotorious/issues/566 - a host must
    // eventually hear about a completed drag/resize without requiring the
    // user to deselect, or a plugin/host that keeps a shape selected for a
    // while (or forever) would never be told about the edit.
    vi.useFakeTimers();

    const { state, lifecycle } = setup();
    state.store.addAnnotation(makeAnnotation('a1'));

    const onUpdate = vi.fn();
    lifecycle.on('updateAnnotation', onUpdate);

    state.selection.userSelect('a1');
    state.store.updateTarget({ annotation: 'a1', selector: { x: 1 } });
    state.store.updateTarget({ annotation: 'a1', selector: { x: 2 } });

    await vi.advanceTimersByTimeAsync(500);
    expect(onUpdate).not.toHaveBeenCalled(); // still within the debounce window

    await vi.advanceTimersByTimeAsync(600); // past 1000ms of inactivity since the last update
    expect(onUpdate).toHaveBeenCalledTimes(1);

    const [current, previous] = onUpdate.mock.calls[0];
    expect((previous.target.selector as any).x).toBe(0);
    expect((current.target.selector as any).x).toBe(2);

    // Still selected - the annotation-still-selected debounce path doesn't
    // interfere with normal deselect-triggered flushing for later edits.
    expect(state.selection.isSelected('a1')).toBe(true);

    vi.useRealTimers();
  });

  it('does not report anything on deselect if nothing changed', async () => {
    const { state, lifecycle } = setup();
    state.store.addAnnotation(makeAnnotation('a1'));

    const onUpdate = vi.fn();
    lifecycle.on('updateAnnotation', onUpdate);

    state.selection.userSelect('a1');
    state.selection.clear();
    await tick();

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('keeps reporting the pre-edit baseline in selectionChanged while a gesture is still pending', async () => {
    const { state, lifecycle } = setup();
    state.store.addAnnotation(makeAnnotation('a1'));
    state.store.addAnnotation(makeAnnotation('a2'));

    const onSelectionChanged = vi.fn();
    lifecycle.on('selectionChanged', onSelectionChanged);

    state.selection.userSelect('a1');
    state.store.updateTarget({ annotation: 'a1', selector: { x: 99 } });

    // Selecting a second annotation re-fires selectionChanged while a1's edit is still pending
    state.selection.setSelected(['a1', 'a2']);
    await tick();

    const lastCall = onSelectionChanged.mock.calls.at(-1)![0] as Annotation[];
    const a1Snapshot = lastCall.find(a => a.id === 'a1')!;

    // Still the pre-edit baseline (x: 0), not the live, uncommitted value (x: 99)
    expect((a1Snapshot.target.selector as any).x).toBe(0);
  });

});
