import { describe, expect, it, vi } from 'vitest';
import { createStore, Origin } from '../src';
import type { Annotation } from '../src';

const makeAnnotation = (id: string): Partial<Annotation> => ({
  id,
  bodies: [],
  target: { annotation: id, selector: {} }
});

describe('store', () => {

  it('adds, retrieves and deletes annotations', () => {
    const store = createStore<Annotation>();

    store.addAnnotation(makeAnnotation('a1'));
    expect(store.getAnnotation('a1')?.id).toBe('a1');
    expect(store.all()).toHaveLength(1);

    store.deleteAnnotation('a1');
    expect(store.getAnnotation('a1')).toBeUndefined();
    expect(store.all()).toHaveLength(0);
  });

  it('notifies observers with a precise diff on update', () => {
    const store = createStore<Annotation>();
    store.addAnnotation(makeAnnotation('a1'));

    const onChange = vi.fn();
    store.observe(onChange);

    store.updateAnnotation({
      ...store.getAnnotation('a1')!,
      target: { annotation: 'a1', selector: { x: 42 } }
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const event = onChange.mock.calls[0][0];
    expect(event.changes.updated).toHaveLength(1);
    expect(event.changes.updated[0].targetUpdated).toBeDefined();
  });

  it('filters observers by origin', () => {
    const store = createStore<Annotation>();

    const localOnly = vi.fn();
    store.observe(localOnly, { origin: Origin.LOCAL });

    store.addAnnotation(makeAnnotation('a1'), Origin.REMOTE);
    expect(localOnly).not.toHaveBeenCalled();

    store.addAnnotation(makeAnnotation('a2'), Origin.LOCAL);
    expect(localOnly).toHaveBeenCalledTimes(1);
  });

  it('never notifies default observers of SILENT changes', () => {
    const store = createStore<Annotation>();

    const onChange = vi.fn();
    store.observe(onChange);

    store.addAnnotation(makeAnnotation('a1'), Origin.SILENT);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('notifies the reactive `annotations` atom on mutation', () => {
    const store = createStore<Annotation>();

    const values: number[] = [];
    store.annotations.subscribe(map => values.push(map.size));

    store.addAnnotation(makeAnnotation('a1'));
    store.addAnnotation(makeAnnotation('a2'));

    expect(values).toEqual([0, 1, 2]);
  });

  it('syncAnnotations mirrors the given list, preserving surviving identity', () => {
    const store = createStore<Annotation>();
    store.addAnnotation(makeAnnotation('a1'));
    store.addAnnotation(makeAnnotation('a2'));

    store.syncAnnotations([makeAnnotation('a2'), makeAnnotation('a3')]);

    expect(store.all().map(a => a.id).sort()).toEqual(['a2', 'a3']);
  });

});
