import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boxCorners, createBox } from '../src/geometry';
import { createBoxEditor } from '../src/tools/box-editor';
import type { EditorContext } from '../src/tools/shape-editor';

// A trivial 1:1 identity transform - screen space === local space - so
// expectations can be written directly in local units.
const IDENTITY = { scale: 1, offsetX: 0, offsetY: 0 };

const makeContext = () => ({
  toLocalCoordinates: (event: PointerEvent) => [event.clientX, event.clientY] as [number, number],
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

  it('mounts a move handle, 4 corner handles and a rotate handle, with ARIA labels', () => {
    const ctx = makeContext();
    const editor = createBoxEditor(ctx);
    editor.mount(container, createBox(0, 0, 100, 100), IDENTITY);

    const handles = container.querySelectorAll('[role="button"]');
    expect(handles).toHaveLength(6);

    const labels = [...handles].map(h => h.getAttribute('aria-label'));
    expect(labels).toContain('Move shape');
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
    editor.mount(container, createBox(10, 20, 100, 50), IDENTITY);

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
    editor.mount(container, createBox(0, 0, 100, 100), IDENTITY);

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

  it('keeps the anchor corner fixed through a multi-step resize drag on a rotated box (regression)', () => {
    const ctx = makeContext();
    const editor = createBoxEditor(ctx);

    const initial = createBox(0, 0, 100, 100, Math.PI / 6); // 30 degrees
    const expectedAnchor = boxCorners(initial.geometry)[0]; // nw - opposite of se

    editor.mount(container, initial, IDENTITY);

    const se = [...container.querySelectorAll('[role="button"]')]
      .find(h => h.getAttribute('aria-label') === 'Resize handle, bottom-right corner') as HTMLElement;
    se.setPointerCapture = vi.fn();
    se.releasePointerCapture = vi.fn();

    // The se handle's own screen position, at the actual (rotated) se corner
    const seStart = boxCorners(initial.geometry)[2];

    se.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: seStart[0], clientY: seStart[1], bubbles: true }));

    // Several successive moves, further and further from the start - exactly
    // how a real drag calls this repeatedly while the gesture is in progress.
    // NOTE: this deliberately does NOT call editor.update() in between, the
    // same way the real synchronous render pipeline wouldn't introduce any
    // extra state between one pointermove and the next.
    for (const [dx, dy] of [[10, 5], [25, 15], [40, 30]]) {
      se.dispatchEvent(new PointerEvent('pointermove', {
        pointerId: 1, clientX: seStart[0] + dx, clientY: seStart[1] + dy, bubbles: true
      }));

      const lastShape = ctx.onChange.mock.calls.at(-1)![0];
      const anchor = boxCorners(lastShape.geometry)[0];

      expect(anchor[0]).toBeCloseTo(expectedAnchor[0], 6);
      expect(anchor[1]).toBeCloseTo(expectedAnchor[1], 6);
    }

    se.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: seStart[0] + 40, clientY: seStart[1] + 30, bubbles: true }));
    editor.destroy();
  });

  it('moves on drag of the body, keeping size and rotation', () => {
    const ctx = makeContext();
    const editor = createBoxEditor(ctx);
    editor.mount(container, createBox(10, 10, 100, 50, 0.3), IDENTITY);

    const body = [...container.querySelectorAll('[role="button"]')]
      .find(h => h.getAttribute('aria-label') === 'Move shape') as HTMLElement;

    body.setPointerCapture = vi.fn();
    body.releasePointerCapture = vi.fn();

    body.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 50, clientY: 50, bubbles: true }));
    body.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 65, clientY: 40, bubbles: true }));

    expect(ctx.onChange).toHaveBeenCalledWith(expect.objectContaining({
      geometry: expect.objectContaining({ x: 25, y: 0, w: 100, h: 50, rot: 0.3 })
    }));

    body.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 65, clientY: 40, bubbles: true }));
    editor.destroy();
  });

  it('nudges a corner with arrow keys', () => {
    const ctx = makeContext();
    const editor = createBoxEditor(ctx);
    editor.mount(container, createBox(0, 0, 100, 100), IDENTITY);

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
    editor.mount(container, createBox(0, 0, 100, 100), IDENTITY);

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
    editor.mount(container, createBox(0, 0, 100, 100), IDENTITY);
    expect(container.querySelectorAll('[role="button"]')).toHaveLength(6);

    editor.destroy();
    expect(container.querySelectorAll('[role="button"]')).toHaveLength(0);
  });

});
