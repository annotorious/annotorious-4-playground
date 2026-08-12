import type { SpatialShape } from '../geometry';
import type { SnappingProvider } from './snapping';
import type { ToolHint } from './tool-hint';

/**
 * 'drag' (the default): pointerdown starts the shape, pointerup completes
 * it - the usual press-drag-release rubber-band gesture. 'click': the first
 * click starts the shape, it tracks the pointer without the button held,
 * and a second click completes it - friendlier for precise work with a
 * mouse, and the more natural mode on touch is still 'drag' (a press-drag
 * is the native touch gesture). Read once when a tool is constructed - a
 * `setDrawingMode` call takes effect on the next shape, not retroactively
 * mid-gesture. Only box and polygon tools care about this; a point is
 * inherently a single click regardless of mode.
 */
export type DrawingMode = 'click' | 'drag';

/**
 * In 'click' mode, a pointerup only counts as the deliberate click that
 * advances a tool's state machine if it follows its own pointerdown within
 * this long - guards against someone holding the button down for a long
 * press, not against the gap between successive clicks, which is
 * unbounded. Shared by every tool that supports 'click' mode. Ported from
 * v3's RubberbandRectangle.svelte.
 */
export const CLICK_TIMEOUT_MS = 300;

export interface ToolContext<S extends SpatialShape = SpatialShape> {

  /** Converts a pointer event's screen coordinates into the shape's local coordinate space. **/
  toLocalCoordinates(event: PointerEvent): [number, number];

  snapping?: SnappingProvider;

  /** @default 'drag' **/
  drawingMode?: DrawingMode;

  /** Call whenever the in-progress shape changes, so the host can render a live preview. **/
  onChange(shape: S | undefined): void;

  /** Call when the shape is finished (e.g. on double-click, or after closing a polygon). **/
  onComplete(shape: S): void;

  /**
   * Call whenever the set of local drawing aids changes - the full current
   * set, not a diff, mirroring `onChange`'s "here's the current state"
   * shape. Pass an empty array (not omit the call) to clear every hint,
   * e.g. on cancel/complete. Optional: a tool with no hints of its own
   * simply never calls this.
   */
  onHint?(hints: ToolHint[]): void;

}

/**
 * A drawing tool creates one shape at a time, driven entirely by pointer/key
 * events - it has no idea how (or whether) that shape gets rendered while
 * it's in progress. That's the host's job: it owns the DOM, feeds events in,
 * and renders whatever `onChange`/`onComplete` report.
 *
 * This is deliberately framework-agnostic: nothing here assumes Solid, or
 * any other UI framework, or a particular renderer. A tool that wants to
 * draw its own live preview affordances (e.g. a rubber-band outline) is free
 * to do so internally using whatever it likes, as long as its public shape
 * stays this interface.
 */
export interface DrawingTool {

  onPointerDown(event: PointerEvent): void;

  onPointerMove(event: PointerEvent): void;

  onPointerUp(event: PointerEvent): void;

  onKeyDown?(event: KeyboardEvent): void;

  /** Abandons the shape currently in progress, resetting the tool to start a new one. **/
  cancel(): void;

  /** Releases any resources the tool is holding. **/
  destroy(): void;

}

export type DrawingToolFactory<S extends SpatialShape = SpatialShape> = (ctx: ToolContext<S>) => DrawingTool;

const registry = new Map<string, DrawingToolFactory<any>>();

export const registerTool = <S extends SpatialShape>(name: string, factory: DrawingToolFactory<S>) =>
  registry.set(name, factory);

export const getTool = (name: string): DrawingToolFactory | undefined => registry.get(name);

export const listTools = (): string[] => [...registry.keys()];
