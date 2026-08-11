import { PolygonLayer, ScatterplotLayer } from '@deck.gl/layers';
import { describe, expect, it } from 'vitest';
import { createAnnotationIndex } from '../src/annotation-index';
import { createBox, createPoint } from '../src/geometry';
import { buildAnnotationLayers } from '../src/render/layers';
import type { SpatialAnnotationTarget } from '../src/model';

const target = (id: string, selector: SpatialAnnotationTarget['selector']): SpatialAnnotationTarget => ({
  annotation: id,
  selector
});

describe('buildAnnotationLayers', () => {

  it('produces only a PolygonLayer when everything is full-size', () => {
    const index = createAnnotationIndex();
    index.insert(target('a', createBox(0, 0, 100, 100)));

    const layers = buildAnnotationLayers(index, { bounds: { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 }, resolution: 1 });

    expect(layers).toHaveLength(1);
    expect(layers[0]).toBeInstanceOf(PolygonLayer);
  });

  it('produces only a ScatterplotLayer for points', () => {
    const index = createAnnotationIndex();
    index.insert(target('a', createPoint(5, 5)));

    const layers = buildAnnotationLayers(index, { bounds: { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 }, resolution: 1 });

    expect(layers).toHaveLength(1);
    expect(layers[0]).toBeInstanceOf(ScatterplotLayer);
  });

  it('splits full-size and simplified shapes into separate layers', () => {
    const index = createAnnotationIndex();
    index.insert(target('big', createBox(0, 0, 1000, 1000))); // clearly "full" at resolution 1
    index.insert(target('tiny', createBox(2000, 2000, 2, 2))); // below simplifyBelowPx at resolution 1

    const layers = buildAnnotationLayers(index, { bounds: { minX: -1000, minY: -1000, maxX: 3000, maxY: 3000 }, resolution: 1 });

    expect(layers).toHaveLength(2);
    expect(layers.some(l => l instanceof PolygonLayer)).toBe(true);
    expect(layers.some(l => l instanceof ScatterplotLayer)).toBe(true);
  });

  it('culls sub-pixel shapes entirely', () => {
    const index = createAnnotationIndex();
    index.insert(target('sub-pixel', createBox(0, 0, 0.1, 0.1)));

    const layers = buildAnnotationLayers(index, { bounds: { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 }, resolution: 1 });

    expect(layers).toHaveLength(0);
  });

  it('excludes shapes outside the viewport bounds', () => {
    const index = createAnnotationIndex();
    index.insert(target('far-away', createBox(10000, 10000, 100, 100)));

    const layers = buildAnnotationLayers(index, { bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, resolution: 1 });

    expect(layers).toHaveLength(0);
  });

  it('applies per-target styling via getStyle', () => {
    const index = createAnnotationIndex();
    index.insert(target('a', createBox(0, 0, 100, 100)));

    const layers = buildAnnotationLayers(index, { bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 }, resolution: 1 }, {
      getStyle: () => ({ fillColor: [1, 2, 3, 4] })
    });

    const layer = layers[0] as PolygonLayer<SpatialAnnotationTarget>;
    // @ts-expect-error - accessing internal props for test purposes
    expect(layer.props.getFillColor(index.all()[0])).toEqual([1, 2, 3, 4]);
  });

});
