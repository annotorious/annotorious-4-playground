import type { ShapeType, SpatialShape } from '../geometry';
import type { SnappingProvider } from './snapping';

export interface EditorContext<S extends SpatialShape = SpatialShape> {

  toLocalCoordinates(event: PointerEvent): [number, number];

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

  /** Reflects a new shape state (e.g. after an external/programmatic change) without remounting. **/
  update(shape: S): void;

  destroy(): void;

}

export type ShapeEditorFactory<S extends SpatialShape = SpatialShape> = (ctx: EditorContext<S>) => ShapeEditor<S>;

const registry = new Map<ShapeType, ShapeEditorFactory<any>>();

export const registerEditor = <S extends SpatialShape>(type: ShapeType, factory: ShapeEditorFactory<S>) =>
  registry.set(type, factory);

export const getEditor = (type: ShapeType): ShapeEditorFactory | undefined => registry.get(type);
