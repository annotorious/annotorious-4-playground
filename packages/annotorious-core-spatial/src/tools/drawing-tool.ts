import type { SpatialShape } from '../geometry';
import type { SnappingProvider } from './snapping';

export interface ToolContext<S extends SpatialShape = SpatialShape> {

  /** Converts a pointer event's screen coordinates into the shape's local coordinate space. **/
  toLocalCoordinates(event: PointerEvent): [number, number];

  snapping?: SnappingProvider;

  /** Call whenever the in-progress shape changes, so the host can render a live preview. **/
  onChange(shape: S | undefined): void;

  /** Call when the shape is finished (e.g. on double-click, or after closing a polygon). **/
  onComplete(shape: S): void;

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
