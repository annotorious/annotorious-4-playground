import type { Bounds, BoxGeometry, PointGeometry, PolygonGeometry } from './types';

export type Corners = [[number, number], [number, number], [number, number], [number, number]];

/** The four corners of a (possibly rotated) box, in world space - always [nw, ne, se, sw]. **/
export const boxCorners = (geom: BoxGeometry): Corners => {
  const { x, y, w, h, rot } = geom;

  if (!rot)
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

  const cx = x + w / 2;
  const cy = y + h / 2;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);

  const corner = (px: number, py: number): [number, number] => {
    const dx = px - cx;
    const dy = py - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  }

  return [corner(x, y), corner(x + w, y), corner(x + w, y + h), corner(x, y + h)];
}

export const computeBoxBounds = (geom: Omit<BoxGeometry, 'bounds'>): Bounds => {
  if (!geom.rot) {
    return { minX: geom.x, minY: geom.y, maxX: geom.x + geom.w, maxY: geom.y + geom.h };
  }

  const corners = boxCorners(geom as BoxGeometry);
  const xs = corners.map(c => c[0]);
  const ys = corners.map(c => c[1]);

  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export const computePolygonBounds = (geom: Omit<PolygonGeometry, 'bounds'>): Bounds => {
  const xs = geom.points.map(p => p[0]);
  const ys = geom.points.map(p => p[1]);

  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export const computePointBounds = (geom: Omit<PointGeometry, 'bounds'>): Bounds =>
  ({ minX: geom.x, minY: geom.y, maxX: geom.x, maxY: geom.y });
