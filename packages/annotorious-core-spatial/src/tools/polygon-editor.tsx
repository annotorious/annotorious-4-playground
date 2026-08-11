import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { createPolygon } from '../geometry';
import type { Polygon } from '../geometry';
import type { EditorContext, EditorTransform, ShapeEditor, ShapeEditorFactory } from './shape-editor';

const HANDLE_SIZE = 8; // constant screen pixels
const BORDER_WIDTH = 2; // constant screen pixels
const NUDGE = 1; // local units per arrow-key press
const MIN_VERTICES = 3;

// See box-editor.tsx's handleStyle doc - every spatial dimension is in
// local units, divided by scale, so the ambient container transform alone
// produces a constant on-screen size.
const handleStyle = (localPos: [number, number], scale: number): Record<string, string> => {
  const size = HANDLE_SIZE / scale;
  const border = BORDER_WIDTH / scale;

  return {
    position: 'absolute',
    left: `${localPos[0] - size / 2}px`,
    top: `${localPos[1] - size / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
    'pointer-events': 'auto',
    cursor: 'pointer',
    background: '#fff',
    border: `${border}px solid #1a73e8`,
    'border-radius': '50%',
    'box-sizing': 'border-box'
  };
}

const PolygonHandles = (props: { shape: () => Polygon, transform: () => EditorTransform, ctx: EditorContext<Polygon> }) => {
  const { ctx } = props;

  const withPoint = (index: number, point: [number, number]) => {
    const points = props.shape().geometry.points.slice();
    points[index] = point;
    return createPolygon(points);
  }

  const withoutVertex = (index: number) => {
    const points = props.shape().geometry.points.filter((_, i) => i !== index);
    return createPolygon(points);
  }

  const startVertexDrag = (index: number) => (downEvent: PointerEvent) => {
    // No stopPropagation() - see box-editor.tsx's startCornerDrag doc.
    ctx.onDragStart?.();

    const target = downEvent.currentTarget as HTMLElement;
    target.setPointerCapture(downEvent.pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      const local = ctx.toLocalCoordinates(moveEvent);
      const snapped = ctx.snapping ? ctx.snapping.snap(local) : local;
      ctx.onChange(withPoint(index, snapped));
    }

    const onUp = (upEvent: PointerEvent) => {
      target.releasePointerCapture(upEvent.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      ctx.onDragEnd?.();
    }

    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  }

  const onVertexKeyDown = (index: number) => (event: KeyboardEvent) => {
    const delta: Record<string, [number, number]> = {
      ArrowUp: [0, -NUDGE], ArrowDown: [0, NUDGE], ArrowLeft: [-NUDGE, 0], ArrowRight: [NUDGE, 0]
    };

    const d = delta[event.key];
    if (d) {
      event.preventDefault();
      const [x, y] = props.shape().geometry.points[index]!;
      ctx.onChange(withPoint(index, [x + d[0], y + d[1]]));
      return;
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && props.shape().geometry.points.length > MIN_VERTICES) {
      event.preventDefault();
      ctx.onChange(withoutVertex(index));
    }
  }

  return (
    <For each={props.shape().geometry.points}>
      {(point, index) => (
        <div
          role="button"
          tabIndex={0}
          aria-label={`Polygon vertex ${index() + 1} of ${props.shape().geometry.points.length}`}
          style={handleStyle(point, props.transform().scale)}
          onPointerDown={startVertexDrag(index())}
          onKeyDown={onVertexKeyDown(index())}
        />
      )}
    </For>
  );
}

export const createPolygonEditor: ShapeEditorFactory<Polygon> = (ctx: EditorContext<Polygon>): ShapeEditor<Polygon> => {
  let dispose: (() => void) | undefined;
  let containerEl: HTMLElement | undefined;

  const [shape, setShape] = createSignal<Polygon>(createPolygon([[0, 0], [0, 0], [0, 0]]));
  const [transform, setTransform] = createSignal<EditorTransform>({ scale: 1, offsetX: 0, offsetY: 0 }, { equals: false });

  const applyContainerTransform = (t: EditorTransform) => {
    if (!containerEl) return;
    containerEl.style.transform = `translate(${t.offsetX}px, ${t.offsetY}px) scale(${t.scale})`;
  }

  const mount = (container: HTMLElement, initial: Polygon, initialTransform: EditorTransform) => {
    containerEl = container;
    container.style.position = 'absolute';
    container.style.left = '0';
    container.style.top = '0';
    container.style.transformOrigin = '0 0';
    container.style.pointerEvents = 'none';

    setShape(initial);
    setTransform(initialTransform);
    applyContainerTransform(initialTransform);

    dispose = render(() => <PolygonHandles shape={shape} transform={transform} ctx={ctx} />, container);
  }

  const update = (updated: Polygon, updatedTransform: EditorTransform) => {
    applyContainerTransform(updatedTransform);
    setTransform(updatedTransform);
    setShape(updated);
  }

  const destroy = () => dispose?.();

  return { mount, update, destroy };
}
