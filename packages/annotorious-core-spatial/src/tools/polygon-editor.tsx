import { createSignal, Index } from 'solid-js';
import { render } from 'solid-js/web';
import { createPolygon } from '../geometry';
import type { Polygon } from '../geometry';
import { movePolygon } from './polygon-geometry-ops';
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

  const startBodyDrag = (downEvent: PointerEvent) => {
    ctx.onDragStart?.();

    const target = downEvent.currentTarget as HTMLElement;
    target.setPointerCapture(downEvent.pointerId);

    let last = ctx.toLocalCoordinates(downEvent);

    const onMove = (moveEvent: PointerEvent) => {
      const local = ctx.toLocalCoordinates(moveEvent);
      const dx = local[0] - last[0];
      const dy = local[1] - last[1];
      last = local;
      ctx.onChange(movePolygon(props.shape(), dx, dy));
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

  const onBodyKeyDown = (event: KeyboardEvent) => {
    const delta: Record<string, [number, number]> = {
      ArrowUp: [0, -NUDGE], ArrowDown: [0, NUDGE], ArrowLeft: [-NUDGE, 0], ArrowRight: [NUDGE, 0]
    };

    const d = delta[event.key];
    if (!d) return;
    event.preventDefault();

    ctx.onChange(movePolygon(props.shape(), d[0], d[1]));
  }

  // Drag-to-move hit region matching the polygon's own shape, not just its
  // bounding box - a plain rect would let drags starting in the box's empty
  // corners fall through and move the shape unexpectedly. clip-path keeps
  // this to plain HTML/CSS (points as percentages of the bounding box)
  // rather than introducing SVG - see box-editor.tsx's lineStyle doc for why
  // SVG is deliberately avoided here for one-off shapes.
  const bodyStyle = (): Record<string, string> => {
    const points = props.shape().geometry.points;
    const xs = points.map(p => p[0]);
    const ys = points.map(p => p[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const width = Math.max(...xs) - minX || 1;
    const height = Math.max(...ys) - minY || 1;

    const clipPoints = points
      .map(([x, y]) => `${((x - minX) / width) * 100}% ${((y - minY) / height) * 100}%`)
      .join(', ');

    return {
      position: 'absolute',
      left: `${minX}px`,
      top: `${minY}px`,
      width: `${width}px`,
      height: `${height}px`,
      'clip-path': `polygon(${clipPoints})`,
      'pointer-events': 'auto',
      cursor: 'move'
    };
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
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label="Move shape"
        style={bodyStyle()}
        onPointerDown={startBodyDrag}
        onKeyDown={onBodyKeyDown}
      />
      {/*
        Index, not For: For keys each rendered node by the ITEM's own
        identity, so a point that gets a new [x, y] reference on every drag
        frame (see withPoint) reads as "a different item" - it would
        destroy and recreate that handle's DOM element on every single
        pointermove. Since the element being dragged is the one holding
        pointer capture, that recreation silently ends the capture, and the
        drag dies after one frame. Index keys by array position instead
        (stable for the whole gesture - only the vertex's own coordinates
        change, not which slot it occupies), so the same DOM element - and
        its pointer capture - persists for the full drag, exactly like the
        box editor's corner handles (which get the same stability for free,
        since they're keyed off the static `CORNERS` name array rather than
        off shape data).
      */}
      <Index each={props.shape().geometry.points}>
        {(point, index) => (
          <div
            role="button"
            tabIndex={0}
            aria-label={`Polygon vertex ${index + 1} of ${props.shape().geometry.points.length}`}
            style={handleStyle(point(), props.transform().scale)}
            onPointerDown={startVertexDrag(index)}
            onKeyDown={onVertexKeyDown(index)}
          />
        )}
      </Index>
    </>
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
