import { describe, expect, it } from 'vitest';
import { createBox } from '../src/geometry';
import { moveBox, resizeBoxByCorner, rotateBoxTowards } from '../src/tools/box-geometry-ops';

describe('resizeBoxByCorner', () => {

  it('resizes an axis-aligned box, keeping the opposite corner fixed', () => {
    const box = createBox(0, 0, 100, 100);
    const resized = resizeBoxByCorner(box, 'se', [150, 120]);

    expect(resized.geometry).toMatchObject({ x: 0, y: 0, w: 150, h: 120 });
  });

  it('flips correctly when dragging a corner past the opposite one', () => {
    const box = createBox(0, 0, 100, 100);
    // Dragging the se corner up past the nw corner (0,0)
    const resized = resizeBoxByCorner(box, 'se', [-20, -10]);

    expect(resized.geometry).toMatchObject({ x: -20, y: -10, w: 20, h: 10 });
  });

  it('resizes a rotated box along its own local axes, not the screen axes', () => {
    // 90-degree rotated box: its own "local" x axis now points in world +y,
    // and its local y axis points in world -x (given our rotation convention)
    const box = createBox(0, 0, 100, 100, Math.PI / 2);

    // The box's own se corner (local frame: 100,100) - after a 90-degree
    // rotation around the center (50,50) - lands at world (0, 100).
    const seCornerWorld: [number, number] = [0, 100];
    const resized = resizeBoxByCorner(box, 'se', seCornerWorld);

    // Dragging the box's own se corner exactly onto itself should be a no-op
    expect(resized.geometry.w).toBeCloseTo(100, 6);
    expect(resized.geometry.h).toBeCloseTo(100, 6);
    expect(resized.geometry.rot).toBeCloseTo(Math.PI / 2, 6);
  });

});

describe('rotateBoxTowards', () => {

  it('leaves rotation at 0 when pointing straight up from center', () => {
    const box = createBox(0, 0, 100, 100);
    const rotated = rotateBoxTowards(box, [50, -50]); // straight up from center (50,50)

    // createBox drops a falsy `rot` (0 and undefined mean the same thing:
    // "no rotation" - every consumer in this codebase treats them the same)
    expect(rotated.geometry.rot ?? 0).toBeCloseTo(0, 6);
  });

  it('rotates 90 degrees when pointing to the right of center', () => {
    const box = createBox(0, 0, 100, 100);
    const rotated = rotateBoxTowards(box, [200, 50]); // straight right from center (50,50)

    expect(rotated.geometry.rot).toBeCloseTo(Math.PI / 2, 6);
  });

  it('does not change position or size, only rotation', () => {
    const box = createBox(10, 20, 100, 50);
    const rotated = rotateBoxTowards(box, [1000, 1000]);

    expect(rotated.geometry).toMatchObject({ x: 10, y: 20, w: 100, h: 50 });
  });

});

describe('moveBox', () => {

  it('translates position, keeping size and rotation', () => {
    const box = createBox(10, 10, 50, 50, 0.3);
    const moved = moveBox(box, 5, -5);

    expect(moved.geometry).toMatchObject({ x: 15, y: 5, w: 50, h: 50, rot: 0.3 });
  });

});
