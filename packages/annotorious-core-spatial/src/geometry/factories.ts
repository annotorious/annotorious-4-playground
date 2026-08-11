import { computeBoxBounds, computePointBounds, computePolygonBounds } from './bounds';
import { ShapeType } from './types';
import type { Box, Point, Polygon } from './types';

export const createBox = (x: number, y: number, w: number, h: number, rot?: number): Box => {
  const geometry = rot ? { x, y, w, h, rot } : { x, y, w, h };
  return { type: ShapeType.BOX, geometry: { ...geometry, bounds: computeBoxBounds(geometry) } };
}

export const createPolygon = (points: [number, number][]): Polygon => {
  const geometry = { points };
  return { type: ShapeType.POLYGON, geometry: { ...geometry, bounds: computePolygonBounds(geometry) } };
}

export const createPoint = (x: number, y: number): Point => {
  const geometry = { x, y };
  return { type: ShapeType.POINT, geometry: { ...geometry, bounds: computePointBounds(geometry) } };
}
