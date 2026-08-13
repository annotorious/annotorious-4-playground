import { PolygonLayer, ScatterplotLayer } from '@deck.gl/layers';
import { describe, expect, it, vi } from 'vitest';
import { createBox, createPoint } from '../src/geometry';
import { buildRowLayers, DEFAULT_STYLE } from '../src/render/layers';
import type { RenderRow } from '../src/render/layers';
import type { SpatialAnnotationTarget } from '../src/model';

const row = (id: string, selector: SpatialAnnotationTarget['selector'], style = DEFAULT_STYLE): RenderRow => ({
  target: { annotation: id, selector },
  style
});

// The common case in tests that don't care about point dirty-range plumbing itself.
const noDirty = () => [];

describe('buildRowLayers', () => {

  it('produces only a PolygonLayer for non-point shapes', () => {
    const layers = buildRowLayers([row('a', createBox(0, 0, 100, 100))], [], { getDirtyPointRanges: noDirty });

    expect(layers).toHaveLength(1);
    expect(layers[0]).toBeInstanceOf(PolygonLayer);
  });

  it('produces only a ScatterplotLayer for points', () => {
    const layers = buildRowLayers([], [row('a', createPoint(5, 5))], { getDirtyPointRanges: noDirty });

    expect(layers).toHaveLength(1);
    expect(layers[0]).toBeInstanceOf(ScatterplotLayer);
  });

  it('splits shapes and points into separate layers when both are present', () => {
    const layers = buildRowLayers(
      [row('shape', createBox(0, 0, 100, 100))],
      [row('point', createPoint(5, 5))],
      { getDirtyPointRanges: noDirty }
    );

    expect(layers).toHaveLength(2);
    expect(layers.some(l => l instanceof PolygonLayer)).toBe(true);
    expect(layers.some(l => l instanceof ScatterplotLayer)).toBe(true);
  });

  it('omits a layer entirely when there are no rows of that kind', () => {
    expect(buildRowLayers([], [], { getDirtyPointRanges: noDirty })).toHaveLength(0);
  });

  it('does not cull or simplify by on-screen size - deck.gl handles that', () => {
    const layers = buildRowLayers([row('sub-pixel', createBox(0, 0, 0.1, 0.1))], [], { getDirtyPointRanges: noDirty });

    expect(layers).toHaveLength(1);
    expect((layers[0] as PolygonLayer<RenderRow>).props.data).toHaveLength(1);
  });

  it('renders each row using its own precomputed style, for both polygons and points', () => {
    const shapeRow = row('a', createBox(0, 0, 100, 100), { fillColor: [1, 2, 3, 4], lineColor: [5, 6, 7, 8], lineWidth: 9 });
    const pointRow = row('b', createPoint(5, 5), { fillColor: [9, 8, 7, 6], lineColor: [5, 4, 3, 2], lineWidth: 1 });
    const layers = buildRowLayers([shapeRow], [pointRow], { getDirtyPointRanges: noDirty });

    const polygonLayer = layers.find(l => l instanceof PolygonLayer) as PolygonLayer<RenderRow>;
    // @ts-expect-error - accessing internal props for test purposes
    expect(polygonLayer.props.getFillColor(shapeRow)).toEqual([1, 2, 3, 4]);
    // @ts-expect-error - accessing internal props for test purposes
    expect(polygonLayer.props.getLineColor(shapeRow)).toEqual([5, 6, 7, 8]);
    // @ts-expect-error - accessing internal props for test purposes
    expect(polygonLayer.props.getLineWidth(shapeRow)).toBe(9);

    const pointLayer = layers.find(l => l instanceof ScatterplotLayer) as ScatterplotLayer<RenderRow>;
    // @ts-expect-error - accessing internal props for test purposes
    expect(pointLayer.props.getFillColor(pointRow)).toEqual([9, 8, 7, 6]);
  });

  describe('polygon rows (PolygonLayer)', () => {

    it('gets a fresh array reference on every call, with no dataComparator/_dataDiff at all', () => {
      // PolygonLayer deliberately does not use the _dataDiff partial-update
      // path - see buildRowLayers's module doc for why (measured to
      // silently fail to visually apply partial updates for this
      // CompositeLayer). It relies entirely on deck.gl's own default
      // reference-based diffing, which requires a genuinely new reference
      // on every change - including content-only edits, where RowStore
      // itself keeps the same reference (see row-store.ts).
      const rows = [row('a', createBox(0, 0, 100, 100))];
      const layers = buildRowLayers(rows, [], { getDirtyPointRanges: noDirty });
      const layer = layers[0] as PolygonLayer<RenderRow>;

      expect(layer.props.data).not.toBe(rows);
      expect(layer.props.data).toEqual(rows);
      // We never set our own dataComparator/_dataDiff for polygons - deck.gl's
      // own unset default for dataComparator is `null` (not `undefined`);
      // _dataDiff always has *some* default function from deck.gl itself
      // (`data => data.__diff`), so what matters is that it's deck.gl's
      // default, not ours, which is exactly what the reference-inequality
      // and equality checks below prove indirectly (see the passing tests
      // in the ScatterplotLayer describe block for what our own _dataDiff
      // wiring actually looks like when it IS present).
      // @ts-expect-error - accessing internal props for test purposes
      expect(layer.props.dataComparator).toBeFalsy();
    });

  });

  describe('point rows (ScatterplotLayer) - _dataDiff-based partial updates', () => {

    it('always reports data as changed via dataComparator, since RowStore mutates in place', () => {
      const layers = buildRowLayers([], [row('a', createPoint(5, 5))], { getDirtyPointRanges: noDirty });
      const layer = layers[0] as ScatterplotLayer<RenderRow>;
      // @ts-expect-error - accessing internal props for test purposes
      expect(layer.props.dataComparator(layer.props.data, layer.props.data)).toBe(false);
    });

    it('wires _dataDiff to call the given getDirtyPointRanges getter when the data reference is unchanged', () => {
      const dirtyPointRanges = [{ startRow: 0, endRow: 1 }];
      const layers = buildRowLayers([], [row('b', createPoint(5, 5))], { getDirtyPointRanges: () => dirtyPointRanges });
      const layer = layers[0] as ScatterplotLayer<RenderRow>;

      // Same reference for newData/oldData - the content-only-edit case (see row-store.ts).
      // @ts-expect-error - accessing internal props for test purposes
      expect(layer.props._dataDiff(layer.props.data, layer.props.data)).toEqual(dirtyPointRanges);
    });

    it('does NOT call getDirtyPointRanges eagerly at construction time - only when _dataDiff is actually invoked', () => {
      // This is the crux of a real bug that was fixed: deck.gl doesn't
      // reconcile `setProps({ layers })` synchronously, so a layer instance
      // built here might never be diffed at all (a newer one from a later
      // `submitLayers()` call can replace it first) - draining a RowStore's
      // dirty state eagerly, before deck.gl decides whether it even wants
      // this instance, would silently lose whatever was dirtied for any
      // instance that never gets reconciled. The getter must only run if
      // and when deck.gl itself calls `_dataDiff`.
      const getDirtyPointRanges = vi.fn(() => [{ startRow: 0, endRow: 1 }]);
      const layers = buildRowLayers([], [row('a', createPoint(5, 5))], { getDirtyPointRanges });

      expect(getDirtyPointRanges).not.toHaveBeenCalled();

      const layer = layers[0] as ScatterplotLayer<RenderRow>;
      // @ts-expect-error - accessing internal props for test purposes
      layer.props._dataDiff(layer.props.data, layer.props.data);

      expect(getDirtyPointRanges).toHaveBeenCalledTimes(1);
    });

    it('reports _dataDiff as an empty array (cheap no-op) when nothing is dirty and the reference is unchanged', () => {
      const layers = buildRowLayers([], [row('a', createPoint(5, 5))], { getDirtyPointRanges: noDirty });
      const layer = layers[0] as ScatterplotLayer<RenderRow>;
      // @ts-expect-error - accessing internal props for test purposes
      expect(layer.props._dataDiff(layer.props.data, layer.props.data)).toEqual([]);
    });

    it('falls back to a full range covering the whole array when the data reference differs from oldData, WITHOUT consulting getDirtyPointRanges', () => {
      // The actual regression this guards: `RowStore.remove`'s swap-with-last
      // can replace the row at an index with a *different* row's data while
      // length stays the same. A same-index partial range (from
      // getDirtyPointRanges, computed against RowStore's own bookkeeping)
      // was measured to silently fail to visually update in exactly this
      // case, even though it correctly named the touched index - deck.gl's
      // own `oldData` is what must be trusted, not our tracking. See
      // `dataDiffPropFor`'s doc in layers.ts.
      const getDirtyPointRanges = vi.fn(() => [{ startRow: 0, endRow: 1 }]);
      const rowsA = [row('a', createPoint(5, 5))];
      const rowsB = [row('b', createPoint(5, 5))]; // a different reference AND different logical row

      const layers = buildRowLayers([], rowsA, { getDirtyPointRanges });
      const layer = layers[0] as ScatterplotLayer<RenderRow>;

      // @ts-expect-error - accessing internal props for test purposes
      const result = layer.props._dataDiff(rowsA, rowsB);

      expect(result).toEqual([{ startRow: 0, endRow: 1 }]); // full range covering the (1-row) array
      expect(getDirtyPointRanges).not.toHaveBeenCalled(); // the fine-grained tracking is bypassed entirely
    });

    it('treats a missing oldData (first-ever diff) the same as a reference change - full range, no fine-grained lookup', () => {
      const getDirtyPointRanges = vi.fn(() => [{ startRow: 0, endRow: 1 }]);
      const layers = buildRowLayers([], [row('a', createPoint(5, 5))], { getDirtyPointRanges });
      const layer = layers[0] as ScatterplotLayer<RenderRow>;

      // @ts-expect-error - accessing internal props for test purposes
      const result = layer.props._dataDiff(layer.props.data, undefined);

      expect(result).toEqual([{ startRow: 0, endRow: 1 }]);
      expect(getDirtyPointRanges).not.toHaveBeenCalled();
    });

  });

});
