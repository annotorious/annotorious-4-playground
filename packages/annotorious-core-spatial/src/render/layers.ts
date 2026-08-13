import type { Layer } from '@deck.gl/core';
import { PathLayer, ScatterplotLayer, SolidPolygonLayer } from '@deck.gl/layers';
import { boxCorners, ShapeType } from '../geometry';
import type { Point, SpatialShape } from '../geometry';
import type { SpatialAnnotationTarget } from '../model';
import type { DirtyRange } from './row-store';
import { shareDirtyReader } from './row-store';

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

// Only ever used while a `highlighted*Index` is actually set (i.e. something
// really is hovered) - the exact value is irrelevant otherwise, so this is
// just a harmless default, not a meaningful style choice.
const FALLBACK_HIGHLIGHT_COLOR: [number, number, number, number] = [255, 255, 255, 255];

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

// `SolidPolygonLayer`'s fill triangulates an open or closed ring the same
// way, but `PathLayer` draws exactly the segments it's given - an open ring
// would leave the outline missing its last edge. `PolygonLayer` (which
// internally uses both) closes this for you; using them separately means
// doing it ourselves.
const closedRing = (ring: [number, number][]): [number, number][] =>
  ring.length > 0 ? [...ring, ring[0]!] : ring;

const pointPosition = (shape: Point): [number, number] => [shape.geometry.x, shape.geometry.y];

// Always reports "changed", regardless of whether `data`'s array reference
// actually differs from last time - required because RowStore mutates most
// updates in place (see row-store.ts's module doc): without this, deck.gl's
// default `newProps.data !== oldProps.data` reference check would see the
// same array and conclude nothing changed, silently dropping the edit.
// Paired with `_dataDiff` below, which is what keeps that "always changed"
// cheap - see its own comment.
const alwaysChanged = () => false;

/**
 * `getDirtyRanges` is `RowStore.consumeDirty` itself (typically wrapped in
 * `shareDirtyReader` - see below) - passed through and called *lazily*,
 * exactly when (and only when) deck.gl actually invokes `_dataDiff`, rather
 * than pre-computed once when this layer instance is constructed. That
 * distinction matters and was the cause of a real bug: `deck.setProps({
 * layers })` doesn't reconcile synchronously - it just records the array for
 * the *next* animation frame (`LayerManager.setProps`/`_nextLayers`,
 * verified in deck.gl's source). Calling `submitLayers()` more than once
 * before that frame arrives (a dense hover sweep touching several different
 * rows in quick succession; several store writes landing in the same JS
 * tick) constructs several layer instances, of which only the *last* one
 * deck.gl ever reconciles - the rest, and whatever `_dataDiff` closure they
 * were built with, are simply discarded, never invoked. A closure that had
 * already drained `consumeDirty()` at construction time meant those
 * discarded instances' dirty rows were gone for good: correctly written
 * into the row array, but never reported to deck.gl, so the GPU-side
 * attribute buffer was never told to refresh them - visible as
 * hover/selection styling that "trails" stuck shapes behind a fast mouse
 * sweep. Deferring the `consumeDirty()` call to the moment deck.gl actually
 * invokes `_dataDiff` fixes this: whichever instance ends up being the one
 * that's actually diffed correctly reports *everything* dirtied since the
 * last real reconcile, no matter how many discarded instances happened in
 * between.
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
 * (a draft being replaced by its committed real shape at the same slot,
 * or one row swap-removed into another's old slot). Reference inequality
 * catches this correctly because `RowStore` already guarantees the
 * converse: the array reference only ever stays the same across an
 * unchanged-length, same-identity-at-every-index content mutation -
 * anything else, including a same-length swap, gets a fresh reference.
 *
 * An empty array is a legitimate, cheap no-op (nothing dirty since the
 * last real diff). A non-empty `DirtyRange[]` tells deck.gl's
 * `AttributeManager` to only re-invoke accessors and re-upload GPU buffer
 * bytes for those row ranges, leaving everything else untouched. Verified
 * against deck.gl's actual source (not just the docs) to flow all the way
 * through to a partial `bufferSubData`-style write, and verified
 * empirically (real GPU, pixel-level screenshots) for both `ScatterplotLayer`
 * (points) and `SolidPolygonLayer`/`PathLayer` (polygon fill/stroke) -
 * *not* for the composite `PolygonLayer`, which silently fails to apply
 * the same partial update despite wrapping the exact same sub-layers; see
 * `buildRowLayers`'s doc for the full story of why polygons are built from
 * `SolidPolygonLayer` + `PathLayer` directly instead of `PolygonLayer`.
 *
 * Note `_dataDiff` is an *experimental* deck.gl prop (their own docs mark
 * it as such) - not part of the semver-covered stable API, so it could
 * change or be removed in a future deck.gl major version without warning
 * in the way a stable prop would. It's been present and behaviorally
 * unchanged since at least deck.gl v5 (2018) for this exact "update a few
 * rows out of many, cheaply" use case, with no deprecation notice anywhere
 * in the current docs/changelog/upgrade guide as of this writing - so
 * treated here as a reasonably safe bet, not a guaranteed-stable one. If a
 * future deck.gl upgrade removes it, the fallback is: rebuild the full data
 * array on every change - correct, just back to O(n) per edit instead of
 * O(1) (see git history for the pre-`_dataDiff` version of this file).
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
  getDirtyPolygonRanges: () => DirtyRange[];

  /** Typically `RowStore.consumeDirty` - see `dataDiffPropFor`'s doc for why this must be called lazily, not pre-computed. **/
  getDirtyPointRanges: () => DirtyRange[];

  /** `RowStore.indexOf` result for the currently-hovered polygon row, or `null`/`undefined` if none - see the module doc's "Hover" section. **/
  highlightedPolygonIndex?: number | null;

  /** Same as `highlightedPolygonIndex`, for the point layer. **/
  highlightedPointIndex?: number | null;

  /** Fill color (and point fill+stroke color) to blend onto whichever row `highlightedPolygonIndex`/`highlightedPointIndex` points at - typically the hovered row's own resolved style, alpha 255 for a full replace. Ignored when the corresponding index is null. **/
  hoverFillColor?: [number, number, number, number] | undefined;

  /** Stroke color for the polygon layer's highlighted row - see `hoverFillColor`. **/
  hoverLineColor?: [number, number, number, number] | undefined;

}

