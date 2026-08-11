import { createPoint } from '../geometry';
import type { Point } from '../geometry';

/** https://www.w3.org/TR/annotation-model/#point-selector **/
export interface PointSelector {

  type: 'PointSelector';

  x: number;

  y: number;

}

export const isPointSelector = (selector: any): selector is PointSelector =>
  selector?.type === 'PointSelector' && typeof selector.x === 'number' && typeof selector.y === 'number';

export const parsePointSelector = (selector: PointSelector): Point =>
  createPoint(selector.x, selector.y);

export const serializePointSelector = (point: Point): PointSelector => ({
  type: 'PointSelector',
  x: point.geometry.x,
  y: point.geometry.y
});
