import type { ShapeType, SpatialShape } from '../geometry';
import type { SnappingProvider } from './snapping';

export interface EditorContext<S extends SpatialShape = SpatialShape> {

  /** Screen (pointer event) coordinates -> the shape's local coordinate space. **/
  toLocalCoordinates(event: PointerEvent): [number, number];

  /**
   * The inverse: local coordinate space -> current screen pixels. Editors
   * use this to position and size handles in *constant screen pixels*
   * regardless of zoom - a resize handle should stay a fixed, comfortable
   * touch/click target on screen, not shrink to nothing when zoomed out or
   * balloon to an unusable size when zoomed in.
   */
  toScreenCoordinates(point: [number, number]): [number, number];

  snapping?: SnappingProvider;

  /** Call whenever the user edits the shape (drag a handle, move a vertex, ...). **/
  onChange(shape: S): void;

}

/**
 * A shape editor renders the interactive affordances for manipulating an
 * *existing* annotation - resize/rotate handles for a box, vertex handles
 * for a polygon, and so on.
 *
 * `mount` takes a plain `HTMLElement` and `destroy` releases whatever was
 * mounted into it - that's the whole contract. An implementation is free to
 * render into that container however it likes internally (e.g. with Solid,
 * for fine-grained updates while dragging), but nothing outside this
 * interface should ever depend on that choice.
 */
export interface ShapeEditor<S extends SpatialShape = SpatialShape> {

  mount(container: HTMLElement, shape: S): void;

  /**
   * Recomputes and re-renders. Call this whenever the shape changes *or*
   * whenever the viewport (pan/zoom) changes - screen positions depend on
   * both, and this is the only hook the host has to ask for a refresh.
   */
  update(shape: S): void;

  destroy(): void;

}

export type ShapeEditorFactory<S extends SpatialShape = SpatialShape> = (ctx: EditorContext<S>) => ShapeEditor<S>;

const registry = new Map<ShapeType, ShapeEditorFactory<any>>();

export const registerEditor = <S extends SpatialShape>(type: ShapeType, factory: ShapeEditorFactory<S>) =>
  registry.set(type, factory);

export const getEditor = (type: ShapeType): ShapeEditorFactory | undefined => registry.get(type);