/**
 * Builds the deck.gl layers for `polygonRows` and `pointRows` -
 * `SolidPolygonLayer` (fill) + `PathLayer` (stroke) for the former,
 * `ScatterplotLayer` for the latter. deck.gl/the GPU handles culling what's
 * off-screen via the camera transform; this does no viewport culling or
 * level-of-detail simplification of its own on top of that.
 *
 * All layers are `pickable: false` - hit-testing goes through a spatial
 * index (see `AnnotationIndex.getAt`) against actual geometry, not GPU color
 * picking. This was measured, not assumed: a real `pickObject()` call
 * against 100k-300k pickable instances costs 15-42ms *regardless of how
 * much of that data is actually visible in the current viewport* (GPU
 * picking still vertex-shades every instance in the layer, not just what
 * survives frustum culling) - too slow to run on every pointermove at that
 * scale, where the CPU spatial index answers the same query in well under a
 * millisecond.
 *
 * Every layer here uses `_dataDiff` for genuine O(1)-per-edit partial
 * updates (see `dataDiffPropFor`'s doc) - including polygons, which is
 * notable given the history: this was *not* the first design. Polygon
 * rendering was originally the composite `PolygonLayer` (`stroked: true,
 * filled: true` in one call), still using `_dataDiff` the same way - and it
 * was *wrong*: measured directly (real browser, real GPU, pixel-level
 * screenshots, not just accessor call counts or store state, both of which
 * looked correct and were misleading) to silently fail to visually apply a
 * row's changed geometry/color, even for the simplest possible case
 * (editing one already-shaped box's position, nothing else on the page).
 * `ScatterplotLayer` (points) never had this problem. The difference turned
 * out to be the composite layer itself, not the underlying triangulated
 * geometry: `SolidPolygonLayer` and `PathLayer` - the two plain `Layer`s
 * `PolygonLayer` wraps internally - each handle `_dataDiff` correctly on
 * their own (verified the same way, including the swap-with-last identity
 * case), it's specifically `PolygonLayer`'s composite-layer re-render
 * gating that doesn't propagate a `_dataDiff`-only change down to its
 * sub-layers' props. So polygons are built from the two sub-layers
 * directly, bypassing the composite wrapper entirely - same visual result
 * (a filled, stroked shape), same O(1)-per-edit cost as points.
 *
 * Fill and stroke are two independent deck.gl layers reading from the same
 * `polygonRows`/dirty tracking, each with their own lazily-invoked
 * `_dataDiff` - `shareDirtyReader` (see row-store.ts) ensures the first one
 * deck.gl actually diffs in a given reconciliation pass doesn't drain the
 * dirty state out from under the other.
 *
 * ## Hover
 *
 * Hover is rendered via deck.gl's own `highlightedObjectIndex`/
 * `highlightColor` (every `Layer` supports these natively - no `pickable`,
 * no GPU picking pass required, since the index is supplied externally from
 * `render-loop.ts`'s own RBush-backed hit-test rather than deck.gl's) -
 * *not* by mutating the hovered row's own `style`, unlike selection (still
 * row-mutation-based, via `RenderRow.style` - see render-loop.ts's
 * `setSelected`). This was a deliberate, measured change: mutating a row for
 * every hover change means constructing a fresh layer instance whose `data`
 * reference is unchanged (so `_dataDiff` correctly reports only that one
 * row dirty) - correct, but still capped at ~40fps at 100k polygons in
 * practice (measured), for reasons not fully explained even after the
 * `PolygonLayer` fix above. Routing hover through `highlightedObjectIndex`
 * instead - which touches no row data, no `_dataDiff`, no `AttributeManager`
 * invalidation at all, just a per-layer prop - measured at ~57-59fps for the
 * identical 100k-polygon workload, using deck.gl's own shader-side highlight
 * blend (`picking_filterHighlightColor`: `mix(baseColor, highlightColor,
 * highlightColor.a)`, i.e. alpha 255 = full replace, matching what
 * `getStyle(target, {hovered: true})` used to do via row mutation) instead
 * of touching GPU buffers at all. The remaining ~1-3fps gap versus points
 * (which stay ~60fps either way) still isn't explained - likely the same
 * unresolved layer-instantiation cost noted above, just smaller since no
 * data reconciliation happens at all now.
 *
 * Only a single index can be highlighted this way (not an array), which is
 * exactly right for hover (`hover.current` is always at most one id) but
 * doesn't extend to multi-select selection - selection keeps the row-mutation
 * path, which is fine given it only changes on deliberate clicks, not on
 * every pointermove the way hover does.
 *
 * A session's *first* hover at 100k polygons still pays a real, measured,
 * one-time cost (100,000 `getFillColor` calls) that every hover after it
 * does not. An attempted fix (keeping `highlightedObjectIndex` permanently
 * non-null via a fixed warm-up index, so deck.gl's picking-color buffer
 * would already be allocated before the user's first real hover) was tried
 * and reverted - direct A/B accessor-call-counting against the real 100k-row
 * layers showed it made no measurable difference at all: reverting to the
 * simple `?? null` form here reproduced the identical call pattern. The
 * actual trigger, isolated by varying one prop at a time against the real
 * shipped code, is `highlightColor`'s *value* changing between successive
 * layer submissions (not `highlightedObjectIndex` going from null to
 * non-null, which was the original, incorrect theory) - toggling the index
 * between two rows while `highlightColor` stays byte-identical costs
 * nothing on any call, but the first time `highlightColor` itself changes
 * value (inevitable exactly once, going from "nothing hovered" to "the
 * first real hover's resolved color") costs the full 100k-row recompute
 * regardless of which index is involved. Not root-caused further - not
 * an accessor-vs-uniform distinction confirmed against deck.gl's own
 * source, just an empirically isolated trigger. Since almost all real
 * hover styling resolves to the same color across different rows (as both
 * this repo's demo and test harnesses do), this cost is paid at most once
 * per session in practice, not per-hover - not worth a warm-up hack that
 * measurably does nothing.
 */
