import { createBox } from '../geometry';
import type { Box } from '../geometry';
import { CLICK_TIMEOUT_MS } from './drawing-tool';
import type { DrawingMode, DrawingTool, ToolContext } from './drawing-tool';

/**
 * Box drawing, supporting both gesture modes (see `DrawingMode`):
 * - 'drag': pointerdown starts a corner, pointerup completes it.
 * - 'click': first click sets the origin, pointermove live-resizes without
 *   the button held, second click completes it.
 */
export const createBoxTool = (ctx: ToolContext<Box>): DrawingTool => {

  const mode: DrawingMode = ctx.drawingMode || 'drag';

  let origin: [number, number] | undefined;
  let lastPointerDownAt = 0;

  const at = (event: PointerEvent): [number, number] =>
    ctx.snapping ? ctx.snapping.snap(ctx.toLocalCoordinates(event)) : ctx.toLocalCoordinates(event);

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

  const complete = (point: [number, number]) => {
    const box = boxFrom(origin!, point);
    origin = undefined;

    // A negligible drag/click (effectively a stray click) doesn't count as a shape
    if (box.geometry.w > 0 && box.geometry.h > 0)
      ctx.onComplete(box);
    else
      ctx.onChange(undefined);
  }

  const onPointerDown = (event: PointerEvent) => {
    lastPointerDownAt = performance.now();

    if (mode === 'drag')
      origin = at(event);
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!origin) return;
    ctx.onChange(boxFrom(origin, at(event)));
  }

  const onPointerUp = (event: PointerEvent) => {
    if (mode === 'click') {
      // Not a genuine click (button held too long) - ignore, whether or not
      // a shape is already in progress.
      if (performance.now() - lastPointerDownAt > CLICK_TIMEOUT_MS) return;

      if (origin) {
        complete(at(event));
      } else {
        origin = at(event);
      }
    } else if (origin) {
      complete(at(event));
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape')
      cancel();
  }

  const cancel = () => reset();

  const destroy = () => reset();

  return { onPointerDown, onPointerMove, onPointerUp, onKeyDown, cancel, destroy };

}
