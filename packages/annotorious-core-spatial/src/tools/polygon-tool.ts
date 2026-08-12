import { createPolygon } from '../geometry';
import type { Polygon } from '../geometry';
import type { DrawingTool, ToolContext } from './drawing-tool';
import type { ToolHint } from './tool-hint';

// Screen-space (not local/zoom-dependent) distance within which a click on
// the first vertex closes the polygon, rather than adding a new one - also
// what drives the "closable" hint variant, so the marker's own reactive
// state always matches what a click would actually do.
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

  const isNearFirstVertex = (screen: [number, number]): boolean =>
    vertices.length >= 3 && !!firstVertexScreen &&
    Math.hypot(screen[0] - firstVertexScreen[0], screen[1] - firstVertexScreen[1]) <= CLOSE_THRESHOLD_PX;

  // Full current hint set, not a diff - mirrors onChange. The start-vertex
  // marker is always shown once drawing has begun (so the user always knows
  // where closing the shape will connect back to); it only switches to the
  // "active"/closable variant once the pointer is actually within
  // click-to-close range. The dashed edge tracks the live cursor position,
  // so it's only there once a pointermove has supplied one.
  const updateHints = (cursor?: [number, number], closable = false) => {
    if (vertices.length === 0) {
      ctx.onHint?.([]);
      return;
    }

    const hints: ToolHint[] = [
      { type: 'point', position: vertices[0]!, variant: closable ? 'active' : 'default' }
    ];

    if (cursor) hints.push({ type: 'line', from: vertices[vertices.length - 1]!, to: cursor, dashed: true });

    ctx.onHint?.(hints);
  }

  const preview = (extra?: [number, number]) => {
    const points = extra ? [...vertices, extra] : vertices;
    ctx.onChange(points.length >= 2 ? createPolygon(points) : undefined);
  }

  const reset = () => {
    vertices = [];
    firstVertexScreen = undefined;
    ctx.onChange(undefined);
    ctx.onHint?.([]);
  }

  const complete = () => {
    if (vertices.length < 3) return;
    const polygon = createPolygon(vertices);
    vertices = [];
    firstVertexScreen = undefined;
    ctx.onHint?.([]);
    ctx.onComplete(polygon);
  }

  const onPointerDown = (event: PointerEvent) => {
    const point = snap(event);
    const screen: [number, number] = [event.clientX, event.clientY];

    if (vertices.length === 0) {
      vertices = [point];
      firstVertexScreen = screen;
      preview();
      updateHints();
      return;
    }

    if (isNearFirstVertex(screen)) {
      complete();
    } else {
      vertices = [...vertices, point];
      preview();
      updateHints();
    }
  }

  const onPointerMove = (event: PointerEvent) => {
    if (vertices.length === 0) return;

    const point = snap(event);
    const screen: [number, number] = [event.clientX, event.clientY];

    preview(point);
    updateHints(point, isNearFirstVertex(screen));
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
        updateHints();
      }
    }
  }

  const cancel = () => reset();

  const destroy = () => reset();

  return { onPointerDown, onPointerMove, onPointerUp, onKeyDown, cancel, destroy };

}
