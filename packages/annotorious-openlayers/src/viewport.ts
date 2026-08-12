import type Map from 'ol/Map.js';
import type { Extent } from 'ol/extent.js';
import type { Pixel } from 'ol/pixel.js';
import type { RenderViewport } from '@annotorious/core-spatial';

/**
 * "World space" for this package is Y-DOWN, origin top-left - the same
 * convention as local pixel space (see `projection.ts`'s coordinate
 * contract) - NOT OpenLayers' own native map/view coordinate space, which
 * is Y-up. Every function here does the one flip needed at the boundary
 * where we talk to `ol/Map`/`ol/View`'s own (Y-up) coordinate API, so nothing
 * outside this file ever needs to know OpenLayers' convention differs from
 * the rest of the package (`coordinates.ts`, `deck-overlay.ts`, the shared
 * Solid editors in `@annotorious/core-spatial` all work in world space as
 * defined here). This mirrors OpenSeadragon's `viewport.ts`, whose one
 * "gotcha" was the `current: true` flag; this package's is this Y flip -
 * confine it to one place, verify it thoroughly (see the plan's Part G),
 * and nowhere else has to think about it again.
 */
const flipY = ([x, y]: readonly number[]): [number, number] => [x!, -y!];

const flipBounds = ([minX, minY, maxX, maxY]: Extent): { minX: number, minY: number, maxX: number, maxY: number } => ({
  minX: minX!, minY: -maxY!, maxX: maxX!, maxY: -minY!
});

/** Pixel coordinates (relative to the map's viewport element) -> world space. **/
export const pixelToWorld = (map: Map, pixel: Pixel): [number, number] =>
  flipY(map.getCoordinateFromPixel(pixel));

/** World space -> pixel coordinates (relative to the map's viewport element). **/
export const worldToPixel = (map: Map, point: [number, number]): [number, number] => {
  const [x, y] = map.getPixelFromCoordinate(flipY(point));
  return [x!, y!];
}

/** A pointer event's clientX/clientY -> world space, in one call (OL resolves the event-relative pixel internally). **/
export const eventToWorld = (map: Map, event: PointerEvent): [number, number] =>
  flipY(map.getEventCoordinate(event));

const requireView = (map: Map) => {
  const view = map.getView();
  if (!view) throw new Error('Map has no view');
  return view;
}

/**
 * The current viewport, in the shape core-spatial's rendering/LOD code
 * expects: world-space bounds, plus world units per screen pixel.
 */
export const getRenderViewport = (map: Map): RenderViewport => {
  const view = requireView(map);

  const resolution = view.getResolution();
  if (resolution === undefined) throw new Error('View has no resolution - is it fully configured (extent/resolutions)?');

  const extent = view.calculateExtent(map.getSize());

  return {
    bounds: flipBounds(extent),
    resolution
  };
}
