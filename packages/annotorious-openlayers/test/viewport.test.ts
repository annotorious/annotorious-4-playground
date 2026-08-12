import { describe, expect, it } from 'vitest';
import type Map from 'ol/Map.js';
import View from 'ol/View.js';
import { eventToWorld, getRenderViewport, pixelToWorld, worldToPixel } from '../src/viewport';
import { createImageProjection } from '../src/projection';

const WIDTH = 1000;
const HEIGHT = 800;

/**
 * `pixelToWorld`/`worldToPixel`/`eventToWorld` are thin wrappers around
 * `Map#getCoordinateFromPixel`/`getPixelFromCoordinate`/`getEventCoordinate`
 * plus a Y-flip - the flip is the only logic this package owns here; the
 * pixel<->coordinate transform itself is OL's own internal frame-state
 * machinery, which requires an actually-rendered map (a real canvas) to
 * compute - not practical in jsdom without native canvas support, and not
 * this package's logic to verify anyway. A minimal stub satisfying just the
 * methods these functions call lets the Y-flip be tested in isolation, in
 * plain Node, without needing OL to render anything. The real end-to-end
 * pixel<->world<->pixel path (through OL's actual transform) is verified
 * against a live browser instead - see the plan's Part G checklist.
 */
const stubMap = (overrides: Partial<{
  getCoordinateFromPixel: (pixel: number[]) => number[],
  getPixelFromCoordinate: (coord: number[]) => number[],
  getEventCoordinate: (event: PointerEvent) => number[]
}>) => ({
  getCoordinateFromPixel: overrides.getCoordinateFromPixel ?? (([x, y]) => [x, y]),
  getPixelFromCoordinate: overrides.getPixelFromCoordinate ?? (([x, y]) => [x, y]),
  getEventCoordinate: overrides.getEventCoordinate ?? (() => [0, 0]),
  getEventPixel: () => [0, 0]
}) as unknown as Map;

describe('pixelToWorld', () => {

  it('negates Y from whatever the map reports as the coordinate', () => {
    const map = stubMap({ getCoordinateFromPixel: () => [12, 34] });
    expect(pixelToWorld(map, [0, 0])).toEqual([12, -34]);
  });

  it('passes the pixel through to the map unchanged', () => {
    const seen: number[][] = [];
    const map = stubMap({ getCoordinateFromPixel: (pixel) => { seen.push(pixel); return [0, 0]; } });
    pixelToWorld(map, [7, 9]);
    expect(seen).toEqual([[7, 9]]);
  });

});

describe('worldToPixel', () => {

  it('negates Y before asking the map for a pixel', () => {
    const seen: number[][] = [];
    const map = stubMap({ getPixelFromCoordinate: (coord) => { seen.push(coord); return [0, 0]; } });
    worldToPixel(map, [12, 34]);
    expect(seen).toEqual([[12, -34]]);
  });

  it('returns the map-reported pixel unchanged', () => {
    const map = stubMap({ getPixelFromCoordinate: () => [99, 100] });
    expect(worldToPixel(map, [0, 0])).toEqual([99, 100]);
  });

});

describe('eventToWorld', () => {

  it('negates Y from the map-resolved event coordinate', () => {
    const map = stubMap({ getEventCoordinate: () => [5, 6] });
    expect(eventToWorld(map, new PointerEvent('pointermove'))).toEqual([5, -6]);
  });

});

describe('getRenderViewport', () => {

  // Unlike the pixel/coordinate functions above, resolution/extent come
  // straight off the View and need no rendered frame - a real View works
  // fine headlessly.
  const makeMap = () => {
    const { projection, extent } = createImageProjection(WIDTH, HEIGHT);
    const view = new View({ projection, extent, center: [WIDTH / 2, -HEIGHT / 2], resolution: 1 });
    return { getView: () => view, getSize: () => [400, 300] } as unknown as Map;
  }

  it('reports resolution directly from the view', () => {
    expect(getRenderViewport(makeMap()).resolution).toBe(1);
  });

  it('reports Y-flipped, axis-correct world bounds', () => {
    const { bounds } = getRenderViewport(makeMap());

    // Center is (WIDTH/2, -HEIGHT/2) in OL space = (WIDTH/2, HEIGHT/2) in
    // world space; container is 400x300 at resolution 1, so the visible
    // world-space window is centered there with that width/height.
    expect(bounds.minX).toBeCloseTo(WIDTH / 2 - 200, 6);
    expect(bounds.maxX).toBeCloseTo(WIDTH / 2 + 200, 6);
    expect(bounds.minY).toBeCloseTo(HEIGHT / 2 - 150, 6);
    expect(bounds.maxY).toBeCloseTo(HEIGHT / 2 + 150, 6);
    expect(bounds.minY).toBeLessThan(bounds.maxY); // sanity: not accidentally swapped
  });

  it('throws a clear error if the view has no resolution set', () => {
    const view = new View(); // no center/resolution/extent - not fully configured
    const map = { getView: () => view, getSize: () => [400, 300] } as unknown as Map;
    expect(() => getRenderViewport(map)).toThrow(/resolution/i);
  });

});
