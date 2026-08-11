import type { Bounds } from '../geometry';

export interface RenderViewport {

  /** World-space bounds currently visible. **/
  bounds: Bounds;

  /** World units per screen pixel (i.e. 1 / zoom) - used to convert world sizes to on-screen sizes. **/
  resolution: number;

}

export interface LODOptions {

  /** On-screen size (px) below which a shape is culled entirely. Default 1.5. **/
  cullBelowPx?: number;

  /** On-screen size (px) below which a shape renders as a simplified point instead of its full geometry. Default 6. **/
  simplifyBelowPx?: number;

}

export type LODBucket = 'full' | 'simplified' | 'culled';

const DEFAULT_LOD: Required<LODOptions> = { cullBelowPx: 1.5, simplifyBelowPx: 6 };

/** The on-screen size (px) of a world-space bounding box, given the viewport's resolution. **/
export const screenSize = (bounds: Bounds, resolution: number): number =>
  Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / resolution;

/**
 * Classifies a shape's on-screen size into a rendering tier:
 * - "full": big enough to matter - render its actual geometry.
 * - "simplified": too small for detail to read, but should stay visible -
 *   render as a single point with a guaranteed minimum screen radius. Much
 *   cheaper than full polygon tessellation, and doesn't disappear like
 *   "culled" would.
 * - "culled": sub-pixel or near enough - skip rendering entirely.
 */
export const classify = (bounds: Bounds, resolution: number, opts: LODOptions = {}): LODBucket => {
  const { cullBelowPx, simplifyBelowPx } = { ...DEFAULT_LOD, ...opts };
  const size = screenSize(bounds, resolution);

  if (size < cullBelowPx) return 'culled';
  if (size < simplifyBelowPx) return 'simplified';
  return 'full';
}
