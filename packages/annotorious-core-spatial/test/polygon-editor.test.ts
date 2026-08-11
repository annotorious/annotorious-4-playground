import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPolygon } from '../src/geometry';
import { createPolygonEditor } from '../src/tools/polygon-editor';
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

describe('polygon editor', () => {

  it('mounts one handle per vertex', () => {
    const ctx = makeContext();
    const editor = createPolygonEditor(ctx);
    editor.mount(container, createPolygon([[0, 0], [100, 0], [50, 100]]));

    const handles = container.querySelectorAll('[role="button"]');
    expect(handles).toHaveLength(3);
    expect(handles[0]!.getAttribute('aria-label')).toBe('Polygon vertex 1 of 3');

    editor.destroy();
  });

  it('drags a vertex to a new position', () => {
    const ctx = makeContext();
    const editor = createPolygonEditor(ctx);
    editor.mount(container, createPolygon([[0, 0], [100, 0], [50, 100]]));

    const first = container.querySelectorAll('[role="button"]')[0] as HTMLElement;
    first.setPointerCapture = vi.fn();
    first.releasePointerCapture = vi.fn();

    first.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 0, clientY: 0, bubbles: true }));
    first.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 5, clientY: 5, bubbles: true }));

    expect(ctx.onChange).toHaveBeenCalledWith(expect.objectContaining({
      geometry: expect.objectContaining({ points: [[5, 5], [100, 0], [50, 100]] })
    }));

    editor.destroy();
  });

  it('refuses to drop below 3 vertices via Delete', () => {
    const ctx = makeContext();
    const editor = createPolygonEditor(ctx);
    editor.mount(container, createPolygon([[0, 0], [100, 0], [50, 100]]));

    const first = container.querySelectorAll('[role="button"]')[0] as HTMLElement;
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));

    expect(ctx.onChange).not.toHaveBeenCalled();
    editor.destroy();
  });

  it('removes a vertex via Delete when above the minimum', () => {
    const ctx = makeContext();
    const editor = createPolygonEditor(ctx);
    editor.mount(container, createPolygon([[0, 0], [100, 0], [50, 100], [0, 100]]));

    const first = container.querySelectorAll('[role="button"]')[0] as HTMLElement;
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));

    expect(ctx.onChange).toHaveBeenCalledWith(expect.objectContaining({
      geometry: expect.objectContaining({ points: [[100, 0], [50, 100], [0, 100]] })
    }));

    editor.destroy();
  });

});
