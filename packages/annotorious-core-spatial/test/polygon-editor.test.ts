import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPolygon } from '../src/geometry';
import { createPolygonEditor } from '../src/tools/polygon-editor';
import type { EditorContext } from '../src/tools/shape-editor';

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

afterEach(() => container.remove());

const vertexHandles = (container: HTMLElement) =>
  [...container.querySelectorAll('[role="button"]')].filter(h => h.getAttribute('aria-label')!.startsWith('Polygon vertex')) as HTMLElement[];

describe('polygon editor', () => {

  it('mounts a move handle and one handle per vertex', () => {
    const ctx = makeContext();
    const editor = createPolygonEditor(ctx);
    editor.mount(container, createPolygon([[0, 0], [100, 0], [50, 100]]), IDENTITY);

    const handles = container.querySelectorAll('[role="button"]');
    expect(handles).toHaveLength(4);
    expect([...handles].map(h => h.getAttribute('aria-label'))).toContain('Move shape');

    const vertices = vertexHandles(container);
    expect(vertices).toHaveLength(3);
    expect(vertices[0]!.getAttribute('aria-label')).toBe('Polygon vertex 1 of 3');

    editor.destroy();
  });

  it('drags a vertex to a new position', () => {
    const ctx = makeContext();
    const editor = createPolygonEditor(ctx);
    editor.mount(container, createPolygon([[0, 0], [100, 0], [50, 100]]), IDENTITY);

    const first = vertexHandles(container)[0]!;
    first.setPointerCapture = vi.fn();
    first.releasePointerCapture = vi.fn();

    first.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 0, clientY: 0, bubbles: true }));
    first.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 5, clientY: 5, bubbles: true }));

    expect(ctx.onChange).toHaveBeenCalledWith(expect.objectContaining({
      geometry: expect.objectContaining({ points: [[5, 5], [100, 0], [50, 100]] })
    }));

    editor.destroy();
  });

  it('keeps the same DOM element for a vertex handle across an update (regression)', () => {
    // A drag isn't done in one pointermove - the host feeds each reported
    // shape straight back into the editor via update() as the gesture
    // continues (see e.g. the OpenSeadragon package's deck-overlay.ts,
    // which re-renders off the same store change update() responds to). If
    // a vertex's handle were keyed by its own (mutable, dragged) point
    // value rather than its stable index in the array, that re-render
    // would destroy and recreate the very element the browser has pointer
    // capture on - silently ending the drag after one frame. jsdom doesn't
    // implement pointer capture at all, so this checks the actual
    // observable cause directly: the DOM node itself must be the same
    // object before and after, not just visually similar.
    const ctx = makeContext();
    const editor = createPolygonEditor(ctx);
    editor.mount(container, createPolygon([[0, 0], [100, 0], [50, 100]]), IDENTITY);

    const before = vertexHandles(container)[0]!;
    editor.update(createPolygon([[5, 5], [100, 0], [50, 100]]), IDENTITY);
    const after = vertexHandles(container)[0]!;

    expect(after).toBe(before);

    editor.destroy();
  });

  it('refuses to drop below 3 vertices via Delete', () => {
    const ctx = makeContext();
    const editor = createPolygonEditor(ctx);
    editor.mount(container, createPolygon([[0, 0], [100, 0], [50, 100]]), IDENTITY);

    const first = vertexHandles(container)[0]!;
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));

    expect(ctx.onChange).not.toHaveBeenCalled();
    editor.destroy();
  });

  it('removes a vertex via Delete when above the minimum', () => {
    const ctx = makeContext();
    const editor = createPolygonEditor(ctx);
    editor.mount(container, createPolygon([[0, 0], [100, 0], [50, 100], [0, 100]]), IDENTITY);

    const first = vertexHandles(container)[0]!;
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));

    expect(ctx.onChange).toHaveBeenCalledWith(expect.objectContaining({
      geometry: expect.objectContaining({ points: [[100, 0], [50, 100], [0, 100]] })
    }));

    editor.destroy();
  });

  it('moves all vertices on drag of the body', () => {
    const ctx = makeContext();
    const editor = createPolygonEditor(ctx);
    editor.mount(container, createPolygon([[0, 0], [100, 0], [50, 100]]), IDENTITY);

    const body = [...container.querySelectorAll('[role="button"]')]
      .find(h => h.getAttribute('aria-label') === 'Move shape') as HTMLElement;

    body.setPointerCapture = vi.fn();
    body.releasePointerCapture = vi.fn();

    body.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 50, clientY: 50, bubbles: true }));
    body.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 65, clientY: 40, bubbles: true }));

    expect(ctx.onChange).toHaveBeenCalledWith(expect.objectContaining({
      geometry: expect.objectContaining({ points: [[15, -10], [115, -10], [65, 90]] })
    }));

    body.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 65, clientY: 40, bubbles: true }));
    editor.destroy();
  });

  it('nudges all vertices on arrow-key press of the body', () => {
    const ctx = makeContext();
    const editor = createPolygonEditor(ctx);
    editor.mount(container, createPolygon([[0, 0], [100, 0], [50, 100]]), IDENTITY);

    const body = [...container.querySelectorAll('[role="button"]')]
      .find(h => h.getAttribute('aria-label') === 'Move shape') as HTMLElement;

    body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(ctx.onChange).toHaveBeenCalledWith(expect.objectContaining({
      geometry: expect.objectContaining({ points: [[1, 0], [101, 0], [51, 100]] })
    }));

    editor.destroy();
  });

  it('removes the move handle on destroy', () => {
    const ctx = makeContext();
    const editor = createPolygonEditor(ctx);
    editor.mount(container, createPolygon([[0, 0], [100, 0], [50, 100]]), IDENTITY);
    expect(container.querySelectorAll('[role="button"]')).toHaveLength(4);

    editor.destroy();
    expect(container.querySelectorAll('[role="button"]')).toHaveLength(0);
  });

});
