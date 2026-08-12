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

  it('produces only a PolygonLayer for non-point shapes', () => {
    const layers = buildAnnotationLayers([target('a', createBox(0, 0, 100, 100))]);

    expect(layers).toHaveLength(1);
    expect(layers[0]).toBeInstanceOf(PolygonLayer);
  });

  it('produces only a ScatterplotLayer for points', () => {
    const layers = buildAnnotationLayers([target('a', createPoint(5, 5))]);

    expect(layers).toHaveLength(1);
    expect(layers[0]).toBeInstanceOf(ScatterplotLayer);
  });

  it('splits shapes and points into separate layers when both are present', () => {
    const candidates = [
      target('shape', createBox(0, 0, 100, 100)),
      target('point', createPoint(5, 5))
    ];

    const layers = buildAnnotationLayers(candidates);

    expect(layers).toHaveLength(2);
    expect(layers.some(l => l instanceof PolygonLayer)).toBe(true);
    expect(layers.some(l => l instanceof ScatterplotLayer)).toBe(true);
  });

  it('does not cull or simplify by on-screen size - deck.gl handles that', () => {
    const layers = buildAnnotationLayers([target('sub-pixel', createBox(0, 0, 0.1, 0.1))]);

    expect(layers).toHaveLength(1);
    expect((layers[0] as PolygonLayer<SpatialAnnotationTarget>).props.data).toHaveLength(1);
  });

  it('is agnostic to how candidates were gathered - works directly off an index query too', () => {
    const index = createAnnotationIndex();
    index.insert(target('in-view', createBox(0, 0, 100, 100)));
    index.insert(target('far-away', createBox(10000, 10000, 100, 100)));

    const layers = buildAnnotationLayers(index.getIntersecting({ minX: 0, minY: 0, maxX: 100, maxY: 100 }));

    expect(layers).toHaveLength(1);
    expect((layers[0] as PolygonLayer<SpatialAnnotationTarget>).props.data).toHaveLength(1);
  });

  it('applies per-target styling via getStyle', () => {
    const t = target('a', createBox(0, 0, 100, 100));
    const layers = buildAnnotationLayers([t], { getStyle: () => ({ fillColor: [1, 2, 3, 4] }) });

    const layer = layers[0] as PolygonLayer<SpatialAnnotationTarget>;
    // @ts-expect-error - accessing internal props for test purposes
    expect(layer.props.getFillColor(t)).toEqual([1, 2, 3, 4]);
  });

});
