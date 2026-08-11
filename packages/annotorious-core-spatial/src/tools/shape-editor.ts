import type { ShapeType, SpatialShape } from '../geometry';
import type { SnappingProvider } from './snapping';

/**
 * An affine local -> screen mapping: `screenX = localX * scale + offsetX`
 * (same for Y). Editors apply this as a single CSS transform on their
 * container, rather than recomputing every handle's screen position
 * individually - see the module doc below for why that distinction matters.
 */
export interface EditorTransform {

  scale: number;

  offsetX: number;

  offsetY: number;

}

export interface EditorContext<S extends SpatialShape = SpatialShape> {

  /** Screen (pointer event) coordinates -> the shape's local coordinate space. **/
  toLocalCoordinates(event: PointerEvent): [number, number];

  snapping?: SnappingProvider;

  /** Call whenever the user edits the shape (drag a handle, move a vertex, ...). **/
  onChange(shape: S): void;

  /**
   * Called when a handle drag starts/ends. Lets the host suspend its own
   * navigation (e.g. an OpenSeadragon viewer's pan/zoom) for the duration -
   * without it, a drag on a handle can also be interpreted as a drag on the
   * viewer underneath, fighting the edit.
   */
  onDragStart?(): void;

  onDragEnd?(): void;

}

/**
 * A shape editor renders the interactive affordances for manipulating an
 * *existing* annotation - resize/rotate handles for a box, vertex handles
 * for a polygon, and so on.
 *
 * Handles are positioned in the shape's own local coordinate space (the
 * same space the geometry itself is in), not in screen pixels. The host
 * passes the current local->screen `EditorTransform`, which the editor
 * applies as a single CSS transform on its mount container - every handle
 * moves correctly as one atomic operation, without the editor needing to
 * touch (or even know about) any of them individually on a pure viewport
 * change. A handle's on-screen *size* still needs to stay constant despite
 * that ambient scale, the same way Annotorious v3's SVG editors divided
 * handle radius by the viewport scale - here that means applying a
 * counter-scale (`1 / transform.scale`) to each handle element itself.
 *
 * This split matters for more than tidiness: an implementation that instead
 * recomputes each handle's screen position through its own coordinate
 * transform, on its own update cycle, has no shared source of truth with
 * whatever else is rendering the shape (e.g. a separate WebGL layer) - the
 * two can easily drift out of sync with each other, especially mid-drag.
 * Routing both through the same `EditorTransform`, updated synchronously
 * alongside the shape layer, keeps them locked together.
 *
 * `mount` takes a plain `HTMLElement` and `destroy` releases whatever was
 * mounted into it - that's the whole contract. An implementation is free to
 * render into that container however it likes internally (e.g. with Solid,
 * for fine-grained updates while dragging), but nothing outside this
 * interface should ever depend on that choice.
 */
export interface ShapeEditor<S extends SpatialShape = SpatialShape> {

  mount(container: HTMLElement, shape: S, transform: EditorTransform): void;

  /**
   * Recomputes and re-renders. Call this whenever the shape changes *or*
   * whenever the viewport (pan/zoom) changes - this is the only hook the
   * host has to ask for a refresh, and should be called synchronously with
   * whatever else re-renders the shape-at-rest, not deferred/batched
   * separately - see the interface doc above.
   */
  update(shape: S, transform: EditorTransform): void;

  destroy(): void;

}

export type ShapeEditorFactory<S extends SpatialShape = SpatialShape> = (ctx: EditorContext<S>) => ShapeEditor<S>;

const registry = new Map<ShapeType, ShapeEditorFactory<any>>();

export const registerEditor = <S extends SpatialShape>(type: ShapeType, factory: ShapeEditorFactory<S>) =>
  registry.set(type, factory);

export const getEditor = (type: ShapeType): ShapeEditorFactory | undefined => registry.get(type);
