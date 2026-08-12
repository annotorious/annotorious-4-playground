import OpenSeadragon from 'openseadragon';
import { createBox, createPoint, createPolygon, ShapeType } from '@annotorious/core-spatial';
import type { Bounds, EditorTransform, SpatialAnnotationTarget, SpatialShape, ToolHint } from '@annotorious/core-spatial';
import { eventToWorld, worldToPixel } from './viewport';

/**
 * Per-image transforms: a single annotation's geometry is stored in *its
 * own* image's local pixel space (matching W3C Fragment Selector semantics -
 * portable if the image gets repositioned in the world), so every one of
 * these needs to know which image it's dealing with.
 *
 * We assume the image itself isn't rotated in the world (an OSD TiledImage
 * *can* be rotated, but it's an advanced/uncommon case) - under that
 * assumption, image-to-viewport is a uniform scale + translate, which keeps
 * this simple and keeps a Box a Box after transforming. A rotated
 * TiledImage placement is out of scope for now; `imageScale` and the box
 * transform below would need real matrix math to handle it correctly.
 */

/** World (viewport) units per one local (image pixel) unit. **/
export const imageScale = (tiledImage: OpenSeadragon.TiledImage): number => {
  const p0 = tiledImage.imageToViewportCoordinates(new OpenSeadragon.Point(0, 0), true);
  const p1 = tiledImage.imageToViewportCoordinates(new OpenSeadragon.Point(1, 0), true);
  return Math.hypot(p1.x - p0.x, p1.y - p0.y);
}

/**
 * Converts a fixed *screen*-pixel distance (e.g. a minimum touch/click
 * target size) into that image's local units, at the current zoom. Used for
 * hit-test buffering: a tiny or point annotation should stay reliably
 * clickable regardless of zoom level, not shrink to an unhittable dot.
 */
export const screenPixelsToLocalUnits = (worldResolution: number, tiledImage: OpenSeadragon.TiledImage, screenPixels: number): number =>
  (screenPixels * worldResolution) / imageScale(tiledImage);

/** A shape in one image's local pixel space -> the same shape in world (viewport) space. **/
export const shapeToWorld = (tiledImage: OpenSeadragon.TiledImage, shape: SpatialShape): SpatialShape => {
  switch (shape.type) {
    case ShapeType.POINT: {
      const w = tiledImage.imageToViewportCoordinates(new OpenSeadragon.Point(shape.geometry.x, shape.geometry.y), true);
      return createPoint(w.x, w.y);
    }
    case ShapeType.POLYGON: {
      const points = shape.geometry.points.map(([x, y]) => {
        const w = tiledImage.imageToViewportCoordinates(new OpenSeadragon.Point(x, y), true);
        return [w.x, w.y] as [number, number];
      });
      return createPolygon(points);
    }
    case ShapeType.BOX: {
      const origin = tiledImage.imageToViewportCoordinates(new OpenSeadragon.Point(shape.geometry.x, shape.geometry.y), true);
      const scale = imageScale(tiledImage);
      return createBox(origin.x, origin.y, shape.geometry.w * scale, shape.geometry.h * scale, shape.geometry.rot);
    }
  }
}

/** A target in one image's local pixel space -> the same target, geometry expressed in world space. **/
export const targetToWorld = <T extends SpatialAnnotationTarget>(tiledImage: OpenSeadragon.TiledImage, target: T): T => ({
  ...target,
  selector: shapeToWorld(tiledImage, target.selector)
});

/** A tool hint in one image's local pixel space -> the same hint, coordinates expressed in world space. **/
export const hintToWorld = (tiledImage: OpenSeadragon.TiledImage, hint: ToolHint): ToolHint => {
  const toWorld = (point: [number, number]): [number, number] => {
    const w = tiledImage.imageToViewportCoordinates(new OpenSeadragon.Point(point[0], point[1]), true);
    return [w.x, w.y];
  }

  return hint.type === 'point'
    ? { ...hint, position: toWorld(hint.position) }
    : { ...hint, from: toWorld(hint.from), to: toWorld(hint.to) };
}

/** World-space bounds -> the equivalent bounds in one image's local pixel space (for querying that image's own index). **/
export const worldBoundsToLocal = (tiledImage: OpenSeadragon.TiledImage, bounds: Bounds): Bounds => {
  const corners: [number, number][] = [
    [bounds.minX, bounds.minY], [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY]
  ];

  const local = corners.map(([x, y]) => tiledImage.viewportToImageCoordinates(new OpenSeadragon.Point(x, y), true));
  const xs = local.map(p => p.x);
  const ys = local.map(p => p.y);

  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/**
 * Screen (pointer event) <-> local pixel space, for one specific image -
 * what `ToolContext`/`EditorContext` need. Which image is "the" image for a
 * given tool/editor session is resolved once, when the session starts (see
 * `pointer.ts`), not per-event - a shape belongs to exactly one image for
 * its whole lifetime.
 */
export const createImageTransforms = (viewer: OpenSeadragon.Viewer, tiledImage: OpenSeadragon.TiledImage) => {
  const toLocalCoordinates = (event: PointerEvent): [number, number] => {
    const world = eventToWorld(viewer, event);
    const local = tiledImage.viewportToImageCoordinates(world, true);
    return [local.x, local.y];
  }

  const toScreenCoordinates = (point: [number, number]): [number, number] => {
    const world = tiledImage.imageToViewportCoordinates(new OpenSeadragon.Point(point[0], point[1]), true);
    const pixel = worldToPixel(viewer, world);
    return [pixel.x, pixel.y];
  }

  return { toLocalCoordinates, toScreenCoordinates };
}

/**
 * The current local->screen affine transform for one image, in the shape
 * `EditorContext` wants: `screenX = localX * scale + offsetX` (same for Y).
 * Editors apply this as a single CSS transform on their container instead
 * of repositioning every handle individually - see core-spatial's
 * shape-editor.ts for why that's the point.
 */
export const getEditorTransform = (viewer: OpenSeadragon.Viewer, tiledImage: OpenSeadragon.TiledImage): EditorTransform => {
  const { toScreenCoordinates } = createImageTransforms(viewer, tiledImage);

  const origin = toScreenCoordinates([0, 0]);
  const unitX = toScreenCoordinates([1, 0]);
  const scale = Math.hypot(unitX[0] - origin[0], unitX[1] - origin[1]);

  return { scale, offsetX: origin[0], offsetY: origin[1] };
}
