import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPoint } from '../src/geometry';
import { createPointEditor } from '../src/tools/point-editor';
import type { EditorContext } from '../src/tools/shape-editor';

const makeContext = () => ({
  toLocalCoordinates: (event: PointerEvent) => [event.clientX, event.clientY] as [number, number],
  toScreenCoordinates: (point: [number, number]) => point,
  onChange: vi.fn()
}) satisfies EditorContext<any>;

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => container.remove());

describe('point editor', () => {

  it('mounts a single draggable handle at the point', () => {
    const ctx = makeContext();
    const editor = createPointEditor(ctx);
    editor.mount(container, createPoint(10, 10));

    const handle = container.querySelector('[role="button"]') as HTMLElement;
    expect(handle).toBeTruthy();
    expect(handle.getAttribute('aria-label')).toContain('Point annotation');

    editor.destroy();
  });

  it('moves on drag', () => {
    const ctx = makeContext();
    const editor = createPointEditor(ctx);
    editor.mount(container, createPoint(10, 10));

    const handle = container.querySelector('[role="button"]') as HTMLElement;
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();

    handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 10, clientY: 10, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 42, clientY: 99, bubbles: true }));

    expect(ctx.onChange).toHaveBeenCalledWith(expect.objectContaining({
      geometry: expect.objectContaining({ x: 42, y: 99 })
    }));

    editor.destroy();
  });

  it('nudges with arrow keys', () => {
    const ctx = makeContext();
    const editor = createPointEditor(ctx);
    editor.mount(container, createPoint(10, 10));

    const handle = container.querySelector('[role="button"]') as HTMLElement;
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));

    expect(ctx.onChange).toHaveBeenCalledWith(expect.objectContaining({
      geometry: expect.objectContaining({ x: 10, y: 9 })
    }));

    editor.destroy();
  });

});
