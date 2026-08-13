import type { Layer } from '@deck.gl/core';
import { PolygonLayer, ScatterplotLayer } from '@deck.gl/layers';
import { boxCorners, ShapeType } from '../geometry';
import type { Point, SpatialShape } from '../geometry';
import type { SpatialAnnotationTarget } from '../model';
import type { DirtyRange } from './row-store';

export interface RenderStyle {

  fillColor?: [number, number, number, number];

  lineColor?: [number, number, number, number];

  /** Screen pixels. **/
  lineWidth?: number;

}

export const DEFAULT_STYLE: Required<RenderStyle> = {
  fillColor: [255, 200, 0, 60],
  lineColor: [255, 200, 0, 220],
  lineWidth: 2
};

/**
 * One renderable row: a world-space target plus its fully-resolved style.
 * Style is resolved once, up front, whenever a row is (re)written into a
 * `RowStore` - not recomputed here on every accessor call - so this module
 * stays a pure, mechanical "rows in, deck.gl layers out" translation with no
 * knowledge of annotation state, style callbacks, or drafts. See
 * render-loop.ts for where rows actually get built.
 */
export interface RenderRow<T extends SpatialAnnotationTarget = SpatialAnnotationTarget> {

  target: T;

  style: Required<RenderStyle>;

}

const shapeToPolygonRing = (shape: SpatialShape): [number, number][] => {
  switch (shape.type) {
    case ShapeType.BOX: return boxCorners(shape.geometry);
    case ShapeType.POLYGON: return shape.geometry.points;
    case ShapeType.POINT: throw new Error('A point has no polygon representation');
  }
}

const pointPosition = (shape: Point): [number, number] => [shape.geometry.x, shape.geometry.y];

// Always reports "changed", regardless of whether `data`'s array reference
// actually differs from last time - required because RowStore mutates most
// updates in place (see row-store.ts's module doc): without this, deck.gl's
// default `newProps.data !== oldProps.data` reference check would see the
// same array and conclude nothing changed, silently dropping the edit.
// Paired with `_dataDiff` below, which is what keeps that "always changed"
// cheap - see its own comment. Only used for `ScatterplotLayer` (points) -
// see the module doc on `buildRowLayers` for why `PolygonLayer` doesn't use
// this at all.
const alwaysChanged = () => false;

