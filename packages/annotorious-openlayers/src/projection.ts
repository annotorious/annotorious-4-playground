import Projection from 'ol/proj/Projection.js';
import type { Extent } from 'ol/extent.js';

let counter = 0;

/**
 * Builds an OpenLayers `Projection` (and its extent) satisfying this
 * package's coordinate contract: local pixel coordinates `(x, y)` (y-down,
 * origin top-left, matching the W3C selector geometry every annotation is
 * stored in) correspond to map coordinates `(x, -y)` - extent
 * `[0, -height, width, 0]`. This is `ol/source/IIIF`'s own default extent
 * (verified against OL's source), so an IIIF-backed map satisfies the
 * contract for free without needing this helper at all. Use this for
 * `ImageStatic` or any other source - do NOT follow OpenLayers' own
 * `static-image.js` example verbatim, which uses a different, *height
 * dependent* extent (`[0, 0, width, height]`) that this package does not
 * assume anywhere.
 */
export const createImageProjection = (width: number, height: number): { projection: Projection, extent: Extent } => {
  const extent: Extent = [0, -height, width, 0];

  const projection = new Projection({
    code: `annotorious-image-${++counter}`,
    units: 'pixels',
    extent
  });

  return { projection, extent };
}
