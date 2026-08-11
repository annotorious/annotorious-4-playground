import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { boxCorners, createBox } from '../geometry';
import type { Box } from '../geometry';
import type { Corner } from './box-geometry-ops';
import { moveBox, resizeBoxByCorner, rotateBoxTowards } from './box-geometry-ops';
import type { EditorContext, EditorTransform, ShapeEditor, ShapeEditorFactory } from './shape-editor';

const HANDLE_SIZE = 10; // constant screen pixels
const BORDER_WIDTH = 2; // constant screen pixels
const ROTATE_HANDLE_OFFSET = 24; // constant screen pixels
const NUDGE = 1; // local units per arrow-key press
const ROTATE_NUDGE = Math.PI / 36; // 5 degrees per arrow-key press

const CORNERS: Corner[] = ['nw', 'ne', 'se', 'sw'];

const CORNER_LABEL: Record<Corner, string> = {
  nw: 'top-left', ne: 'top-right', se: 'bottom-right', sw: 'bottom-left'
};

/** The box's own 4 corners in local space - i.e. what `resizeBoxByCorner` expects as a drag target, and where handles are positioned. **/
const cornerLocalPositions = (box: Box): Record<Corner, [number, number]> => {
  const [nw, ne, se, sw] = boxCorners(box.geometry);
  return { nw, ne, se, sw };
}

/**
 * Handles are positioned AND sized in local coordinates, exactly like
 * Annotorious v3's SVG editors (`handleRadius = 4 / scale`) - every spatial
 * dimension (position offset, width, border) is divided by the current
 * scale, so that after the container's single ambient `scale(...)`
 * transform is applied, the rendered result is a constant screen size. No
 * separate per-handle transform is needed, which avoids any ambiguity about
 * how a handle's own transform would compose with the container's.
 */
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
    'border-radius': `${border}px`,
    'box-sizing': 'border-box'
  };
}