/**
 * `getDirtyRanges` is `RowStore.consumeDirty` itself - passed through and
 * called *lazily*, exactly when (and only when) deck.gl actually invokes
 * `_dataDiff`, rather than pre-computed once when this layer instance is
 * constructed. That distinction matters and was the cause of a real bug:
 * `deck.setProps({ layers })` doesn't reconcile synchronously - it just
 * records the array for the *next* animation frame
 * (`LayerManager.setProps`/`_nextLayers`, verified in deck.gl's source).
 * Calling `submitLayers()` more than once before that frame arrives (a
 * dense hover sweep touching several different rows in quick succession;
 * several store writes landing in the same JS tick) constructs several
 * layer instances, of which only the *last* one deck.gl ever reconciles -
 * the rest, and whatever `_dataDiff` closure they were built with, are
 * simply discarded, never invoked. A closure that had already drained
 * `consumeDirty()` at construction time meant those discarded instances'
 * dirty rows were gone for good: correctly written into the row array, but
 * never reported to deck.gl, so the GPU-side attribute buffer was never
 * told to refresh them - visible as hover/selection styling that "trails"
 * stuck shapes behind a fast mouse sweep. Deferring the `consumeDirty()`
 * call to the moment deck.gl actually invokes `_dataDiff` fixes this:
 * whichever instance ends up being the one that's actually diffed
 * correctly reports *everything* dirtied since the last real reconcile,
 * no matter how many discarded instances happened in between.
 *
 * `newData !== oldData` (array *reference* inequality, not just length) is
 * *also* checked, using deck.gl's own `oldData` - the array it actually
 * last reconciled - rather than anything tracked independently on our
 * side, for the same reason: comparing against a flag or reference *we*
 * last saw can disagree with what deck.gl actually last saw, across
 * discarded instances. This catches a case length-comparison alone
 * wouldn't: `RowStore.remove`'s swap-with-last (see its module doc) can
 * replace the row at an index with a *different* row's data while the
 * array's overall length stays the same. `_dataDiff`'s documented contract
 * is "the object at this index was mutated" - verified (against deck.gl's
 * actual `AttributeManager`, not just the docs) to hold only for that
 * exact case: the *same logical row*, edited in place. A partial range
 * covering an index whose *occupant* changed identity - not just value -
 * was measured to silently fail to visually update, even though the
 * reported range was technically accurate about which index changed
 * (a draft being replaced by its committed real shape at the same slot).
 * Reference inequality catches this correctly because `RowStore` already
 * guarantees the converse: the array reference only ever stays the same
 * across an unchanged-length, same-identity-at-every-index content
 * mutation - anything else, including a same-length swap, gets a fresh
 * reference.
 *
 * An empty array is a legitimate, cheap no-op (nothing dirty since the
 * last real diff). A non-empty `DirtyRange[]` tells deck.gl's
 * `AttributeManager` to only re-invoke accessors and re-upload GPU buffer
 * bytes for those row ranges, leaving everything else untouched. Verified
 * against deck.gl's actual source (not just the docs) to flow all the way
 * through to a partial `bufferSubData`-style write, and verified
 * empirically to be a large (measured 6-7x at 100k-300k rows, and more in
 * the real app once JS-side row-rebuild overhead is also accounted for)
 * speedup for a single-row content edit versus rebuilding the array from
 * scratch - for `ScatterplotLayer`. See the module doc on `buildRowLayers`
 * for why the same approach doesn't hold for `PolygonLayer`.
 *
 * Note `_dataDiff` is an *experimental* deck.gl prop (their own docs mark
 * it as such) - not part of the semver-covered stable API, so it could
 * change or be removed in a future deck.gl major version without warning
 * in the way a stable prop would. It's been present and behaviorally
 * unchanged since at least deck.gl v5 (2018) for this exact "update a few
 * rows out of many, cheaply" use case, with no deprecation notice anywhere
 * in the current docs/changelog/upgrade guide as of this writing - so
 * treated here as a reasonably safe bet, not a guaranteed-stable one. If a
 * future deck.gl upgrade removes it, the fallback is exactly what
 * `PolygonLayer` already uses below: rebuild the full data array on every
 * change - correct, just back to O(n) per edit instead of O(1).
 */
const dataDiffPropFor = (getDirtyRanges: () => DirtyRange[]) => ({
  // Cast: deck.gl declares `_dataDiff` generically over `LayerDataT`, but at
  // runtime it's always called with the layer's own `data` prop (here,
  // always an array) - the concrete `readonly unknown[]` signature below is
  // accurate to the actual call, just not expressible against the generic
  // declared type.
  _dataDiff: ((newData: readonly unknown[], oldData?: readonly unknown[]) => {
    if (!oldData || newData !== oldData) {
      return newData.length > 0 ? [{ startRow: 0, endRow: newData.length }] : [];
    }
    return getDirtyRanges();
  }) as () => DirtyRange[]
});

export interface BuildRowLayerOptions {

  /** Screen-constant minimum radius (px) for point annotations. Default 4. **/
  pointRadiusMinPixels?: number;

  /** Typically `RowStore.consumeDirty` - see `dataDiffPropFor`'s doc for why this must be called lazily, not pre-computed. **/
  getDirtyPointRanges: () => DirtyRange[];

}

