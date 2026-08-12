import type { Layer } from '@deck.gl/core';
import { PolygonLayer, ScatterplotLayer } from '@deck.gl/layers';
import { boxCorners, ShapeType } from '../geometry';
import type { Point, SpatialShape } from '../geometry';
import type { SpatialAnnotationTarget } from '../model';

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

  getStyle?: (target: T) => RenderStyle | undefined;

  /** Screen-constant minimum radius (px) for point annotations. Default 4. **/
  pointRadiusMinPixels?: number;

  /** Prefix for layer ids - needed if multiple annotators share one Deck instance. **/
  idPrefix?: string;

}

const shapeToPolygonRing = (shape: SpatialShape): [number, number][] => {
  switch (shape.type) {
    case ShapeType.BOX: return boxCorners(shape.geometry);
    case ShapeType.POLYGON: return shape.geometry.points;
    case ShapeType.POINT: throw new Error('A point has no polygon representation');
  }
}

const pointPosition = (shape: Point): [number, number] => [shape.geometry.x, shape.geometry.y];

/**
 * Builds the deck.gl layers for a given set of candidate targets. Every
 * non-point shape goes to one `PolygonLayer`, every point to one
 * `ScatterplotLayer` - deck.gl/the GPU handles culling what's off-screen
 * and simplifying what's rendered, via the camera transform and its own
 * rendering pipeline; this deliberately does no viewport culling or
 * level-of-detail simplification of its own on top of that.
 *
 * Both layers are `pickable: false`: hit-testing goes through a spatial
 * index (see `AnnotationIndex.getAt`) against actual geometry, not GPU
 * color picking, which stays precise and fast at very large annotation
 * counts where GPU picking degrades.
 */
export const buildAnnotationLayers = <T extends SpatialAnnotationTarget>(
  candidates: T[],
  opts: BuildLayersOptions<T> = {}
): Layer[] => {
  const idPrefix = opts.idPrefix ? `${opts.idPrefix}-` : '';
  const pointRadiusMinPixels = opts.pointRadiusMinPixels ?? 4;

  const polygons: T[] = [];
  const points: T[] = [];

  for (const target of candidates)
    (target.selector.type === ShapeType.POINT ? points : polygons).push(target);

  // Memoized per candidate - deck.gl calls getFillColor/getLineColor/
  // getLineWidth as three independent accessors, and opts.getStyle is
  // typically not free (a store lookup, at minimum), so without this a
  // visible shape's style would get computed three times per render instead
  // of once.
  const styles = new Map<T, Required<RenderStyle>>();
  const style = (target: T): Required<RenderStyle> => {
    let computed = styles.get(target);
    if (!computed) {
      computed = { ...DEFAULT_STYLE, ...opts.getStyle?.(target) };
      styles.set(target, computed);
    }
    return computed;
  }

  const layers: Layer[] = [];

  if (polygons.length > 0) {
    layers.push(new PolygonLayer<T>({
      id: `${idPrefix}annotations-shapes`,
      data: polygons,
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

  if (points.length > 0) {
    layers.push(new ScatterplotLayer<T>({
      id: `${idPrefix}annotations-points`,
      data: points,
      pickable: false,
      stroked: true,
      filled: true,
      getPosition: t => pointPosition(t.selector as Point),
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
