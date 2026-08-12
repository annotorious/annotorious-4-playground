import { createPolygon } from '../geometry';
import type { Polygon } from '../geometry';

export const movePolygon = (polygon: Polygon, dx: number, dy: number): Polygon => {
  const points = polygon.geometry.points.map(([x, y]) => [x + dx, y + dy] as [number, number]);
  return createPolygon(points);
}
