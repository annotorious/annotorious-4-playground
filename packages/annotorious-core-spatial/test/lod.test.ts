import { describe, expect, it } from 'vitest';
import { classify, screenSize } from '../src/render/lod';

const boundsOf = (size: number) => ({ minX: 0, minY: 0, maxX: size, maxY: size });

describe('screenSize', () => {

  it('converts world size to screen pixels using the viewport resolution', () => {
    // A 100x100 world box, at 2 world units per pixel -> its diagonal is
    // 100*sqrt(2) world units -> 100*sqrt(2)/2 screen pixels
    expect(screenSize(boundsOf(100), 2)).toBeCloseTo((100 * Math.sqrt(2)) / 2, 6);
  });

  it('scales inversely with resolution (zooming in shrinks resolution, grows screen size)', () => {
    const bounds = boundsOf(50);
    expect(screenSize(bounds, 1)).toBeGreaterThan(screenSize(bounds, 10));
  });

});

describe('classify', () => {

  it('culls shapes below the cull threshold', () => {
    // diagonal of a 1x1 box at resolution 1 is sqrt(2) ~= 1.41, below default cullBelowPx (1.5)
    expect(classify(boundsOf(1), 1)).toBe('culled');
  });

  it('simplifies shapes between the cull and simplify thresholds', () => {
    // diagonal of a 3x3 box at resolution 1 is ~4.24, between 1.5 and default simplifyBelowPx (6)
    expect(classify(boundsOf(3), 1)).toBe('simplified');
  });

  it('renders full geometry above the simplify threshold', () => {
    expect(classify(boundsOf(100), 1)).toBe('full');
  });

  it('respects custom thresholds', () => {
    expect(classify(boundsOf(3), 1, { simplifyBelowPx: 3 })).toBe('full');
    expect(classify(boundsOf(1), 1, { cullBelowPx: 0 })).toBe('simplified');
  });

});
