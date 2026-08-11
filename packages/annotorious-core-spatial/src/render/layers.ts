import type { Layer } from '@deck.gl/core';
import { PolygonLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { AnnotationIndex } from '../annotation-index';
import { boxCorners, ShapeType } from '../geometry';
import type { SpatialShape } from '../geometry';
import type { SpatialAnnotationTarget } from '../model';
import { classify } from './lod';
import type { LODOptions, RenderViewport } from './lod';

export interface RenderStyle {

  fillColor?: [number, number, number, number];

  lineColor?: [number, number, number, number];

  /** Screen pixels. **/
  lineWidth?: number;

}

const DEFAULT_STYLE: Required<RenderStyle> = {
  fillColor: [255, 200, 0, 60],
  lineColor: [255, 200, 0, 220],
  lineWidth: 2
};

export interface BuildLayersOptions<T extends SpatialAnnotationTarget> {

  lod?: LODOptions;

  getStyle?: (target: T) => RenderStyle | undefined;

  /** Screen-constant minimum radius (px) for point/simplified representations. Default 4. **/
  pointRadiusMinPixels?: number;

  /** Prefix for layer ids - needed if multiple annotators share one Deck instance. **/
  idPrefix?: string;

}

// Only ever called for the "full" bucket, which by construction never
// contains points (see buildAnnotationLayers) - the explicit switch (rather
// than a two-way ternary) is what lets TS confirm that for us.
const shapeToPolygonRing = (shape: SpatialShape): [number, number][] => {
  switch (shape.type) {
    case ShapeType.BOX: return boxCorners(shape.geometry);
    case ShapeType.POLYGON: return shape.geometry.points;
    case ShapeType.POINT: throw new Error('A point has no polygon representation');
  }
}

const shapeCentroid = (shape: SpatialShape): [number, number] => {
  if (shape.type === ShapeType.POINT)
    return [shape.geometry.x, shape.geometry.y];

  const { minX, minY, maxX, maxY } = shape.geometry.bounds;
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

/**
 * Builds the deck.gl layers for whatever's currently visible, applying
 * viewport culling (via the spatial index) and the point/cull LOD
 * simplification - the MVP-tier scaling strategy. Both layers are
 * `pickable: false`: hit-testing goes through the spatial index (see
 * `AnnotationIndex.getAt`) against actual geometry, not GPU color picking,
 * which stays precise and fast at very large annotation counts where GPU
 * picking degrades.
 *
 * Call this again whenever the viewport changes (pan/zoom) or the
 * underlying annotation data changes - it always reflects a fresh query
 * against the index, there's no persistent state to invalidate.
 */
export const buildAnnotationLayers = <T extends SpatialAnnotationTarget>(
  index: AnnotationIndex<T>,
  viewport: RenderViewport,
  opts: BuildLayersOptions<T> = {}
): Layer[] => {
  const idPrefix = opts.idPrefix ? `${opts.idPrefix}-` : '';
  const pointRadiusMinPixels = opts.pointRadiusMinPixels ?? 4;

  const candidates = index.getIntersecting(viewport.bounds);

  const full: T[] = [];
  const simplified: T[] = [];

  for (const target of candidates) {
    if (target.selector.type === ShapeType.POINT) {
      // A point has no world-space extent to measure - it's always its own
      // simplified representation, never culled by size.
      simplified.push(target);
      continue;
    }

    const bucket = classify(target.selector.geometry.bounds, viewport.resolution, opts.lod);
    if (bucket === 'culled') continue;
    (bucket === 'simplified' ? simplified : full).push(target);
  }

  const style = (target: T): Required<RenderStyle> => ({ ...DEFAULT_STYLE, ...opts.getStyle?.(target) });

  const layers: Layer[] = [];

  if (full.length > 0) {
    layers.push(new PolygonLayer<T>({
      id: `${idPrefix}annotations-shapes`,
      data: full,
      pickable: false,
      stroked: true,
      filled: true,
      getPolygon: t => shapeToPolygonRing(t.selector),
      getFillColor: t => style(t).fillColor,
      getLineColor: t => style(t).lineColor,
      getLineWidth: t => style(t).lineWidth,
      lineWidthUnits: 'pixels'
    }));
  }

  if (simplified.length > 0) {
    layers.push(new ScatterplotLayer<T>({
      id: `${idPrefix}annotations-points`,
      data: simplified,
      pickable: false,
      stroked: true,
      filled: true,
      getPosition: t => shapeCentroid(t.selector),
      getFillColor: t => style(t).fillColor,
      getLineColor: t => style(t).lineColor,
      getLineWidth: t => style(t).lineWidth,
      lineWidthUnits: 'pixels',
      radiusUnits: 'pixels',
      getRadius: pointRadiusMinPixels,
      radiusMinPixels: pointRadiusMinPixels
    }));
  }

  return layers;
}
