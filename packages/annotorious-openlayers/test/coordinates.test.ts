import { describe, expect, it } from 'vitest';
import type Map from 'ol/Map.js';
import { createImageTransforms, getEditorTransform, hintToWorld, screenPixelsToLocalUnits, shapeToWorld, targetToWorld, worldBoundsToLocal } from '../src/coordinates';
import { createImageRegistry } from '../src/image-registry';
import { createBox } from '@annotorious/core-spatial';
import type { SpatialAnnotationTarget, ToolHint } from '@annotorious/core-spatial';

const image = createImageRegistry({ width: 1000, height: 800 }).get(undefined)!;

describe('single-image identity transforms (world == local)', () => {

  it('shapeToWorld returns the exact same shape reference', () => {
    const box = createBox(1, 2, 3, 4);
    expect(shapeToWorld(image, box)).toBe(box);
  });

  it('targetToWorld returns the exact same target reference', () => {
    const target: SpatialAnnotationTarget = { annotation: 'a1', selector: createBox(0, 0, 10, 10) };
    expect(targetToWorld(image, target)).toBe(target);
  });

  it('hintToWorld returns the exact same hint reference', () => {
    const hint: ToolHint = { type: 'point', position: [5, 5] };
    expect(hintToWorld(image, hint)).toBe(hint);
  });

  it('worldBoundsToLocal returns the exact same bounds reference', () => {
    const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(worldBoundsToLocal(image, bounds)).toBe(bounds);
  });

  it('screenPixelsToLocalUnits scales 1:1 with resolution', () => {
    expect(screenPixelsToLocalUnits(2, image, 5)).toBe(10);
    expect(screenPixelsToLocalUnits(1, image, 5)).toBe(5);
  });

});

// A map where OL (y-up) coordinate (x, y) always maps to screen pixel
// (x * 2 + 100, y * 2 + 50) - an arbitrary but easy-to-check affine
// relationship, standing in for whatever OL's real
// getPixelFromCoordinate/getCoordinateFromPixel/getEventCoordinate compute.
// `worldToPixel`/`eventToWorld` (viewport.ts) flip Y at the boundary before/
// after calling these, so their world-space (y-down) inputs/outputs differ
// from what this stub itself receives/returns.
const stubMap = (): Map => ({
  getPixelFromCoordinate: ([x, y]: number[]) => [x! * 2 + 100, y! * 2 + 50],
  getCoordinateFromPixel: ([x, y]: number[]) => [(x! - 100) / 2, (y! - 50) / 2],
  getEventCoordinate: () => [10, -20]
}) as unknown as Map;

describe('createImageTransforms', () => {

  it('toScreenCoordinates applies the map affine transform to a local point', () => {
    const { toScreenCoordinates } = createImageTransforms(stubMap(), image);
    // world (10, 20) -> flipped to OL (10, -20) -> stub affine -> (10*2+100, -20*2+50) = (120, 10)
    expect(toScreenCoordinates([10, 20])).toEqual([120, 10]);
  });

  it('toLocalCoordinates resolves a pointer event through the map, Y-flipped (world == local)', () => {
    const { toLocalCoordinates } = createImageTransforms(stubMap(), image);
    // stub's getEventCoordinate returns OL (10, -20) -> flipped back to world/local (y-down): (10, 20)
    const local = toLocalCoordinates(new PointerEvent('pointerdown'));
    expect(local).toEqual([10, 20]);
  });

});

describe('getEditorTransform', () => {

  it('derives scale from the screen distance the map affine transform produces for one local unit', () => {
    const transform = getEditorTransform(stubMap(), image);

    // stubMap's affine has a uniform scale of 2 in both axes.
    expect(transform.scale).toBeCloseTo(2, 6);
    expect(transform.offsetX).toBeCloseTo(100, 6); // toScreenCoordinates([0,0])
    expect(transform.offsetY).toBeCloseTo(50, 6);
  });

});
