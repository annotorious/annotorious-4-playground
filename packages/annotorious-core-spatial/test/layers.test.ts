import { PathLayer, ScatterplotLayer, SolidPolygonLayer } from '@deck.gl/layers';
import { describe, expect, it, vi } from 'vitest';
import { createBox, createPoint } from '../src/geometry';
import { buildRowLayers, DEFAULT_STYLE } from '../src/render/layers';
import type { RenderRow } from '../src/render/layers';
import type { SpatialAnnotationTarget } from '../src/model';

const row = (id: string, selector: SpatialAnnotationTarget['selector'], style = DEFAULT_STYLE): RenderRow => ({
  target: { annotation: id, selector },
  style
});

const noDirty = () => [];

describe('buildRowLayers', () => {

  it('produces a SolidPolygonLayer (fill) and a PathLayer (stroke) for non-point shapes', () => {
    const layers = buildRowLayers([row('a', createBox(0, 0, 100, 100))], [], { getDirtyPolygonRanges: noDirty, getDirtyPointRanges: noDirty });

    expect(layers).toHaveLength(2);
    expect(layers.some(l => l instanceof SolidPolygonLayer)).toBe(true);
    expect(layers.some(l => l instanceof PathLayer)).toBe(true);
  });

  it('produces only a ScatterplotLayer for points', () => {
    const layers = buildRowLayers([], [row('a', createPoint(5, 5))], { getDirtyPolygonRanges: noDirty, getDirtyPointRanges: noDirty });

    expect(layers).toHaveLength(1);
    expect(layers[0]).toBeInstanceOf(ScatterplotLayer);
  });

  it('produces all three layers when shapes and points are both present', () => {
    const layers = buildRowLayers(
      [row('shape', createBox(0, 0, 100, 100))],
      [row('point', createPoint(5, 5))],
      { getDirtyPolygonRanges: noDirty, getDirtyPointRanges: noDirty }
    );

    expect(layers).toHaveLength(3);
    expect(layers.some(l => l instanceof SolidPolygonLayer)).toBe(true);
    expect(layers.some(l => l instanceof PathLayer)).toBe(true);
    expect(layers.some(l => l instanceof ScatterplotLayer)).toBe(true);
  });

  it('omits polygon layers entirely when there are no polygon rows, and vice versa', () => {
    expect(buildRowLayers([], [], { getDirtyPolygonRanges: noDirty, getDirtyPointRanges: noDirty })).toHaveLength(0);
  });

  it('does not cull or simplify by on-screen size - deck.gl handles that', () => {
    const layers = buildRowLayers([row('sub-pixel', createBox(0, 0, 0.1, 0.1))], [], { getDirtyPolygonRanges: noDirty, getDirtyPointRanges: noDirty });

    const fillLayer = layers.find(l => l instanceof SolidPolygonLayer) as SolidPolygonLayer<RenderRow>;
    expect(fillLayer.props.data).toHaveLength(1);
  });

  it('renders each row using its own precomputed style, for polygon fill, stroke, and points', () => {
    const shapeRow = row('a', createBox(0, 0, 100, 100), { fillColor: [1, 2, 3, 4], lineColor: [5, 6, 7, 8], lineWidth: 9 });
    const pointRow = row('b', createPoint(5, 5), { fillColor: [9, 8, 7, 6], lineColor: [5, 4, 3, 2], lineWidth: 1 });
    const layers = buildRowLayers([shapeRow], [pointRow], { getDirtyPolygonRanges: noDirty, getDirtyPointRanges: noDirty });

    const fillLayer = layers.find(l => l instanceof SolidPolygonLayer) as SolidPolygonLayer<RenderRow>;
    // @ts-expect-error - accessing internal props for test purposes
    expect(fillLayer.props.getFillColor(shapeRow)).toEqual([1, 2, 3, 4]);

    const strokeLayer = layers.find(l => l instanceof PathLayer) as PathLayer<RenderRow>;
    // @ts-expect-error - accessing internal props for test purposes
    expect(strokeLayer.props.getColor(shapeRow)).toEqual([5, 6, 7, 8]);
    // @ts-expect-error - accessing internal props for test purposes
    expect(strokeLayer.props.getWidth(shapeRow)).toBe(9);

    const pointLayer = layers.find(l => l instanceof ScatterplotLayer) as ScatterplotLayer<RenderRow>;
    // @ts-expect-error - accessing internal props for test purposes
    expect(pointLayer.props.getFillColor(pointRow)).toEqual([9, 8, 7, 6]);
  });

  it('closes the stroke path (repeats the first point) so the outline has no open edge', () => {
    const shapeRow = row('a', createBox(0, 0, 100, 100));
    const layers = buildRowLayers([shapeRow], [], { getDirtyPolygonRanges: noDirty, getDirtyPointRanges: noDirty });

    const strokeLayer = layers.find(l => l instanceof PathLayer) as PathLayer<RenderRow>;
    // @ts-expect-error - accessing internal props for test purposes
    const path = strokeLayer.props.getPath(shapeRow);
    expect(path[0]).toEqual(path[path.length - 1]);
    expect(path.length).toBe(5); // 4 box corners + the repeated first point
  });

  describe('_dataDiff-based partial updates (fill, stroke, and points alike)', () => {

    it.each([
      ['polygon fill', (layers: ReturnType<typeof buildRowLayers>) => layers.find(l => l instanceof SolidPolygonLayer)],
      ['polygon stroke', (layers: ReturnType<typeof buildRowLayers>) => layers.find(l => l instanceof PathLayer)],
      ['points', (layers: ReturnType<typeof buildRowLayers>) => layers.find(l => l instanceof ScatterplotLayer)]
    ])('%s: always reports data as changed via dataComparator, since RowStore mutates in place', (_label, pick) => {
      const layers = buildRowLayers([row('a', createBox(0, 0, 100, 100))], [row('b', createPoint(5, 5))], { getDirtyPolygonRanges: noDirty, getDirtyPointRanges: noDirty });
      const layer = pick(layers)!;
      // @ts-expect-error - accessing internal props for test purposes
      expect(layer.props.dataComparator(layer.props.data, layer.props.data)).toBe(false);
    });

    it('wires the polygon fill and stroke layers to the SAME dirty ranges, via one shared reader', () => {
      const dirtyPolygonRanges = [{ startRow: 0, endRow: 1 }];
      const getDirtyPolygonRanges = vi.fn(() => dirtyPolygonRanges);

      const layers = buildRowLayers([row('a', createBox(0, 0, 100, 100))], [], { getDirtyPolygonRanges, getDirtyPointRanges: noDirty });
      const fillLayer = layers.find(l => l instanceof SolidPolygonLayer) as SolidPolygonLayer<RenderRow>;
      const strokeLayer = layers.find(l => l instanceof PathLayer) as PathLayer<RenderRow>;

      // @ts-expect-error - accessing internal props for test purposes
      expect(fillLayer.props._dataDiff(fillLayer.props.data, fillLayer.props.data)).toEqual(dirtyPolygonRanges);
      // @ts-expect-error - accessing internal props for test purposes
      expect(strokeLayer.props._dataDiff(strokeLayer.props.data, strokeLayer.props.data)).toEqual(dirtyPolygonRanges);
      // The underlying getter is only consulted ONCE, even though two
      // independent layers (fill + stroke) both asked for it - see
      // shareDirtyReader in row-store.ts. If this were called twice, the
      // second layer would silently see an already-drained (empty) result
      // in the real RowStore-backed case.
      expect(getDirtyPolygonRanges).toHaveBeenCalledTimes(1);
    });

    it('does NOT call the dirty-range getters eagerly at construction time - only when _dataDiff is actually invoked', () => {
      // This is the crux of a real bug that was fixed: deck.gl doesn't
      // reconcile `setProps({ layers })` synchronously, so a layer instance
      // built here might never be diffed at all (a newer one from a later
      // `submitLayers()` call can replace it first) - draining a RowStore's
      // dirty state eagerly, before deck.gl decides whether it even wants
      // this instance, would silently lose whatever was dirtied for any
      // instance that never gets reconciled. The getter must only run if
      // and when deck.gl itself calls `_dataDiff`.
      const getDirtyPolygonRanges = vi.fn(() => [{ startRow: 0, endRow: 1 }]);
      const getDirtyPointRanges = vi.fn(() => [{ startRow: 0, endRow: 1 }]);

      const layers = buildRowLayers([row('a', createBox(0, 0, 100, 100))], [row('b', createPoint(5, 5))], { getDirtyPolygonRanges, getDirtyPointRanges });

      expect(getDirtyPolygonRanges).not.toHaveBeenCalled();
      expect(getDirtyPointRanges).not.toHaveBeenCalled();

      const fillLayer = layers.find(l => l instanceof SolidPolygonLayer) as SolidPolygonLayer<RenderRow>;
      // @ts-expect-error - accessing internal props for test purposes
      fillLayer.props._dataDiff(fillLayer.props.data, fillLayer.props.data);
      expect(getDirtyPolygonRanges).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['polygon fill', (layers: ReturnType<typeof buildRowLayers>) => layers.find(l => l instanceof SolidPolygonLayer)],
      ['polygon stroke', (layers: ReturnType<typeof buildRowLayers>) => layers.find(l => l instanceof PathLayer)],
      ['points', (layers: ReturnType<typeof buildRowLayers>) => layers.find(l => l instanceof ScatterplotLayer)]
    ])('%s: reports _dataDiff as an empty array (cheap no-op) when nothing is dirty and the reference is unchanged', (_label, pick) => {
      const layers = buildRowLayers([row('a', createBox(0, 0, 100, 100))], [row('b', createPoint(5, 5))], { getDirtyPolygonRanges: noDirty, getDirtyPointRanges: noDirty });
      const layer = pick(layers)!;
      // @ts-expect-error - accessing internal props for test purposes
      expect(layer.props._dataDiff(layer.props.data, layer.props.data)).toEqual([]);
    });

    it('falls back to a full range covering the whole array when the data reference differs from oldData, WITHOUT consulting the dirty-range getter', () => {
      // The actual regression this guards: `RowStore.remove`'s swap-with-last
      // can replace the row at an index with a *different* row's data while
      // length stays the same. A same-index partial range (from the dirty
      // getter, computed against RowStore's own bookkeeping) was measured to
      // silently fail to visually update in exactly this case, even though
      // it correctly named the touched index - deck.gl's own `oldData` is
      // what must be trusted, not our tracking. See `dataDiffPropFor`'s doc
      // in layers.ts.
      const getDirtyPolygonRanges = vi.fn(() => [{ startRow: 0, endRow: 1 }]);
      const rowsA = [row('a', createBox(0, 0, 100, 100))];
      const rowsB = [row('b', createBox(0, 0, 100, 100))]; // a different reference AND different logical row

      const layers = buildRowLayers(rowsA, [], { getDirtyPolygonRanges, getDirtyPointRanges: noDirty });
      const fillLayer = layers.find(l => l instanceof SolidPolygonLayer) as SolidPolygonLayer<RenderRow>;

      // @ts-expect-error - accessing internal props for test purposes
      const result = fillLayer.props._dataDiff(rowsA, rowsB);

      expect(result).toEqual([{ startRow: 0, endRow: 1 }]); // full range covering the (1-row) array
      expect(getDirtyPolygonRanges).not.toHaveBeenCalled(); // the fine-grained tracking is bypassed entirely
    });

    it('treats a missing oldData (first-ever diff) the same as a reference change - full range, no fine-grained lookup', () => {
      const getDirtyPointRanges = vi.fn(() => [{ startRow: 0, endRow: 1 }]);
      const layers = buildRowLayers([], [row('a', createPoint(5, 5))], { getDirtyPolygonRanges: noDirty, getDirtyPointRanges });
      const layer = layers[0] as ScatterplotLayer<RenderRow>;

      // @ts-expect-error - accessing internal props for test purposes
      const result = layer.props._dataDiff(layer.props.data, undefined);

      expect(result).toEqual([{ startRow: 0, endRow: 1 }]);
      expect(getDirtyPointRanges).not.toHaveBeenCalled();
    });

  });

  describe('hover, via deck.gl\'s native highlightedObjectIndex (not row mutation)', () => {

    it('wires highlightedPolygonIndex/hoverFillColor/hoverLineColor to the fill and stroke layers', () => {
      const layers = buildRowLayers([row('a', createBox(0, 0, 100, 100))], [], {
        getDirtyPolygonRanges: noDirty,
        getDirtyPointRanges: noDirty,
        highlightedPolygonIndex: 0,
        hoverFillColor: [1, 2, 3, 255],
        hoverLineColor: [4, 5, 6, 255]
      });

      const fillLayer = layers.find(l => l instanceof SolidPolygonLayer) as SolidPolygonLayer<RenderRow>;
      const strokeLayer = layers.find(l => l instanceof PathLayer) as PathLayer<RenderRow>;

      expect(fillLayer.props.highlightedObjectIndex).toBe(0);
      expect(fillLayer.props.highlightColor).toEqual([1, 2, 3, 255]);
      expect(strokeLayer.props.highlightedObjectIndex).toBe(0);
      expect(strokeLayer.props.highlightColor).toEqual([4, 5, 6, 255]);
    });

    it('wires highlightedPointIndex/hoverFillColor to the point layer', () => {
      const layers = buildRowLayers([], [row('a', createPoint(5, 5))], {
        getDirtyPolygonRanges: noDirty,
        getDirtyPointRanges: noDirty,
        highlightedPointIndex: 0,
        hoverFillColor: [1, 2, 3, 255]
      });

      const pointLayer = layers.find(l => l instanceof ScatterplotLayer) as ScatterplotLayer<RenderRow>;
      expect(pointLayer.props.highlightedObjectIndex).toBe(0);
      expect(pointLayer.props.highlightColor).toEqual([1, 2, 3, 255]);
    });

    it('defaults highlightedObjectIndex to null when nothing is hovered - not undefined, not -1', () => {
      const layers = buildRowLayers(
        [row('a', createBox(0, 0, 100, 100))],
        [row('b', createPoint(5, 5))],
        { getDirtyPolygonRanges: noDirty, getDirtyPointRanges: noDirty }
      );

      layers.forEach(l => {
        // @ts-expect-error - accessing internal props for test purposes
        expect(l.props.highlightedObjectIndex).toBeNull();
      });
    });

    it('a polygon highlight never sets highlightedObjectIndex on the point layer, and vice versa', () => {
      const layers = buildRowLayers(
        [row('a', createBox(0, 0, 100, 100))],
        [row('b', createPoint(5, 5))],
        { getDirtyPolygonRanges: noDirty, getDirtyPointRanges: noDirty, highlightedPolygonIndex: 0, hoverFillColor: [1, 2, 3, 255] }
      );

      const pointLayer = layers.find(l => l instanceof ScatterplotLayer) as ScatterplotLayer<RenderRow>;
      expect(pointLayer.props.highlightedObjectIndex).toBeNull();
    });

  });

});