const BoxHandles = (props: { shape: () => Box, transform: () => EditorTransform, ctx: EditorContext<Box> }) => {
  const { ctx } = props;

  const rotateHandleLocalPosition = (): [number, number] => {
    const { x, y, w, h } = props.shape().geometry;
    const { nw, ne } = cornerLocalPositions(props.shape());
    const topMid: [number, number] = [(nw[0] + ne[0]) / 2, (nw[1] + ne[1]) / 2];

    const cx = x + w / 2;
    const cy = y + h / 2;
    const dx = topMid[0] - cx;
    const dy = topMid[1] - cy;
    const len = Math.hypot(dx, dy) || 1;

    // Offset is a constant screen distance, so divide by scale to express it in local units
    const offset = ROTATE_HANDLE_OFFSET / props.transform().scale;
    return [topMid[0] + (dx / len) * offset, topMid[1] + (dy / len) * offset];
  }

  const startCornerDrag = (corner: Corner) => (downEvent: PointerEvent) => {
    // Deliberately NOT calling stopPropagation() here - see the module doc
    // in createBoxEditor for why: Annotorious v3's editors never did either,
    // relying entirely on onDragStart/onDragEnd (-> setMouseNavEnabled) to
    // suppress the viewer's own navigation.
    ctx.onDragStart?.();

    const target = downEvent.currentTarget as HTMLElement;
    target.setPointerCapture(downEvent.pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      const local = ctx.toLocalCoordinates(moveEvent);
      const snapped = ctx.snapping ? ctx.snapping.snap(local) : local;
      ctx.onChange(resizeBoxByCorner(props.shape(), corner, snapped));
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
      ctx.onChange(moveBox(props.shape(), dx, dy));
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

  const onCornerKeyDown = (corner: Corner) => (event: KeyboardEvent) => {
    const delta: Record<string, [number, number]> = {
      ArrowUp: [0, -NUDGE], ArrowDown: [0, NUDGE], ArrowLeft: [-NUDGE, 0], ArrowRight: [NUDGE, 0]
    };

    const d = delta[event.key];
    if (!d) return;
    event.preventDefault();

    const current = cornerLocalPositions(props.shape())[corner];
    const target: [number, number] = [current[0] + d[0], current[1] + d[1]];
    ctx.onChange(resizeBoxByCorner(props.shape(), corner, target));
  }

  const onBodyKeyDown = (event: KeyboardEvent) => {
    const delta: Record<string, [number, number]> = {
      ArrowUp: [0, -NUDGE], ArrowDown: [0, NUDGE], ArrowLeft: [-NUDGE, 0], ArrowRight: [NUDGE, 0]
    };

    const d = delta[event.key];
    if (!d) return;
    event.preventDefault();

    ctx.onChange(moveBox(props.shape(), d[0], d[1]));
  }

  const startRotateDrag = (downEvent: PointerEvent) => {
    ctx.onDragStart?.();

    const target = downEvent.currentTarget as HTMLElement;
    target.setPointerCapture(downEvent.pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      ctx.onChange(rotateBoxTowards(props.shape(), ctx.toLocalCoordinates(moveEvent)));
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

  const onRotateKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();

    const { x, y, w, h, rot = 0 } = props.shape().geometry;
    const newRot = rot + (event.key === 'ArrowLeft' ? -ROTATE_NUDGE : ROTATE_NUDGE);
    const cx = x + w / 2;
    const cy = y + h / 2;

    // Reuse rotateBoxTowards by pointing it at an arbitrary point along the new angle
    const target: [number, number] = [cx + Math.sin(newRot) * 100, cy - Math.cos(newRot) * 100];
    ctx.onChange(rotateBoxTowards(props.shape(), target));
  }

  // Drag-to-move hit region, matching the box's own (unrotated) local
  // bounds with its own rotate() layered on top of the ambient container
  // transform - rendered first, so corner/rotate handles (rendered after,
  // later in paint order) stay independently grabbable wherever they
  // visually overlap it.
  const bodyStyle = (): Record<string, string> => {
    const { x, y, w, h, rot = 0 } = props.shape().geometry;
    return {
      position: 'absolute',
      left: `${x}px`,
      top: `${y}px`,
      width: `${w}px`,
      height: `${h}px`,
      transform: rot ? `rotate(${rot}rad)` : '',
      'transform-origin': 'center',
      'pointer-events': 'auto',
      cursor: 'move'
    };
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
      <For each={CORNERS}>
        {corner => (
          <div
            role="button"
            tabIndex={0}
            aria-label={`Resize handle, ${CORNER_LABEL[corner]} corner`}
            style={handleStyle(cornerLocalPositions(props.shape())[corner], props.transform().scale)}
            onPointerDown={startCornerDrag(corner)}
            onKeyDown={onCornerKeyDown(corner)}
          />
        )}
      </For>
      <div
        role="button"
        tabIndex={0}
        aria-label="Rotate handle"
        style={{ ...handleStyle(rotateHandleLocalPosition(), props.transform().scale), 'border-radius': '50%' }}
        onPointerDown={startRotateDrag}
        onKeyDown={onRotateKeyDown}
      />
    </>
  );
}

export const createBoxEditor: ShapeEditorFactory<Box> = (ctx: EditorContext<Box>): ShapeEditor<Box> => {
  let dispose: (() => void) | undefined;
  let containerEl: HTMLElement | undefined;

  const [shape, setShape] = createSignal<Box>(createBox(0, 0, 0, 0));
  const [transform, setTransform] = createSignal<EditorTransform>({ scale: 1, offsetX: 0, offsetY: 0 }, { equals: false });

  // Applied directly, outside Solid's reactivity - this needs to happen the
  // instant `update` is called, in lockstep with whatever else re-renders
  // the shape-at-rest for the same viewport change, not on Solid's own
  // scheduling.
  const applyContainerTransform = (t: EditorTransform) => {
    if (!containerEl) return;
    containerEl.style.transform = `translate(${t.offsetX}px, ${t.offsetY}px) scale(${t.scale})`;
  }

  const mount = (container: HTMLElement, initial: Box, initialTransform: EditorTransform) => {
    containerEl = container;
    container.style.position = 'absolute';
    container.style.left = '0';
    container.style.top = '0';
    container.style.transformOrigin = '0 0';
    container.style.pointerEvents = 'none';

    setShape(initial);
    setTransform(initialTransform);
    applyContainerTransform(initialTransform);

    dispose = render(() => <BoxHandles shape={shape} transform={transform} ctx={ctx} />, container);
  }

  const update = (updated: Box, updatedTransform: EditorTransform) => {
    applyContainerTransform(updatedTransform);
    setTransform(updatedTransform);
    setShape(updated);
  }

  const destroy = () => dispose?.();

  return { mount, update, destroy };
}
