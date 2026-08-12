import { createBox } from '../geometry';
import type { Box } from '../geometry';

export type Corner = 'nw' | 'ne' | 'se' | 'sw';

/**
 * Rotates a *displacement vector* (not a point) into the box's own
 * (unrotated) local frame. Deliberately not "rotate this point around the
 * box's center": a vector rotation needs no pivot, which is exactly what
 * makes this safe to use as a box resizes - see the module doc below.
 */
const rotateDeltaToLocal = (dx: number, dy: number, rot: number): [number, number] => {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return [dx * cos + dy * sin, -dx * sin + dy * cos];
}

/**
 * Resizes a box by dragging one of its corners, keeping the opposite corner
 * fixed on screen - ported directly from Annotorious v3's
 * `RectangleEditor.svelte`, because the "obvious" alternative (recompute
 * from the box's current state on every pointermove) is subtly wrong for a
 * rotated box: resizing shifts the box's center, rotation is defined around
 * that center, and re-deriving the pivot from an already-moved box on every
 * frame lets the anchor corner's *world* position drift even though its
 * *local* position stayed exactly fixed - it "swims" as you drag.
 *
 * The fix is to never recompute from a moving state at all: always work
 * from `initialBox` (the box exactly as it was when the drag started,
 * captured once by the caller) plus `cumulativeDelta` (the total pointer
 * movement since then, also relative to that same fixed start - not a
 * per-frame incremental delta). The box's edges move in its own local
 * frame (found by rotating the delta *vector*, which needs no pivot), and
 * the resulting center shift is rotated the same way and added onto the
 * original (fixed, never-moving) center. Nothing here ever re-derives a
 * pivot from a value that changed on a previous call, so there's nothing
 * for rotation to compound errors into.
 */
export const resizeBoxByCorner = (initialBox: Box, corner: Corner, cumulativeDelta: [number, number]): Box => {
  const { x, y, w, h, rot = 0 } = initialBox.geometry;
  const [dx, dy] = cumulativeDelta;

  // The box's own local frame, with its own top-left at the origin
  let localX0 = 0;
  let localY0 = 0;
  let localX1 = w;
  let localY1 = h;

  const [localDx, localDy] = rot ? rotateDeltaToLocal(dx, dy, rot) : [dx, dy];

  if (corner === 'nw' || corner === 'ne') localY0 += localDy;
  if (corner === 'sw' || corner === 'se') localY1 += localDy;
  if (corner === 'nw' || corner === 'sw') localX0 += localDx;
  if (corner === 'ne' || corner === 'se') localX1 += localDx;

  // The center shifts as edges move - track it in local space first
  const newLocalCx = (localX0 + localX1) / 2;
  const newLocalCy = (localY0 + localY1) / 2;

  const newW = Math.abs(localX1 - localX0);
  const newH = Math.abs(localY1 - localY0);

  // Rotate the local center shift back into world space, and apply it to
  // the ORIGINAL (fixed) center - never to a previous call's result.
  const oldCenter: [number, number] = [x + w / 2, y + h / 2];
  const localCenterOffset: [number, number] = [newLocalCx - w / 2, newLocalCy - h / 2];

  const cos = Math.cos(rot);
  const sin = Math.sin(rot);

  const worldCx = oldCenter[0] + localCenterOffset[0] * cos - localCenterOffset[1] * sin;
  const worldCy = oldCenter[1] + localCenterOffset[0] * sin + localCenterOffset[1] * cos;

  return createBox(worldCx - newW / 2, worldCy - newH / 2, newW, newH, rot);
}

/**
 * Rotates a box so that its "up" axis points toward `pointerLocal`, pivoting
 * around the box's own center. Position and size are unchanged.
 */
export const rotateBoxTowards = (box: Box, pointerLocal: [number, number]): Box => {
  const { x, y, w, h } = box.geometry;
  const cx = x + w / 2;
  const cy = y + h / 2;

  const rot = Math.atan2(pointerLocal[0] - cx, -(pointerLocal[1] - cy));
  return createBox(x, y, w, h, rot);
}

export const moveBox = (box: Box, dx: number, dy: number): Box => {
  const { x, y, w, h, rot } = box.geometry;
  return createBox(x + dx, y + dy, w, h, rot);
}
