import type { BoxGeometry, PointGeometry, PolygonGeometry, SpatialShape } from './types';
import { ShapeType } from './types';

/** Shoelace formula. **/
const polygonArea = (points: [number, number][]): number => {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % points.length]!;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** The shape's own area - a Point always has zero area. **/
export const computeArea = (shape: SpatialShape): number => {
  switch (shape.type) {
    case ShapeType.BOX:
      return shape.geometry.w * shape.geometry.h;
    case ShapeType.POLYGON:
      return polygonArea(shape.geometry.points);
    case ShapeType.POINT:
      return 0;
  }
}

const distanceToSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number): number => {
  const dx = x2 - x1;
  const dy = y2 - y1;

  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));

  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;

  return Math.hypot(px - closestX, py - closestY);
}

const distanceToRingBoundary = (px: number, py: number, points: [number, number][]): number => {
  let min = Infinity;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % points.length]!;
    min = Math.min(min, distanceToSegment(px, py, x1, y1, x2, y2));
  }
  return min;
}

/** Standard ray-casting point-in-polygon test. **/
const isInRing = (px: number, py: number, points: [number, number][]): boolean => {
  let inside = false;

  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]!;
    const [xj, yj] = points[j]!;

    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / (yj - yi) + xi);

    if (intersect)
      inside = !inside;
  }

  return inside;
}

const hitTestBox = (geom: BoxGeometry, x: number, y: number, buffer: number): boolean => {
  const { w, h, rot } = geom;

  let localX: number;
  let localY: number;

  if (!rot) {
    localX = x - geom.x;
    localY = y - geom.y;
  } else {
    // Rotate the point into the box's local (unrotated) frame around its center
    const cx = geom.x + w / 2;
    const cy = geom.y + h / 2;
    const cos = Math.cos(-rot);
    const sin = Math.sin(-rot);
    const dx = x - cx;
    const dy = y - cy;

    localX = (dx * cos - dy * sin) + w / 2;
    localY = (dx * sin + dy * cos) + h / 2;
  }

  return localX >= -buffer && localX <= w + buffer && localY >= -buffer && localY <= h + buffer;
}

const hitTestPolygon = (geom: PolygonGeometry, x: number, y: number, buffer: number): boolean =>
  isInRing(x, y, geom.points) || distanceToRingBoundary(x, y, geom.points) <= buffer;

const hitTestPoint = (geom: PointGeometry, x: number, y: number, buffer: number): boolean =>
  Math.hypot(x - geom.x, y - geom.y) <= buffer;

/** Precise hit test against the shape's actual geometry (not just its bounding box). **/
export const hitTest = (shape: SpatialShape, x: number, y: number, buffer = 0): boolean => {
  switch (shape.type) {
    case ShapeType.BOX:
      return hitTestBox(shape.geometry, x, y, buffer);
    case ShapeType.POLYGON:
      return hitTestPolygon(shape.geometry, x, y, buffer);
    case ShapeType.POINT:
      return hitTestPoint(shape.geometry, x, y, buffer);
  }
}
