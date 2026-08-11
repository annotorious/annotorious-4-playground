import { describe, expect, it } from 'vitest';
import { computeArea, createBox, createPoint, createPolygon, hitTest } from '../src/geometry';

describe('geometry: box', () => {

  it('computes bounds and area for an axis-aligned box', () => {
    const box = createBox(10, 20, 100, 50);
    expect(box.geometry.bounds).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 70 });
    expect(computeArea(box)).toBe(5000);
  });

  it('hit-tests inside, outside and on the buffer edge', () => {
    const box = createBox(0, 0, 100, 100);
    expect(hitTest(box, 50, 50)).toBe(true);
    expect(hitTest(box, 150, 50)).toBe(false);
    expect(hitTest(box, 105, 50, 10)).toBe(true);
    expect(hitTest(box, 120, 50, 10)).toBe(false);
  });

  it('computes a correct bounding box for a rotated box', () => {
    // A 100x100 square rotated 45 degrees around its own center has a
    // bounding box diagonal ~= 100*sqrt(2) ~= 141.42, centered on the same point
    const box = createBox(0, 0, 100, 100, Math.PI / 4);
    const { minX, minY, maxX, maxY } = box.geometry.bounds;

    expect(maxX - minX).toBeCloseTo(141.42, 1);
    expect(maxY - minY).toBeCloseTo(141.42, 1);
    expect((minX + maxX) / 2).toBeCloseTo(50, 6);
    expect((minY + maxY) / 2).toBeCloseTo(50, 6);
  });

  it('hit-tests a rotated box correctly', () => {
    // 45-degree rotated square - its own center is always inside,
    // but its unrotated corner (100, 100) should now fall clearly outside it.
    const box = createBox(0, 0, 100, 100, Math.PI / 4);
    expect(hitTest(box, 50, 50)).toBe(true);
    expect(hitTest(box, 100, 100)).toBe(false);
  });

});

describe('geometry: polygon', () => {

  const triangle = createPolygon([[0, 0], [100, 0], [50, 100]]);

  it('computes bounds and area', () => {
    expect(triangle.geometry.bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(computeArea(triangle)).toBe(5000);
  });

  it('hit-tests inside and outside', () => {
    expect(hitTest(triangle, 50, 40)).toBe(true);
    expect(hitTest(triangle, 5, 95)).toBe(false);
  });

  it('hit-tests near the boundary only within the given buffer', () => {
    // Just outside the bottom edge (y=0), close to it
    expect(hitTest(triangle, 50, -2, 5)).toBe(true);
    expect(hitTest(triangle, 50, -10, 5)).toBe(false);
  });

});

describe('geometry: point', () => {

  it('has zero area, and is bounded to a single coordinate', () => {
    const point = createPoint(10, 10);
    expect(computeArea(point)).toBe(0);
    expect(point.geometry.bounds).toEqual({ minX: 10, minY: 10, maxX: 10, maxY: 10 });
  });

  it('is only hittable within its buffer, since it has no area of its own', () => {
    const point = createPoint(10, 10);
    expect(hitTest(point, 10, 10, 0)).toBe(true);
    expect(hitTest(point, 15, 10, 0)).toBe(false);
    expect(hitTest(point, 15, 10, 5)).toBe(true);
  });

});
