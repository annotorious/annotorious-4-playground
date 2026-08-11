import { createBox } from '../geometry';
import type { Box } from '../geometry';

export type Corner = 'nw' | 'ne' | 'se' | 'sw';

const OPPOSITE: Record<Corner, Corner> = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' };

/** The box's own 4 corners, in its local (unrotated) coordinate frame. **/
const localCorners = (box: Box): Record<Corner, [number, number]> => {
  const { x, y, w, h } = box.geometry;
  return {
    nw: [x, y],
    ne: [x + w, y],
    se: [x + w, y + h],
    sw: [x, y + h]
  };
}

/** A local/world-space point, rotated into the box's own (unrotated) local frame around its center. **/
const toBoxLocalFrame = (box: Box, point: [number, number]): [number, number] => {
  const { x, y, w, h, rot } = box.geometry;
  if (!rot) return point;

  const cx = x + w / 2;
  const cy = y + h / 2;
  const cos = Math.cos(-rot);
  const sin = Math.sin(-rot);
  const dx = point[0] - cx;
  const dy = point[1] - cy;

  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

/**
 * Resizes a box by dragging one of its corners, keeping the opposite corner
 * fixed. Resizing happens in the box's own (possibly rotated) local frame,
 * so a rotated box resizes along its own axes rather than the screen's -
 * the standard, expected behavior for resizing a rotated shape.
 */
export const resizeBoxByCorner = (box: Box, corner: Corner, pointerLocal: [number, number]): Box => {
  const dragged = toBoxLocalFrame(box, pointerLocal);
  const anchor = localCorners(box)[OPPOSITE[corner]];

  const minX = Math.min(anchor[0], dragged[0]);
  const minY = Math.min(anchor[1], dragged[1]);
  const maxX = Math.max(anchor[0], dragged[0]);
  const maxY = Math.max(anchor[1], dragged[1]);

  return createBox(minX, minY, maxX - minX, maxY - minY, box.geometry.rot);
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