export const buildRowLayers = <T extends SpatialAnnotationTarget>(
  polygonRows: readonly RenderRow<T>[],
  pointRows: readonly RenderRow<T>[],
  opts: BuildRowLayerOptions
): Layer[] => {
  const pointRadiusMinPixels = opts.pointRadiusMinPixels ?? 4;

  const layers: Layer[] = [];

  if (polygonRows.length > 0) {
    const getDirtyPolygonRanges = shareDirtyReader(opts.getDirtyPolygonRanges);

    layers.push(new SolidPolygonLayer<RenderRow<T>>({
      id: 'annotations-shapes-fill',
      data: polygonRows,
      dataComparator: alwaysChanged,
      ...dataDiffPropFor(getDirtyPolygonRanges),
      pickable: false,
      filled: true,
      getPolygon: r => shapeToPolygonRing(r.target.selector),
      getFillColor: r => r.style.fillColor,
      highlightedObjectIndex: opts.highlightedPolygonIndex ?? null,
      highlightColor: opts.hoverFillColor ?? FALLBACK_HIGHLIGHT_COLOR
    }));

    layers.push(new PathLayer<RenderRow<T>>({
      id: 'annotations-shapes-stroke',
      data: polygonRows,
      dataComparator: alwaysChanged,
      ...dataDiffPropFor(getDirtyPolygonRanges),
      pickable: false,
      widthUnits: 'pixels',
      getPath: r => closedRing(shapeToPolygonRing(r.target.selector)),
      getColor: r => r.style.lineColor,
      getWidth: r => r.style.lineWidth,
      highlightedObjectIndex: opts.highlightedPolygonIndex ?? null,
      highlightColor: opts.hoverLineColor ?? FALLBACK_HIGHLIGHT_COLOR
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
      radiusMinPixels: pointRadiusMinPixels,
      highlightedObjectIndex: opts.highlightedPointIndex ?? null,
      highlightColor: opts.hoverFillColor ?? FALLBACK_HIGHLIGHT_COLOR
    }));
  }

  return layers;
}
