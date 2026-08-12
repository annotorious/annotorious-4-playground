import { describe, expect, it } from 'vitest';
import { boxCorners, createBox } from '../src/geometry';
import { moveBox, resizeBoxByCorner, rotateBoxTowards } from '../src/tools/box-geometry-ops';

describe('resizeBoxByCorner', () => {

  it('resizes an axis-aligned box, keeping the opposite corner fixed', () => {
    const box = createBox(0, 0, 100, 100);
    // se corner starts at (100,100) - drag it out to (150,120)
    const resized = resizeBoxByCorner(box, 'se', [50, 20]);

    expect(resized.geometry).toMatchObject({ x: 0, y: 0, w: 150, h: 120 });
  });

  it('flips correctly when dragging a corner past the opposite one', () => {
    const box = createBox(0, 0, 100, 100);
    // se corner (100,100) dragged up past the nw corner, to (-20,-10)
    const resized = resizeBoxByCorner(box, 'se', [-120, -110]);

    expect(resized.geometry).toMatchObject({ x: -20, y: -10, w: 20, h: 10 });
  });

  it('resizes a rotated box along its own local axes, not the screen axes', () => {
    // 30-degree rotated box. A delta exactly along the box's own local +x
    // axis (i.e. the world-space direction (cos30, sin30)) should change
    // only its width, never its height.
    const box = createBox(0, 0, 100, 100, Math.PI / 6);
    const delta: [number, number] = [50 * Math.cos(Math.PI / 6), 50 * Math.sin(Math.PI / 6)];

    const resized = resizeBoxByCorner(box, 'se', delta);

    expect(resized.geometry.w).toBeCloseTo(150, 6);
    expect(resized.geometry.h).toBeCloseTo(100, 6);
    expect(resized.geometry.rot).toBeCloseTo(Math.PI / 6, 6);
  });

  it('keeps the anchor corner fixed in WORLD space across an entire gesture, not just one call', () => {
    // Regression test for the "swimming" bug: resizing must always be
    // computed from the shape as it was when the drag *started* (initialBox),
    // never from a previous call's result - otherwise the rotation pivot
    // (the box's center) silently shifts between calls, and an anchor that
    // stays fixed in *local* terms drifts in *world* terms as soon as the
    // box is rotated.
    const initialBox = createBox(0, 0, 100, 100, Math.PI / 6); // 30 degrees
    const expectedAnchor = boxCorners(initialBox.geometry)[0]; // nw - opposite of se

    // Simulate a real multi-frame drag: same initialBox every time, growing
    // cumulative delta - exactly how the editor actually calls this.
    const deltas: [number, number][] = [[10, 5], [35, 20], [70, 45], [120, 80]];

    for (const delta of deltas) {
      const resized = resizeBoxByCorner(initialBox, 'se', delta);
      const anchor = boxCorners(resized.geometry)[0];

      expect(anchor[0]).toBeCloseTo(expectedAnchor[0], 6);
      expect(anchor[1]).toBeCloseTo(expectedAnchor[1], 6);
    }
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
