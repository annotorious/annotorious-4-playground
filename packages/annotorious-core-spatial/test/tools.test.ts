import { describe, expect, it, vi } from 'vitest';
import { createBoxTool } from '../src/tools/box-tool';
import { createPointTool } from '../src/tools/point-tool';
import { createPolygonTool } from '../src/tools/polygon-tool';
import type { ToolContext } from '../src/tools/drawing-tool';

// Tools only ever read clientX/clientY (for screen-space distance checks) and
// pass the event through to the host-provided toLocalCoordinates - a plain
// object is enough, no need for a real (and environment-dependent) PointerEvent.
const pointerEvent = (x: number, y: number) => ({ clientX: x, clientY: y }) as PointerEvent;
const keyEvent = (key: string) => ({ key }) as KeyboardEvent;

const makeContext = <S,>(): ToolContext<S> & { onChange: ReturnType<typeof vi.fn>, onComplete: ReturnType<typeof vi.fn> } => ({
  toLocalCoordinates: (event: PointerEvent) => [event.clientX, event.clientY],
  onChange: vi.fn(),
  onComplete: vi.fn()
});

describe('box tool', () => {

  it('draws a box from pointerdown to pointerup', () => {
    const ctx = makeContext<any>();
    const tool = createBoxTool(ctx);

    tool.onPointerDown(pointerEvent(10, 10));
    tool.onPointerMove(pointerEvent(50, 60));
    expect(ctx.onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      geometry: expect.objectContaining({ x: 10, y: 10, w: 40, h: 50 })
    }));

    tool.onPointerUp(pointerEvent(50, 60));
    expect(ctx.onComplete).toHaveBeenCalledTimes(1);
    expect(ctx.onComplete.mock.calls[0][0].geometry).toMatchObject({ x: 10, y: 10, w: 40, h: 50 });
  });

  it('normalizes a drag from bottom-right to top-left', () => {
    const ctx = makeContext<any>();
    const tool = createBoxTool(ctx);

    tool.onPointerDown(pointerEvent(50, 50));
    tool.onPointerUp(pointerEvent(10, 20));

    expect(ctx.onComplete.mock.calls[0][0].geometry).toMatchObject({ x: 10, y: 20, w: 40, h: 30 });
  });

  it('discards a negligible drag instead of completing a zero-size box', () => {
    const ctx = makeContext<any>();
    const tool = createBoxTool(ctx);

    tool.onPointerDown(pointerEvent(10, 10));
    tool.onPointerUp(pointerEvent(10, 10));

    expect(ctx.onComplete).not.toHaveBeenCalled();
  });

  it('cancels on Escape', () => {
    const ctx = makeContext<any>();
    const tool = createBoxTool(ctx);

    tool.onPointerDown(pointerEvent(10, 10));
    tool.onKeyDown!(keyEvent('Escape'));
    tool.onPointerUp(pointerEvent(50, 50));

    expect(ctx.onComplete).not.toHaveBeenCalled();
  });

  it('applies a snapping provider to both the origin and the live point', () => {
    const ctx = makeContext<any>();
    ctx.snapping = { snap: ([x, y]: [number, number]) => [Math.round(x / 10) * 10, Math.round(y / 10) * 10] };
    const tool = createBoxTool(ctx);

    tool.onPointerDown(pointerEvent(12, 8));
    tool.onPointerUp(pointerEvent(47, 53));

    expect(ctx.onComplete.mock.calls[0][0].geometry).toMatchObject({ x: 10, y: 10, w: 40, h: 40 });
  });

});

describe('point tool', () => {

  it('completes immediately on pointerdown', () => {
    const ctx = makeContext<any>();
    const tool = createPointTool(ctx);

    tool.onPointerDown(pointerEvent(5, 7));
    expect(ctx.onComplete).toHaveBeenCalledTimes(1);
    expect(ctx.onComplete.mock.calls[0][0].geometry).toMatchObject({ x: 5, y: 7 });
  });

  it('shows a live ghost preview on hover, before any click', () => {
    const ctx = makeContext<any>();
    const tool = createPointTool(ctx);

    tool.onPointerMove(pointerEvent(1, 2));
    expect(ctx.onChange).toHaveBeenCalledWith(expect.objectContaining({
      geometry: expect.objectContaining({ x: 1, y: 2 })
    }));
    expect(ctx.onComplete).not.toHaveBeenCalled();
  });

});

describe('polygon tool', () => {

  it('adds a vertex per click and completes on Enter', () => {
    const ctx = makeContext<any>();
    const tool = createPolygonTool(ctx);

    tool.onPointerDown(pointerEvent(0, 0));
    tool.onPointerDown(pointerEvent(100, 0));
    tool.onPointerDown(pointerEvent(50, 100));
    tool.onKeyDown!(keyEvent('Enter'));

    expect(ctx.onComplete).toHaveBeenCalledTimes(1);
    expect(ctx.onComplete.mock.calls[0][0].geometry.points).toEqual([[0, 0], [100, 0], [50, 100]]);
  });

  it('closes the polygon when clicking back near the first vertex', () => {
    const ctx = makeContext<any>();
    const tool = createPolygonTool(ctx);

    tool.onPointerDown(pointerEvent(0, 0));
    tool.onPointerDown(pointerEvent(100, 0));
    tool.onPointerDown(pointerEvent(50, 100));
    tool.onPointerDown(pointerEvent(2, 2)); // within CLOSE_THRESHOLD_PX of (0,0)

    expect(ctx.onComplete).toHaveBeenCalledTimes(1);
    expect(ctx.onComplete.mock.calls[0][0].geometry.points).toEqual([[0, 0], [100, 0], [50, 100]]);
  });

  it('does not close with fewer than 3 vertices, even when clicking on the first', () => {
    const ctx = makeContext<any>();
    const tool = createPolygonTool(ctx);

    tool.onPointerDown(pointerEvent(0, 0));
    tool.onPointerDown(pointerEvent(1, 1)); // would be "close" to (0,0), but only 1 vertex exists so far

    expect(ctx.onComplete).not.toHaveBeenCalled();
  });

  it('removes the last vertex on Backspace', () => {
    const ctx = makeContext<any>();
    const tool = createPolygonTool(ctx);

    tool.onPointerDown(pointerEvent(0, 0));
    tool.onPointerDown(pointerEvent(100, 0));
    tool.onPointerDown(pointerEvent(999, 999)); // a mistaken vertex
    tool.onKeyDown!(keyEvent('Backspace')); // undo the mistake
    tool.onPointerDown(pointerEvent(50, 100));
    tool.onKeyDown!(keyEvent('Enter'));

    expect(ctx.onComplete.mock.calls[0][0].geometry.points).toEqual([[0, 0], [100, 0], [50, 100]]);
  });

  it('cancels the whole shape on Escape', () => {
    const ctx = makeContext<any>();
    const tool = createPolygonTool(ctx);

    tool.onPointerDown(pointerEvent(0, 0));
    tool.onPointerDown(pointerEvent(100, 0));
    tool.onKeyDown!(keyEvent('Escape'));

    expect(ctx.onChange).toHaveBeenLastCalledWith(undefined);
    tool.onKeyDown!(keyEvent('Enter'));
    expect(ctx.onComplete).not.toHaveBeenCalled();
  });

});
