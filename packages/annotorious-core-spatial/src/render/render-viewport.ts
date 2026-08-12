import type { Bounds } from '../geometry';

export interface RenderViewport {

  /** World-space bounds currently visible. **/
  bounds: Bounds;

  /** World units per screen pixel (i.e. 1 / zoom) - used to convert screen-pixel distances (e.g. a hit-test buffer) to world sizes. **/
  resolution: number;

}
