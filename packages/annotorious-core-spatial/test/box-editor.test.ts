import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBox } from '../src/geometry';
import { createBoxEditor } from '../src/tools/box-editor';
import type { EditorContext } from '../src/tools/shape-editor';

// A trivial 1:1 identity transform - screen space === local space - so
// expectations can be written directly in local units.
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

afterEach(() => {
  container.remove();
});

describe('box editor', () => {

  it('mounts 4 corner handles and a rotate handle, with ARIA labels', () => {
    const ctx = makeContext();
    const editor = createBoxEditor(ctx);
    editor.mount(container, createBox(0, 0, 100, 100));

    const handles = container.querySelectorAll('[role="button"]');
    expect(handles).toHaveLength(5);

    const labels = [...handles].map(h => h.getAttribute('aria-label'));
    expect(labels).toContain('Resize handle, top-left corner');
    expect(labels).toContain('Resize handle, top-right corner');
    expect(labels).toContain('Resize handle, bottom-right corner');
    expect(labels).toContain('Resize handle, bottom-left corner');
    expect(labels).toContain('Rotate handle');

    editor.destroy();
  });

  it('positions the se handle at the box\'s bottom-right corner', () => {
    const ctx = makeContext();
    const editor = createBoxEditor(ctx);
    editor.mount(container, createBox(10, 20, 100, 50));

    const se = [...container.querySelectorAll('[role="button"]')]
      .find(h => h.getAttribute('aria-label') === 'Resize handle, bottom-right corner') as HTMLElement;

    // handle is centered on (110, 70), 10px wide -> left/top = center - 5
    expect(se.style.left).toBe('105px');
    expect(se.style.top).toBe('65px');

    editor.destroy();
  });

  it('resizes on drag: pointerdown on a corner, pointermove, pointerup', () => {
    const ctx = makeContext();
    const editor = createBoxEditor(ctx);
    editor.mount(container, createBox(0, 0, 100, 100));

    const se = [...container.querySelectorAll('[role="button"]')]
      .find(h => h.getAttribute('aria-label') === 'Resize handle, bottom-right corner') as HTMLElement;

    // jsdom doesn't implement pointer capture - stub it out so the handler doesn't throw
    se.setPointerCapture = vi.fn();
    se.releasePointerCapture = vi.fn();

    se.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, bubbles: true }));
    se.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 150, clientY: 120, bubbles: true }));

    expect(ctx.onChange).toHaveBeenCalledWith(expect.objectContaining({
      geometry: expect.objectContaining({ x: 0, y: 0, w: 150, h: 120 })
    }));

    se.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 150, clientY: 120, bubbles: true }));

    editor.destroy();
  });

  it('nudges a corner with arrow keys', () => {
    const ctx = makeContext();
    const editor = createBoxEditor(ctx);
    editor.mount(container, createBox(0, 0, 100, 100));

    const se = [...container.querySelectorAll('[role="button"]')]
      .find(h => h.getAttribute('aria-label') === 'Resize handle, bottom-right corner') as HTMLElement;

    se.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(ctx.onChange).toHaveBeenCalledWith(expect.objectContaining({
      geometry: expect.objectContaining({ x: 0, y: 0, w: 101, h: 100 })
    }));

    editor.destroy();
  });

  it('rotates on drag of the rotate handle', () => {
    const ctx = makeContext();
    const editor = createBoxEditor(ctx);
    editor.mount(container, createBox(0, 0, 100, 100));

    const rotate = [...container.querySelectorAll('[role="button"]')]
      .find(h => h.getAttribute('aria-label') === 'Rotate handle') as HTMLElement;

    rotate.setPointerCapture = vi.fn();
    rotate.releasePointerCapture = vi.fn();

    rotate.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 50, clientY: -50, bubbles: true }));
    // Point straight right of center (50, 50) -> 90 degrees
    rotate.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 200, clientY: 50, bubbles: true }));

    const lastCall = ctx.onChange.mock.calls.at(-1)![0];
    expect(lastCall.geometry.rot).toBeCloseTo(Math.PI / 2, 6);

    editor.destroy();
  });

  it('removes all handles on destroy', () => {
    const ctx = makeContext();
    const editor = createBoxEditor(ctx);
    editor.mount(container, createBox(0, 0, 100, 100));
    expect(container.querySelectorAll('[role="button"]')).toHaveLength(5);

    editor.destroy();
    expect(container.querySelectorAll('[role="button"]')).toHaveLength(0);
  });

});
