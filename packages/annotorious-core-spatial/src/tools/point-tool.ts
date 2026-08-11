import { createPoint } from '../geometry';
import type { Point } from '../geometry';
import type { DrawingTool, ToolContext } from './drawing-tool';

/** Single-click point placement, with a live "ghost" preview while hovering. **/
export const createPointTool = (ctx: ToolContext<Point>): DrawingTool => {

  const onPointerDown = (event: PointerEvent) => {
    const [x, y] = ctx.snapping ? ctx.snapping.snap(ctx.toLocalCoordinates(event)) : ctx.toLocalCoordinates(event);
    ctx.onComplete(createPoint(x, y));
  }

  const onPointerMove = (event: PointerEvent) => {
    const [x, y] = ctx.snapping ? ctx.snapping.snap(ctx.toLocalCoordinates(event)) : ctx.toLocalCoordinates(event);
    ctx.onChange(createPoint(x, y));
  }

  const onPointerUp = () => {}

  const cancel = () => ctx.onChange(undefined);

  const destroy = () => ctx.onChange(undefined);

  return { onPointerDown, onPointerMove, onPointerUp, cancel, destroy };

}
