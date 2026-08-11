import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { createPoint } from '../geometry';
import type { Point } from '../geometry';
import type { EditorContext, ShapeEditor, ShapeEditorFactory } from './shape-editor';

const HANDLE_SIZE = 12; // constant screen pixels
const NUDGE = 1; // local units per arrow-key press

const PointHandle = (props: { shape: () => Point, ctx: EditorContext<Point> }) => {
  const { ctx } = props;

  const startDrag = (downEvent: PointerEvent) => {
    downEvent.stopPropagation();
    const target = downEvent.currentTarget as HTMLElement;
    target.setPointerCapture(downEvent.pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      const local = ctx.toLocalCoordinates(moveEvent);
      const [x, y] = ctx.snapping ? ctx.snapping.snap(local) : local;
      ctx.onChange(createPoint(x, y));
    }

    const onUp = (upEvent: PointerEvent) => {
      target.releasePointerCapture(upEvent.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
    }

    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const delta: Record<string, [number, number]> = {
      ArrowUp: [0, -NUDGE], ArrowDown: [0, NUDGE], ArrowLeft: [-NUDGE, 0], ArrowRight: [NUDGE, 0]
    };

    const d = delta[event.key];
    if (!d) return;
    event.preventDefault();

    const { x, y } = props.shape().geometry;
    ctx.onChange(createPoint(x + d[0], y + d[1]));
  }

  const screenPos = () => ctx.toScreenCoordinates([props.shape().geometry.x, props.shape().geometry.y]);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Point annotation - drag or use arrow keys to move"
      style={{
        position: 'absolute',
        left: `${screenPos()[0] - HANDLE_SIZE / 2}px`,
        top: `${screenPos()[1] - HANDLE_SIZE / 2}px`,
        width: `${HANDLE_SIZE}px`,
        height: `${HANDLE_SIZE}px`,
        'pointer-events': 'auto',
        cursor: 'move',
        background: '#fff',
        border: '2px solid #1a73e8',
        'border-radius': '50%',
        'box-sizing': 'border-box'
      }}
      onPointerDown={startDrag}
      onKeyDown={onKeyDown}
    />
  );
}

export const createPointEditor: ShapeEditorFactory<Point> = (ctx: EditorContext<Point>): ShapeEditor<Point> => {
  let dispose: (() => void) | undefined;
  const [shape, setShape] = createSignal<Point>(createPoint(0, 0));

  const mount = (container: HTMLElement, initial: Point) => {
    setShape(initial);
    container.style.position = 'absolute';
    container.style.inset = '0';
    container.style.pointerEvents = 'none';

    dispose = render(() => <PointHandle shape={shape} ctx={ctx} />, container);
  }

  const update = (updated: Point) => setShape(updated);

  const destroy = () => dispose?.();

  return { mount, update, destroy };
}
