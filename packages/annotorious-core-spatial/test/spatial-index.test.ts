import { describe, expect, it } from 'vitest';
import { createSpatialIndex } from '../src/spatial-index';

describe('spatial index', () => {

  it('inserts, queries and removes by bounds', () => {
    const index = createSpatialIndex<string>();

    index.insert('a', { minX: 0, minY: 0, maxX: 10, maxY: 10 }, 'a');
    index.insert('b', { minX: 100, minY: 100, maxX: 110, maxY: 110 }, 'b');

    expect(index.size()).toBe(2);
    expect(index.getAt(5, 5)).toEqual(['a']);
    expect(index.getAt(105, 105)).toEqual(['b']);
    expect(index.getAt(50, 50)).toEqual([]);

    index.remove('a');
    expect(index.size()).toBe(1);
    expect(index.getAt(5, 5)).toEqual([]);
  });

  it('updates in place', () => {
    const index = createSpatialIndex<string>();
    index.insert('a', { minX: 0, minY: 0, maxX: 10, maxY: 10 }, 'a');

    index.update('a', { minX: 100, minY: 100, maxX: 110, maxY: 110 }, 'a-moved');

    expect(index.size()).toBe(1);
    expect(index.getAt(5, 5)).toEqual([]);
    expect(index.getAt(105, 105)).toEqual(['a-moved']);
  });

  it('bulk-loads via set()', () => {
    const index = createSpatialIndex<string>();

    index.set([
      { id: 'a', bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, item: 'a' },
      { id: 'b', bounds: { minX: 20, minY: 20, maxX: 30, maxY: 30 }, item: 'b' }
    ]);

    expect(index.size()).toBe(2);
    expect(index.all().sort()).toEqual(['a', 'b']);
  });

  it('finds intersecting bounds', () => {
    const index = createSpatialIndex<string>();
    index.insert('a', { minX: 0, minY: 0, maxX: 10, maxY: 10 }, 'a');
    index.insert('b', { minX: 20, minY: 20, maxX: 30, maxY: 30 }, 'b');

    expect(index.getIntersecting({ minX: -5, minY: -5, maxX: 15, maxY: 15 })).toEqual(['a']);
    expect(index.getIntersecting({ minX: -5, minY: -5, maxX: 35, maxY: 35 }).sort()).toEqual(['a', 'b']);
  });

});
