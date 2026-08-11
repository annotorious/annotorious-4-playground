import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { createPoint } from '../geometry';
import type { Point } from '../geometry';
import type { EditorContext, EditorTransform, ShapeEditor, ShapeEditorFactory } from './shape-editor';

const HANDLE_SIZE = 12; // constant screen pixels
const BORDER_WIDTH = 2; // constant screen pixels
const NUDGE = 1; // local units per arrow-key press

const PointHandle = (props: { shape: () => Point, transform: () => EditorTransform, ctx: EditorContext<Point> }) => {
  const { ctx } = props;

  const startDrag = (downEvent: PointerEvent) => {
    // No stopPropagation() - see box-editor.tsx's startCornerDrag doc.
    ctx.onDragStart?.();

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
      ctx.onDragEnd?.();
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

  // See box-editor.tsx's handleStyle doc - local units divided by scale.
  const style = (): Record<string, string> => {
    const scale = props.transform().scale;
    const size = HANDLE_SIZE / scale;
    const border = BORDER_WIDTH / scale;
    const { x, y } = props.shape().geometry;

    return {
      position: 'absolute',
      left: `${x - size / 2}px`,
      top: `${y - size / 2}px`,
      width: `${size}px`,
      height: `${size}px`,
      'pointer-events': 'auto',
      cursor: 'move',
      background: '#fff',
      border: `${border}px solid #1a73e8`,
      'border-radius': '50%',
      'box-sizing': 'border-box'
    };
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Point annotation - drag or use arrow keys to move"
      style={style()}
      onPointerDown={startDrag}
      onKeyDown={onKeyDown}
    />
  );
}

export const createPointEditor: ShapeEditorFactory<Point> = (ctx: EditorContext<Point>): ShapeEditor<Point> => {
  let dispose: (() => void) | undefined;
  let containerEl: HTMLElement | undefined;

  const [shape, setShape] = createSignal<Point>(createPoint(0, 0));
  const [transform, setTransform] = createSignal<EditorTransform>({ scale: 1, offsetX: 0, offsetY: 0 }, { equals: false });

  const applyContainerTransform = (t: EditorTransform) => {
    if (!containerEl) return;
    containerEl.style.transform = `translate(${t.offsetX}px, ${t.offsetY}px) scale(${t.scale})`;
  }

  const mount = (container: HTMLElement, initial: Point, initialTransform: EditorTransform) => {
    containerEl = container;
    container.style.position = 'absolute';
    container.style.left = '0';
    container.style.top = '0';
    container.style.transformOrigin = '0 0';
    container.style.pointerEvents = 'none';

    setShape(initial);
    setTransform(initialTransform);
    applyContainerTransform(initialTransform);

    dispose = render(() => <PointHandle shape={shape} transform={transform} ctx={ctx} />, container);
  }

  const update = (updated: Point, updatedTransform: EditorTransform) => {
    applyContainerTransform(updatedTransform);
    setTransform(updatedTransform);
    setShape(updated);
  }

  const destroy = () => dispose?.();

  return { mount, update, destroy };
}