/**
 * Builds (at most) one `PolygonLayer` for `polygonRows` and one
 * `ScatterplotLayer` for `pointRows` - deck.gl/the GPU handles culling
 * what's off-screen via the camera transform; this does no viewport culling
 * or level-of-detail simplification of its own on top of that.
 *
 * Both layers are `pickable: false` - hit-testing goes through a spatial
 * index (see `AnnotationIndex.getAt`) against actual geometry, not GPU color
 * picking. This was measured, not assumed: a real `pickObject()` call
 * against 100k-300k pickable instances costs 15-42ms *regardless of how
 * much of that data is actually visible in the current viewport* (GPU
 * picking still vertex-shades every instance in the layer, not just what
 * survives frustum culling) - too slow to run on every pointermove at that
 * scale, where the CPU spatial index answers the same query in well under a
 * millisecond.
 *
 * `pointRows` uses `_dataDiff` for genuine O(1)-per-edit partial updates
 * (see `dataDiffPropFor`'s doc). `polygonRows` deliberately does NOT: it
 * gets a fresh top-level array reference (`[...polygonRows]`) on every
 * call instead, with no `dataComparator`/`_dataDiff` at all, relying on
 * deck.gl's own default "data reference changed -> full recompute" path.
 * This was not the original design - `PolygonLayer` was first built with
 * the same `_dataDiff`-driven partial-update approach as `ScatterplotLayer`
 * above, and it was *wrong*: measured directly (real browser, real GPU,
 * pixel-level screenshots, not just accessor call counts or store state -
 * those all looked correct and were misleading) to silently fail to
 * visually update a row's geometry/color after a partial-range `_dataDiff`
 * report, even for the simplest possible case (editing one already-shaped
 * box's position, nothing else on the page). `ScatterplotLayer` - a plain
 * `Layer` with simple, fixed-size-per-instance attributes - handles the
 * exact same pattern correctly. The working theory (not fully confirmed
 * against deck.gl's source, given how much time chasing the partial-update
 * path already cost): `PolygonLayer` is a `CompositeLayer` wrapping
 * `SolidPolygonLayer`/`PathLayer`, whose vertex data is variable-width
 * (triangulated, point-count-per-row varies) rather than one fixed-size
 * slot per row - a composite layer's own decision to regenerate its
 * sub-layers' props appears to depend on something `dataComparator`
 * bypasses, so `_dataDiff`'s dirty ranges can end up correctly reported to
 * deck.gl but never actually reach the sub-layer that would act on them.
 * `[...polygonRows]` is a cheap O(n) *reference* copy (not a deep clone,
 * and RowStore's row objects themselves are reused) - real cost, measured
 * in the actual app: editing one box out of 100,000 drops from 60fps to
 * roughly 7-8fps, i.e. it's back to the pre-`RowStore` cost profile for
 * polygon/box edits specifically, though still cheaper than the original
 * architecture's full row-rebuild-with-object-reconstruction-and-restyling
 * per edit. Points are unaffected and keep the full O(1) benefit. A
 * `SolidPolygonLayer` + separate stroke `PathLayer` (bypassing the
 * `PolygonLayer` composite entirely, mirroring `hint-layers.ts`'s existing
 * split-layer pattern) is the likely path to recovering this for polygons
 * too, if it's worth the added complexity - not attempted here.
 */
export const buildRowLayers = <T extends SpatialAnnotationTarget>(
  polygonRows: readonly RenderRow<T>[],
  pointRows: readonly RenderRow<T>[],
  opts: BuildRowLayerOptions
): Layer[] => {
  const pointRadiusMinPixels = opts.pointRadiusMinPixels ?? 4;

  const layers: Layer[] = [];

  if (polygonRows.length > 0) {
    layers.push(new PolygonLayer<RenderRow<T>>({
      id: 'annotations-shapes',
      data: [...polygonRows],
      pickable: false,
      stroked: true,
      filled: true,
      getPolygon: r => shapeToPolygonRing(r.target.selector),
      getFillColor: r => r.style.fillColor,
      getLineColor: r => r.style.lineColor,
      getLineWidth: r => r.style.lineWidth,
      lineWidthUnits: 'pixels'
    }));
  }

  if (pointRows.length > 0) {
    layers.push(new ScatterplotLayer<RenderRow<T>>({
      id: 'annotations-points',
      data: pointRows,
      dataComparator: alwaysChanged,
      ...dataDiffPropFor(opts.getDirtyPointRanges),
      pickable: false,
      stroked: true,
      filled: true,
      getPosition: r => pointPosition(r.target.selector as Point),
      getFillColor: r => r.style.fillColor,
      getLineColor: r => r.style.lineColor,
      getLineWidth: r => r.style.lineWidth,
      lineWidthUnits: 'pixels',
      radiusUnits: 'pixels',
      getRadius: pointRadiusMinPixels,
      radiusMinPixels: pointRadiusMinPixels
    }));
  }

  return layers;
}
