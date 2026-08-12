import { describe, expect, it } from 'vitest';
import { createImageProjection } from '../src/projection';

describe('createImageProjection', () => {

  it('builds the extent per the coordinate contract: [0, -height, width, 0]', () => {
    const { extent } = createImageProjection(1000, 800);
    expect(extent).toEqual([0, -800, 1000, 0]);
  });

  it('uses pixel units', () => {
    const { projection } = createImageProjection(1000, 800);
    expect(projection.getUnits()).toBe('pixels');
  });

  it('gives each call a distinct projection code, so multiple images never collide', () => {
    const a = createImageProjection(100, 100);
    const b = createImageProjection(100, 100);
    expect(a.projection.getCode()).not.toBe(b.projection.getCode());
  });

});
