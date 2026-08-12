import { describe, expect, it } from 'vitest';
import { createStore } from '@annotorious/core';
import { createImageIndexes } from '../src/image-indexes';
import { createBox } from '../src/geometry';
import type { SpatialAnnotation } from '../src/model';

const annotation = (id: string, source: string | undefined, x = 0, y = 0): SpatialAnnotation => ({
  id,
  bodies: [],
  target: { annotation: id, selector: createBox(x, y, 10, 10), ...(source !== undefined ? { source } : {}) }
});

describe('image indexes', () => {

  it('keeps annotations for different sources in separate indexes', () => {
    const store = createStore<SpatialAnnotation>();
    const indexes = createImageIndexes(store);

    store.addAnnotation(annotation('a1', 'image-1'));
    store.addAnnotation(annotation('a2', 'image-2'));

    expect(indexes.get('image-1')?.getAt(5, 5)).toHaveLength(1);
    expect(indexes.get('image-2')?.getAt(5, 5)).toHaveLength(1);
    expect(indexes.get('image-1')?.getAt(5, 5)[0]!.annotation).toBe('a1');
  });

  it('treats undefined source as the implicit default image', () => {
    const store = createStore<SpatialAnnotation>();
    const indexes = createImageIndexes(store);

    store.addAnnotation(annotation('a1', undefined));

    expect(indexes.get(undefined)?.getAt(5, 5)).toHaveLength(1);
    expect(indexes.sources()).toEqual([undefined]);
  });

  it('removes a deleted annotation from its index', () => {
    const store = createStore<SpatialAnnotation>();
    const indexes = createImageIndexes(store);

    store.addAnnotation(annotation('a1', 'image-1'));
    store.deleteAnnotation('a1');

    expect(indexes.get('image-1')?.getAt(5, 5)).toHaveLength(0);
  });

  it('moves an annotation between indexes when its source changes', () => {
    const store = createStore<SpatialAnnotation>();
    const indexes = createImageIndexes(store);

    store.addAnnotation(annotation('a1', 'image-1'));
    store.updateAnnotation(annotation('a1', 'image-2'));

    expect(indexes.get('image-1')?.getAt(5, 5)).toHaveLength(0);
    expect(indexes.get('image-2')?.getAt(5, 5)).toHaveLength(1);
  });

  it('updates geometry in place when the source stays the same', () => {
    const store = createStore<SpatialAnnotation>();
    const indexes = createImageIndexes(store);

    store.addAnnotation(annotation('a1', 'image-1', 0, 0));
    store.updateAnnotation(annotation('a1', 'image-1', 100, 100));

    expect(indexes.get('image-1')?.getAt(5, 5)).toHaveLength(0);
    expect(indexes.get('image-1')?.getAt(105, 105)).toHaveLength(1);
  });

  it('rebuilds an index from scratch from whatever is currently in the store', () => {
    const store = createStore<SpatialAnnotation>();
    store.addAnnotation(annotation('a1', 'image-1'));

    // Indexes created AFTER the store already has content - rebuild() is
    // how a caller catches up (see the OpenSeadragon/OpenLayers annotators'
    // construction path for images already present when they start up).
    const indexes = createImageIndexes(store);
    expect(indexes.get('image-1')).toBeUndefined();

    indexes.rebuild('image-1');
    expect(indexes.get('image-1')?.getAt(5, 5)).toHaveLength(1);
  });

});
