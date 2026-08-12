import { describe, expect, it } from 'vitest';
import { createPolygon } from '../src/geometry';
import { movePolygon } from '../src/tools/polygon-geometry-ops';

describe('movePolygon', () => {

  it('translates every vertex by the same delta', () => {
    const polygon = createPolygon([[0, 0], [100, 0], [50, 100]]);
    const moved = movePolygon(polygon, 5, -5);

    expect(moved.geometry.points).toEqual([[5, -5], [105, -5], [55, 95]]);
  });

});
