import { describe, expect, it } from 'vitest';
import { createAnnotationIndex } from '../src/annotation-index';
import { createBox } from '../src/geometry';
import type { SpatialAnnotationTarget } from '../src/model';

const target = (id: string, selector: ReturnType<typeof createBox>): SpatialAnnotationTarget => ({
  annotation: id,
  selector
});

describe('annotation index', () => {

  it('prefers the smallest shape when multiple overlap at a point', () => {
    const index = createAnnotationIndex();

    const big = target('big', createBox(0, 0, 200, 200));
    const small = target('small', createBox(50, 50, 20, 20));

    index.insert(big);
    index.insert(small);

    const hits = index.getAt(55, 55);
    expect(hits.map(t => t.annotation)).toEqual(['small', 'big']);
  });

  it('rejects bbox-only candidates that miss the precise geometry', () => {
    const index = createAnnotationIndex();

    // A thin diagonal-ish box whose bounding box is much bigger than the box itself
    index.insert(target('rotated', createBox(0, 0, 100, 10, Math.PI / 4)));

    // Inside the rotated box's bounding box, but not inside the box itself
    const hits = index.getAt(90, 10);
    expect(hits).toEqual([]);
  });

  it('updates and removes correctly', () => {
    const index = createAnnotationIndex();
    const t = target('a', createBox(0, 0, 10, 10));

    index.insert(t);
    expect(index.getAt(5, 5)).toHaveLength(1);

    const moved = target('a', createBox(100, 100, 10, 10));
    index.update(t, moved);

    expect(index.getAt(5, 5)).toHaveLength(0);
    expect(index.getAt(105, 105)).toHaveLength(1);

    index.remove(moved);
    expect(index.size()).toBe(0);
  });

});
