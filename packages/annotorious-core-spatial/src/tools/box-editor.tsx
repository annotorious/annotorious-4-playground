import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { boxCorners, createBox } from '../geometry';
import type { Box } from '../geometry';
import type { Corner } from './box-geometry-ops';
import { resizeBoxByCorner, rotateBoxTowards } from './box-geometry-ops';
import type { EditorContext, ShapeEditor, ShapeEditorFactory } from './shape-editor';

// All sizes/offsets below are constant *screen* pixels - handles must stay a
// fixed, comfortable size and offset on screen regardless of zoom level.
const HANDLE_SIZE = 10;
const ROTATE_HANDLE_OFFSET = 24;
const NUDGE = 1; // local units per arrow-key press
const ROTATE_NUDGE = Math.PI / 36; // 5 degrees per arrow-key press

const CORNERS: Corner[] = ['nw', 'ne', 'se', 'sw'];

const CORNER_LABEL: Record<Corner, string> = {
  nw: 'top-left', ne: 'top-right', se: 'bottom-right', sw: 'bottom-left'
};

/** The box's own 4 corners in local/world space - i.e. what `resizeBoxByCorner` expects as a drag target. **/
const cornerLocalPositions = (box: Box): Record<Corner, [number, number]> => {
  const [nw, ne, se, sw] = boxCorners(box.geometry);
  return { nw, ne, se, sw };
}

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
  'border-radius': '2px',
  'box-sizing': 'border-box'
});

const BoxHandles = (props: { shape: () => Box, ctx: EditorContext<Box> }) => {
  const { ctx } = props;

  const cornerScreenPositions = (): Record<Corner, [number, number]> => {
    const local = cornerLocalPositions(props.shape());
    return {
      nw: ctx.toScreenCoordinates(local.nw),
      ne: ctx.toScreenCoordinates(local.ne),
      se: ctx.toScreenCoordinates(local.se),
      sw: ctx.toScreenCoordinates(local.sw)
    };
  }

  const rotateHandleScreenPosition = (): [number, number] => {
    const { x, y, w, h } = props.shape().geometry;
    const { nw, ne } = cornerLocalPositions(props.shape());
    const topMid: [number, number] = [(nw[0] + ne[0]) / 2, (nw[1] + ne[1]) / 2];

    const screenCenter = ctx.toScreenCoordinates([x + w / 2, y + h / 2]);
    const screenTopMid = ctx.toScreenCoordinates(topMid);

    const dx = screenTopMid[0] - screenCenter[0];
    const dy = screenTopMid[1] - screenCenter[1];
    const len = Math.hypot(dx, dy) || 1;

    return [screenTopMid[0] + (dx / len) * ROTATE_HANDLE_OFFSET, screenTopMid[1] + (dy / len) * ROTATE_HANDLE_OFFSET];
  }

  const startCornerDrag = (corner: Corner) => (downEvent: PointerEvent) => {
    downEvent.stopPropagation();
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

  const startRotateDrag = (downEvent: PointerEvent) => {
    downEvent.stopPropagation();
    const target = downEvent.currentTarget as HTMLElement;
    target.setPointerCapture(downEvent.pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      ctx.onChange(rotateBoxTowards(props.shape(), ctx.toLocalCoordinates(moveEvent)));
    }

    const onUp = (upEvent: PointerEvent) => {
      target.releasePointerCapture(upEvent.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
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

  return (
    <>
      <For each={CORNERS}>
        {corner => (
          <div
            role="button"
            tabIndex={0}
            aria-label={`Resize handle, ${CORNER_LABEL[corner]} corner`}
            style={handleStyle(cornerScreenPositions()[corner])}
            onPointerDown={startCornerDrag(corner)}
            onKeyDown={onCornerKeyDown(corner)}
          />
        )}
      </For>
      <div
        role="button"
        tabIndex={0}
        aria-label="Rotate handle"
        style={{ ...handleStyle(rotateHandleScreenPosition()), 'border-radius': '50%' }}
        onPointerDown={startRotateDrag}
        onKeyDown={onRotateKeyDown}
      />
    </>
  );
}

export const createBoxEditor: ShapeEditorFactory<Box> = (ctx: EditorContext<Box>): ShapeEditor<Box> => {
  let dispose: (() => void) | undefined;
  const [shape, setShape] = createSignal<Box>(createBox(0, 0, 0, 0));

  const mount = (container: HTMLElement, initial: Box) => {
    setShape(initial);
    container.style.position = 'absolute';
    container.style.inset = '0';
    container.style.pointerEvents = 'none';

    dispose = render(() => <BoxHandles shape={shape} ctx={ctx} />, container);
  }

  const update = (updated: Box) => setShape(updated);

  const destroy = () => dispose?.();

  return { mount, update, destroy };
}
