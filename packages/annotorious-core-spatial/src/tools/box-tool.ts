import { createBox } from '../geometry';
import type { Box } from '../geometry';
import type { DrawingTool, ToolContext } from './drawing-tool';

/** Click-and-drag box drawing: pointerdown starts a corner, pointerup completes it. **/
export const createBoxTool = (ctx: ToolContext<Box>): DrawingTool => {

  let origin: [number, number] | undefined;

  const boxFrom = (a: [number, number], b: [number, number]): Box => createBox(
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.abs(b[0] - a[0]),
    Math.abs(b[1] - a[1])
  );

  const reset = () => {
    origin = undefined;
    ctx.onChange(undefined);
  }

  const onPointerDown = (event: PointerEvent) => {
    origin = ctx.snapping ? ctx.snapping.snap(ctx.toLocalCoordinates(event)) : ctx.toLocalCoordinates(event);
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!origin) return;

    const current = ctx.snapping ? ctx.snapping.snap(ctx.toLocalCoordinates(event)) : ctx.toLocalCoordinates(event);
    ctx.onChange(boxFrom(origin, current));
  }

  const onPointerUp = (event: PointerEvent) => {
    if (!origin) return;

    const current = ctx.snapping ? ctx.snapping.snap(ctx.toLocalCoordinates(event)) : ctx.toLocalCoordinates(event);
    const box = boxFrom(origin, current);

    origin = undefined;

    // A negligible drag (effectively a stray click) doesn't count as a shape
    if (box.geometry.w > 0 && box.geometry.h > 0)
      ctx.onComplete(box);
    else
      ctx.onChange(undefined);
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape')
      cancel();
  }

  const cancel = () => reset();

  const destroy = () => reset();

  return { onPointerDown, onPointerMove, onPointerUp, onKeyDown, cancel, destroy };

}
