import type { AnnotationIndex } from '../annotation-index';
import { boxCorners, ShapeType } from '../geometry';
import type { SpatialShape } from '../geometry';
import type { SpatialAnnotationTarget } from '../model';

/**
 * A snapping provider adjusts a candidate point before a tool or editor
 * commits it - e.g. snapping to a grid, to nearby annotations, or (a future,
 * separate package) to detected image features. Tools and editors don't
 * need to know which kind they're using: inject whichever provider (or
 * none) into the `ToolContext`/`EditorContext`.
 */
export interface SnappingProvider {

  snap(point: [number, number]): [number, number];

}

export const createGridSnapping = (cellSize: number): SnappingProvider => ({
  snap: ([x, y]) => [Math.round(x / cellSize) * cellSize, Math.round(y / cellSize) * cellSize]
});

/** The "interesting" points of a shape that another shape's vertices might want to snap to. **/
const getSnapPoints = (shape: SpatialShape): [number, number][] => {
  switch (shape.type) {
    case ShapeType.BOX:
      return boxCorners(shape.geometry);
    case ShapeType.POLYGON:
      return shape.geometry.points;
    case ShapeType.POINT:
      return [[shape.geometry.x, shape.geometry.y]];
  }
}

/**
 * Snaps to the nearest vertex/corner of a nearby annotation, within
 * `threshold` distance (in the same units as the index's geometry).
 */
export const createNearbyAnnotationSnapping = <T extends SpatialAnnotationTarget>(
  index: AnnotationIndex<T>,
  threshold: number
): SnappingProvider => ({
  snap: ([x, y]) => {
    const candidates = index.getIntersecting({
      minX: x - threshold, minY: y - threshold, maxX: x + threshold, maxY: y + threshold
    });

    let closest: [number, number] | undefined;
    let closestDistance = threshold;

    for (const { selector } of candidates) {
      for (const point of getSnapPoints(selector)) {
        const distance = Math.hypot(point[0] - x, point[1] - y);
        if (distance <= closestDistance) {
          closest = point;
          closestDistance = distance;
        }
      }
    }

    return closest || [x, y];
  }
});
