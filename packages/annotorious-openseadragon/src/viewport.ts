import OpenSeadragon from 'openseadragon';
import type { RenderViewport } from '@annotorious/core-spatial';

/**
 * "World space" for this package is OpenSeadragon's own viewport coordinate
 * space - the space that's already shared across every image in the world,
 * regardless of how many there are or how they're placed. We don't invent a
 * separate coordinate system: the spatial index, the DeckGL layers, and
 * hit-testing all work directly in OSD viewport coordinates. A single
 * annotation's own geometry, though, is stored relative to *its* image (see
 * `image-registry.ts` for the per-image local <-> world conversion).
 */

/** Pixel coordinates (relative to the viewer's container element) -> world (viewport) space. **/
export const pixelToWorld = (viewer: OpenSeadragon.Viewer, pixel: OpenSeadragon.Point): OpenSeadragon.Point =>
  viewer.viewport.pointFromPixel(pixel, true);

/** World (viewport) space -> pixel coordinates (relative to the viewer's container element). **/
export const worldToPixel = (viewer: OpenSeadragon.Viewer, point: OpenSeadragon.Point): OpenSeadragon.Point =>
  viewer.viewport.pixelFromPoint(point, true);

/** A pointer event's clientX/clientY -> pixel coordinates relative to the viewer's container element. **/
export const eventToPixel = (viewer: OpenSeadragon.Viewer, event: PointerEvent): OpenSeadragon.Point => {
  const rect = viewer.container.getBoundingClientRect();
  return new OpenSeadragon.Point(event.clientX - rect.left, event.clientY - rect.top);
}

export const eventToWorld = (viewer: OpenSeadragon.Viewer, event: PointerEvent): OpenSeadragon.Point =>
  pixelToWorld(viewer, eventToPixel(viewer, event));

/**
 * The current viewport, in the shape core-spatial's rendering/LOD code
 * expects: world-space bounds, plus world units per screen pixel (used to
 * size shapes on screen for the cull/simplify decision, and by the Solid
 * editor handles to stay a constant screen size).
 */
export const getRenderViewport = (viewer: OpenSeadragon.Viewer): RenderViewport => {
  const bounds = viewer.viewport.getBounds(true);
  const containerSize = viewer.viewport.getContainerSize();

  return {
    bounds: { minX: bounds.x, minY: bounds.y, maxX: bounds.x + bounds.width, maxY: bounds.y + bounds.height },
    resolution: bounds.width / containerSize.x
  };
}
