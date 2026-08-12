import type Map from 'ol/Map.js';
import type { Bounds, EditorTransform, SpatialAnnotationTarget, SpatialShape, ToolHint } from '@annotorious/core-spatial';
import { eventToWorld, worldToPixel } from './viewport';
import type { RegisteredImage } from './image-registry';

/**
 * Per-image transforms - kept the exact same shape as the OpenSeadragon
 * package's `coordinates.ts` (same function names/signatures, still taking
 * a `RegisteredImage` parameter even though the single-image MVP below
 * never uses its fields for anything but bounds-checking, in `image-registry.ts`).
 * That parameter is the deliberate seam: single-image MVP has exactly one
 * image, not placed anywhere within a larger world, so "local pixel space"
 * and "world space" are the *same* space and every function here is an
 * identity (world == local - see `@annotorious/core-spatial`'s
 * `annotation-index.ts` doc comment, which already anticipated this for
 * OpenLayers). A future multi-image version would give `RegisteredImage` a
 * real world-space placement and change these function *bodies* to apply
 * it - no call site in `pointer.ts`/`deck-overlay.ts`/`editor-overlay.ts`
 * would need to change.
 */

/** Local units -> world units, at the current zoom - always 1:1 for single-image MVP (world == local). **/
export const screenPixelsToLocalUnits = (resolution: number, _image: RegisteredImage, screenPixels: number): number =>
  screenPixels * resolution;

/** A shape in the registered image's local pixel space -> the same shape in world space (identity - see module doc). **/
export const shapeToWorld = (_image: RegisteredImage, shape: SpatialShape): SpatialShape => shape;

/** A target in the registered image's local pixel space -> the same target, geometry in world space (identity). **/
export const targetToWorld = <T extends SpatialAnnotationTarget>(_image: RegisteredImage, target: T): T => target;

/** A tool hint in the registered image's local pixel space -> the same hint, coordinates in world space (identity). **/
export const hintToWorld = (_image: RegisteredImage, hint: ToolHint): ToolHint => hint;

/** World-space bounds -> the equivalent bounds in the registered image's local pixel space (identity). **/
export const worldBoundsToLocal = (_image: RegisteredImage, bounds: Bounds): Bounds => bounds;

/**
 * Screen (pointer event) <-> local pixel space, for the registered image -
 * what `ToolContext`/`EditorContext` need. `image` is unused today (world
 * == local, see module doc) but kept in the signature for the same reason
 * as the functions above.
 */
export const createImageTransforms = (map: Map, _image: RegisteredImage) => {
  const toLocalCoordinates = (event: PointerEvent): [number, number] => eventToWorld(map, event);

  const toScreenCoordinates = (point: [number, number]): [number, number] => worldToPixel(map, point);

  return { toLocalCoordinates, toScreenCoordinates };
}

/**
 * The current local->screen affine transform for the registered image, in
 * the shape `EditorContext` wants: `screenX = localX * scale + offsetX`
 * (same for Y). Measured the same way OSD's does - via the screen distance
 * between two transformed local points - rather than hard-coding
 * `1 / view.getResolution()`, so this keeps working unchanged once
 * `createImageTransforms` above stops being a pure identity (multi-image).
 */
export const getEditorTransform = (map: Map, image: RegisteredImage): EditorTransform => {
  const { toScreenCoordinates } = createImageTransforms(map, image);

  const origin = toScreenCoordinates([0, 0]);
  const unitX = toScreenCoordinates([1, 0]);
  const scale = Math.hypot(unitX[0] - origin[0], unitX[1] - origin[1]);

  return { scale, offsetX: origin[0], offsetY: origin[1] };
}
