import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { createPolygon } from '../geometry';
import type { Polygon } from '../geometry';
import type { EditorContext, ShapeEditor, ShapeEditorFactory } from './shape-editor';

const HANDLE_SIZE = 8; // constant screen pixels
const NUDGE = 1; // local units per arrow-key press
const MIN_VERTICES = 3;

const handleStyle = (screenPos: [number, number]): Record<string, string> => ({
  position: 'absolute',
  left: `${screenPos[0] - HANDLE_SIZE / 2}px`,
  top: `${screenPos[1] - HANDLE_SIZE / 2}px`,
  width: `${HANDLE_SIZE}px`,
  height: `${HANDLE_SIZE}px`,
  'pointer-events': 'auto',
  cursor: 'pointer',
  background: '#fff',
  border: '2px solid #1a73e8',
  'border-radius': '50%',
  'box-sizing': 'border-box'
});

const PolygonHandles = (props: { shape: () => Polygon, ctx: EditorContext<Polygon> }) => {
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
    downEvent.stopPropagation();
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
          style={handleStyle(ctx.toScreenCoordinates(point))}
          onPointerDown={startVertexDrag(index())}
          onKeyDown={onVertexKeyDown(index())}
        />
      )}
    </For>
  );
}

export const createPolygonEditor: ShapeEditorFactory<Polygon> = (ctx: EditorContext<Polygon>): ShapeEditor<Polygon> => {
  let dispose: (() => void) | undefined;
  const [shape, setShape] = createSignal<Polygon>(createPolygon([[0, 0], [0, 0], [0, 0]]));

  const mount = (container: HTMLElement, initial: Polygon) => {
    setShape(initial);
    container.style.position = 'absolute';
    container.style.inset = '0';
    container.style.pointerEvents = 'none';

    dispose = render(() => <PolygonHandles shape={shape} ctx={ctx} />, container);
  }

  const update = (updated: Polygon) => setShape(updated);

  const destroy = () => dispose?.();

  return { mount, update, destroy };
}
