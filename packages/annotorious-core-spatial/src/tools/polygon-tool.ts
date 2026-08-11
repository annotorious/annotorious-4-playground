import { createPolygon } from '../geometry';
import type { Polygon } from '../geometry';
import type { DrawingTool, ToolContext } from './drawing-tool';

// Screen-space (not local/zoom-dependent) distance within which a click on
// the first vertex closes the polygon, rather than adding a new one.
const CLOSE_THRESHOLD_PX = 8;

/**
 * Click-to-add-vertex polygon drawing. Each click adds a vertex; clicking
 * back near the first vertex (or pressing Enter) closes the polygon.
 * Backspace removes the last vertex, Escape cancels the whole shape.
 */
export const createPolygonTool = (ctx: ToolContext<Polygon>): DrawingTool => {

  let vertices: [number, number][] = [];
  let firstVertexScreen: [number, number] | undefined;

  const snap = (event: PointerEvent): [number, number] => {
    const local = ctx.toLocalCoordinates(event);
    return ctx.snapping ? ctx.snapping.snap(local) : local;
  }

  const preview = (extra?: [number, number]) => {
    const points = extra ? [...vertices, extra] : vertices;
    ctx.onChange(points.length >= 2 ? createPolygon(points) : undefined);
  }

  const reset = () => {
    vertices = [];
    firstVertexScreen = undefined;
    ctx.onChange(undefined);
  }

  const complete = () => {
    if (vertices.length < 3) return;
    const polygon = createPolygon(vertices);
    vertices = [];
    firstVertexScreen = undefined;
    ctx.onComplete(polygon);
  }

  const onPointerDown = (event: PointerEvent) => {
    const point = snap(event);
    const screen: [number, number] = [event.clientX, event.clientY];

    if (vertices.length === 0) {
      vertices = [point];
      firstVertexScreen = screen;
      preview();
      return;
    }

    const distanceToFirst = firstVertexScreen ? Math.hypot(screen[0] - firstVertexScreen[0], screen[1] - firstVertexScreen[1]) : Infinity;

    if (vertices.length >= 3 && distanceToFirst <= CLOSE_THRESHOLD_PX) {
      complete();
    } else {
      vertices = [...vertices, point];
      preview();
    }
  }

  const onPointerMove = (event: PointerEvent) => {
    if (vertices.length === 0) return;
    preview(snap(event));
  }

  const onPointerUp = () => {}

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      cancel();
    } else if (event.key === 'Enter') {
      complete();
    } else if (event.key === 'Backspace') {
      if (vertices.length <= 1) {
        reset();
      } else {
        vertices = vertices.slice(0, -1);
        preview();
      }
    }
  }

  const cancel = () => reset();

  const destroy = () => reset();

  return { onPointerDown, onPointerMove, onPointerUp, onKeyDown, cancel, destroy };

}
