import { Deck, OrthographicView } from '@deck.gl/core';
import type { AnnotationState, Filter, Store, StoreChangeEvent, ViewportState } from '@annotorious/core';
import type { Bounds } from '../geometry';
import { ShapeType } from '../geometry';
import type { DraftStore } from '../draft-store';
import type { ImageIndexes } from '../image-indexes';
import type { SpatialAnnotation, SpatialAnnotationTarget } from '../model';
import { markAsApplicationRegion } from './display-container';
import { buildRowLayers, DEFAULT_STYLE } from './layers';
import type { RenderRow, RenderStyle } from './layers';
import { createRowStore } from './row-store';
import { buildHintLayers } from './hint-layers';
import type { RenderViewport } from './render-viewport';
import type { ToolHint } from '../tools/tool-hint';

export interface DeckRenderLoopOptions {

  /** Read fresh whenever a row is (re)built - see the module doc for how state reaches this. **/
  getStyle?: (target: SpatialAnnotationTarget, state: AnnotationState) => RenderStyle | undefined;

  /** Read fresh on every render - lets `setFilter` take effect without recreating the overlay. **/
  getFilter?: () => Filter<SpatialAnnotation> | undefined;

}

/**
 * The handful of things that differ between viewer backends - everything
 * else in the render loop (row bookkeeping, style, hit-testing scope) is
 * identical between them and lives here instead of being duplicated per
 * package.
 */
export interface ViewerAdapter<Img> {

  /** All currently registered images, each with the `source` id its annotations carry. **/
  images(): { source: string | undefined, image: Img }[];

  getImage(source: string | undefined): Img | undefined;

  /** Where to measure the canvas size from - not necessarily the same element the canvas mounts into (e.g. OpenSeadragon's `viewer.canvas` vs `viewer.container`). **/
  getContainerSize(): { width: number, height: number };

  /** World-space bounds currently visible, plus world units per screen pixel - see `RenderViewport`. **/
  getRenderViewport(): RenderViewport;

  targetToWorld<T extends SpatialAnnotationTarget>(image: Img, target: T): T;

  worldBoundsToLocal(image: Img, bounds: Bounds): Bounds;

  hintToWorld(image: Img, hint: ToolHint): ToolHint;

}

const DRAFT_STYLE: Required<RenderStyle> = { fillColor: [26, 115, 232, 60], lineColor: [26, 115, 232, 255], lineWidth: 2 };

// How long to wait, after the viewport stops changing, before recomputing
// viewportIntersect - see module doc below.
const VIEWPORT_SETTLE_MS = 500;

/**
 * Owns the DeckGL canvas and render loop for a spatial annotator. Shared
 * across viewer backends (OpenSeadragon, OpenLayers, ...) via `ViewerAdapter`
 * - each backend supplies only how to read its own viewport and transform
 * coordinates; everything else (row bookkeeping, style, the pan/zoom fast
 * path) is identical regardless of which viewer it's attached to, so it
 * lives here once instead of being copy-pasted per package.
 *
 * Every committed annotation (plus drafts) is handed to deck.gl unfiltered
 * by viewport - no CPU-side viewport culling, no level-of-detail
 * simplification. deck.gl already culls what's off-screen via the camera
 * transform (that's what the GPU rasterizer does for free); duplicating
 * that decision on the CPU, or second-guessing it with our own LOD
 * simplification, was strictly worse than just handing deck.gl the data and
 * letting it do the one job it's built for. Concretely: pan/zoom
 * (`notifyViewportChanged`) only ever updates the camera (`paintCamera`) -
 * it never touches annotation data at all.
 *
 * Annotation data lives in exactly two `RowStore`s (`polygonRows`,
 * `pointRows` - one deck.gl layer each), each a persistent,
 * densely-packed array where every annotation keeps a stable index across
 * edits (see row-store.ts). A store/draft mutation, a hover/selection
 * change, or a filter/style change all boil down to the same operation:
 * mutate the handful of rows that actually changed, then hand deck.gl the
 * (mostly unchanged) array back.
 *
 * For `pointRows`, that handoff goes through deck.gl's own `_dataDiff`
 * partial-update mechanism (see `layers.ts`), which re-invokes accessors
 * and re-uploads GPU buffer bytes for only the changed rows - verified
 * (against deck.gl's actual source, not just the docs, and empirically
 * against a real GPU) to make a single-row edit cost the same regardless of
 * whether there are 1,000 or 300,000 other points on screen.
 *
 * `polygonRows` does NOT get the same treatment, and this is a deliberate,
 * measured tradeoff, not an oversight: `_dataDiff`-driven partial updates
 * were built for `PolygonLayer` too, and were wrong - verified (real
 * browser, real GPU, pixel-level screenshots) to silently fail to visually
 * apply a row's changed geometry/color, even for the simplest single-shape
 * edit. `layers.ts`'s module doc has the full story and the working theory
 * (a `CompositeLayer`-specific limitation, not something in this module's
 * control). `polygonRows` therefore always gets a full recompute - cheap to
 * *construct* (RowStore's O(1) bookkeeping and stable indices still avoid
 * the old architecture's per-edit row/style reconstruction), but O(n) for
 * deck.gl to actually redraw. Concretely: editing one box out of 100,000
 * runs at roughly 7-8fps, not the 60fps a point annotation gets under the
 * same edit. An ordinary drag - local *or* a remote collaborator's,
 * arriving as ordinary `Origin.REMOTE` store writes indistinguishable in
 * shape from a local edit - touches exactly one row either way:
 * `onStoreChange` re-resolves that one annotation's row synchronously, on
 * every single target update, with no debounce and no second "active"
 * layer to reconcile later - multiple people editing different *points* at
 * once costs O(number of concurrent edits); multiple people editing
 * different *polygons* at once costs O(concurrent edits × total polygon
 * count), same as the pre-rewrite architecture.
 *
 * This replaced an earlier design that hand-rolled a "base/active layer"
 * split plus a per-id settle-debounce timer specifically to avoid a full
 * rebuild on every edit - a problem `_dataDiff` solves natively for points,
 * more simply and dramatically faster at 100k-300k rows (measured); for
 * polygons it's a wash on raw redraw cost, but still simpler and removes
 * the settle-debounce lag (a remote collaborator's polygon edit is visible
 * immediately, not up to 500ms later).
 *
 * `viewportIntersect` (the "visible annotations" lifecycle signal) is the
 * one thing that still needs to know what's actually on screen, so it's
 * the one thing still driven by a debounced (`scheduleSettledRefresh`)
 * spatial query - after pan/zoom, *and* after a store change (see
 * `onStoreChange`) - informational, not render-critical, so it doesn't need
 * per-edit freshness. deck.gl has no public API for "which instances
 * survived GPU culling this frame", so this still goes through the CPU
 * spatial index - not a hand-rolled workaround, just the only tool that
 * answers this particular question. It does need to stay debounced rather
 * than synchronous, though: it sorts and joins every currently-visible id
 * into a dedup key, which was measured (not assumed) to cost 100ms+ on its
 * own at 100k+ mostly-visible annotations - cheap once per settled burst,
 * but exactly the kind of per-edit cost the rest of this module works to
 * avoid if it ran on every single store change synchronously instead.
 */
export const createDeckRenderLoop = <Img>(
  mount: HTMLElement,
  store: Store<SpatialAnnotation>,
  imageIndexes: ImageIndexes,
  draftStore: DraftStore<SpatialAnnotationTarget>,
  viewport: ViewportState,
  adapter: ViewerAdapter<Img>,
  opts: DeckRenderLoopOptions = {}
) => {
  let containerWidth = 0;
  let containerHeight = 0;

  const canvasdiv = document.createElement('div');
  canvasdiv.style.position = 'absolute';
  canvasdiv.style.left = '0px';
  canvasdiv.style.top = '0px';
  canvasdiv.style.width = '100%';
  canvasdiv.style.height = '100%';
  mount.appendChild(canvasdiv);

  markAsApplicationRegion(canvasdiv, { label: 'Annotation canvas' });

  const deck = new Deck<OrthographicView>({
    parent: canvasdiv,
    views: new OrthographicView(),
    controller: false
  });

  const resize = () => {
    const { width, height } = adapter.getContainerSize();

    if (containerWidth !== width) {
      containerWidth = width;
      canvasdiv.setAttribute('width', String(containerWidth));
    }

    if (containerHeight !== height) {
      containerHeight = height;
      canvasdiv.setAttribute('height', String(containerHeight));
    }
  }

  // A plain CSS toggle on the canvas - cheap, instant, and needs no changes
  // to the render pipeline: the browser skips painting/compositing a
  // display:none element entirely, so this hides every annotation, draft,
  // and hint in one shot without touching what gets built for them.
  const setVisible = (visible: boolean) => {
    canvasdiv.style.display = visible ? '' : 'none';
  }

  // Dedup key for the last id set pushed to `viewport` - avoids
  // re-notifying `viewportIntersect` listeners when the actually-visible
  // set hasn't changed between two settled queries. Sorted/joined rather
  // than compared by array reference, since order isn't guaranteed stable.
  let lastViewportKey = '';

  let hintState: { hints: ToolHint[], image: Img } | undefined;
  let hintLayersCache: ReturnType<typeof buildHintLayers> = [];

  // One RowStore per deck.gl layer - see row-store.ts and the module doc
  // above for why a stable per-annotation index is what makes a single edit
  // cheap regardless of total annotation count.
  const polygonRows = createRowStore<RenderRow>(r => r.target.annotation);
  const pointRows = createRowStore<RenderRow>(r => r.target.annotation);

  const storeForType = (type: ShapeType) => type === ShapeType.POINT ? pointRows : polygonRows;

  // Selected/hovered ids and their *actual* live state - the only place
  // that ever flows real selected/hovered values into a style callback, so
  // a row rebuilt for any other reason (a plain edit, a filter change)
  // always resolves the correct, current state instead of accidentally
  // baking in whatever happened to be true when it was last touched.
  let currentHighlightStates: Map<string, AnnotationState> = new Map();
  const stateFor = (id: string): AnnotationState => currentHighlightStates.get(id) || {};

  const resolveStyle = (target: SpatialAnnotationTarget, state: AnnotationState): Required<RenderStyle> => ({
    ...DEFAULT_STYLE,
    ...opts.getStyle?.(target, state)
  });

  const rowFor = (target: SpatialAnnotationTarget, state: AnnotationState): RenderRow => ({
    target,
    style: resolveStyle(target, state)
  });

  // `getDirtyPointRanges` passes `consumeDirty` itself through to
  // `buildRowLayers`, NOT its already-called result - deck.gl doesn't
  // reconcile `deck.setProps({ layers })` synchronously, so several
  // `submitLayers()` calls in a row (e.g. a fast hover sweep, or several
  // store writes in one tick) construct several layer instances of which
  // only the last is ever actually diffed; draining `consumeDirty()` here
  // eagerly would silently lose whatever was dirtied by the discarded ones.
  // Only `pointRows` uses this at all - `polygonRows` always gets a full
  // rebuild, so its own dirty tracking (still maintained by RowStore, just
  // unread here) isn't consulted. See `dataDiffPropFor`'s and
  // `buildRowLayers`'s doc in layers.ts for the full explanation of both.
  const submitLayers = () => {
    const layers = buildRowLayers(polygonRows.data(), pointRows.data(), {
      getDirtyPointRanges: pointRows.consumeDirty
    });

    deck.setProps({ layers: [...layers, ...hintLayersCache] });
    deck.redraw();
  }

  /**
   * Resolves one committed annotation's row from scratch (current target,
   * current filter visibility, current highlight state) and writes it into
   * whichever RowStore it belongs to - removing it from the other one first,
   * in case its shape type ever changed (editors never actually do this,
   * but staying correct here is free). This is the one function that
   * handles *every* kind of annotation change uniformly - a target edit, a
   * body/metadata edit (a style callback can read either), a reassignment
   * to a different image - since all of them can affect what a row should
   * look like, and none of them need to touch any other row.
   */
  const upsertAnnotationRow = (annotation: SpatialAnnotation) => {
    const image = adapter.getImage(annotation.target.source);
    const filter = opts.getFilter?.();
    const visible = image !== undefined && (!filter || filter(annotation));

    if (!visible) {
      polygonRows.remove(annotation.id);
      pointRows.remove(annotation.id);
      return;
    }

    const target = adapter.targetToWorld(image!, annotation.target);
    const targetStore = storeForType(target.selector.type);
    const otherStore = targetStore === polygonRows ? pointRows : polygonRows;
    otherStore.remove(annotation.id);
    targetStore.upsert(annotation.id, rowFor(target, stateFor(annotation.id)));
  }

  // "Drafts" (in-progress, not-yet-committed shapes - the local user's own
  // live drawing preview, or a remote collaborator's) live in the same two
  // RowStores as committed annotations, under their draft id - draftStore
  // holds only the handful currently being drawn, so this is always O(number
  // of drafts), never O(total annotation count), same as `onStoreChange`.
  let previousDraftIds = new Set<string>();

  const onDraftsChanged = () => {
    const currentIds = new Set<string>();

    draftStore.all().forEach(({ target }) => {
      const image = adapter.getImage(target.source);
      if (!image) return;

      const worldTarget = adapter.targetToWorld(image, target);
      currentIds.add(worldTarget.annotation);
      storeForType(worldTarget.selector.type).upsert(worldTarget.annotation, { target: worldTarget, style: DRAFT_STYLE });
    });

    previousDraftIds.forEach(id => {
      if (!currentIds.has(id)) {
        polygonRows.remove(id);
        pointRows.remove(id);
      }
    });
    previousDraftIds = currentIds;

    submitLayers();
  }

  /**
   * Full, synchronous resync of every row from scratch - the one expensive
   * (O(total annotation count)) path in this module, reserved for events
   * that can affect *any* row at once: initial load, a filter or style
   * change, or an image being added/removed. Never called from a per-edit
   * or per-frame path - see `upsertAnnotationRow`/`onDraftsChanged` for
   * those.
   */
  const fullRebuild = () => {
    polygonRows.clear();
    pointRows.clear();

    const filter = opts.getFilter?.();

    adapter.images().forEach(({ source, image }) => {
      const index = imageIndexes.get(source);
      if (!index) return;

      index.all().forEach(localTarget => {
        if (filter) {
          const annotation = store.getAnnotation(localTarget.annotation);
          if (!annotation || !filter(annotation)) return;
        }

        const target = adapter.targetToWorld(image, localTarget);
        storeForType(target.selector.type).upsert(target.annotation, rowFor(target, stateFor(target.annotation)));
      });
    });

    // Repopulates drafts into the now-cleared stores and calls submitLayers().
    onDraftsChanged();
  }

  /**
   * Call whenever the set of selected/hovered ids (and their state)
   * changes. `states` carries the *actual* live state per id. Touches only
   * the ids that were highlighted before, are highlighted now, or both -
   * never the full candidate set - so a hover crossing shape boundaries
   * stays cheap no matter how many annotations exist. Synchronous, not
   * coalesced: `hover`/`selection` are nanostores atoms that already no-op
   * a `.set()` of an unchanged value, so this only actually runs on a real
   * boundary crossing, and even a burst of those is cheap for the same
   * reason a single edit is.
   */
  const setHighlighted = (states: Map<string, AnnotationState>) => {
    const touched = new Set<string>([...currentHighlightStates.keys(), ...states.keys()]);
    currentHighlightStates = states;

    touched.forEach(id => {
      const annotation = store.getAnnotation(id);
      if (annotation) upsertAnnotationRow(annotation);
    });

    submitLayers();
  }

  /** The active drawing tool's local hints (if any) - see `tool-hint.ts`. Unlike drafts, purely local: never read from `draftStore`. **/
  const setHints = (hints: ToolHint[], image?: Img) => {
    hintState = (hints.length > 0 && image !== undefined) ? { hints, image } : undefined;
    hintLayersCache = hintState
      ? buildHintLayers(hintState.hints.map(h => adapter.hintToWorld(hintState!.image, h)))
      : [];
    submitLayers();
  }

  /**
   * Cheap camera-only update for pan/zoom - touches no annotation data, no
   * spatial index, at all. Deliberately synchronous, in the same pass as
   * the viewer's own paint for this frame: deferring it through a
   * `requestAnimationFrame` would add a full frame of lag between what the
   * viewer just painted and what this overlay catches up to - visible as
   * the overlay trailing behind the image during a drag or zoom.
   */
  const paintCamera = () => {
    const { bounds, resolution } = adapter.getRenderViewport();

    const center: [number, number] = [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
    // deck.gl zoom Z means "screenPixels = worldUnits * 2^Z" - derived from
    // the same `resolution` (world units per screen pixel) the viewer
    // itself reports.
    const zoom = -Math.log2(resolution);

    deck.setProps({ initialViewState: { target: [center[0], center[1], 0], zoom } });
    deck.redraw();
  }

  /** Recomputes which committed annotations currently intersect the viewport - the one thing that still needs a bounds-based index query, kept off the per-frame path (see `scheduleSettledRefresh`). **/
  const updateViewportIntersect = () => {
    const { bounds } = adapter.getRenderViewport();
    const filter = opts.getFilter?.();

    const ids = adapter.images().flatMap(({ source, image }) => {
      const index = imageIndexes.get(source);
      if (!index) return [];

      const localBounds = adapter.worldBoundsToLocal(image, bounds);
      const targets = filter
        ? index.getIntersecting(localBounds).filter(t => {
            const annotation = store.getAnnotation(t.annotation);
            return annotation && filter(annotation);
          })
        : index.getIntersecting(localBounds);

      return targets.map(t => t.annotation);
    });

    const key = ids.slice().sort().join(',');
    if (key !== lastViewportKey) {
      lastViewportKey = key;
      viewport.set(ids);
    }
  }

  // After the viewport stops changing for VIEWPORT_SETTLE_MS: recompute
  // viewportIntersect. See module doc for why this is debounced rather than
  // run every frame, and why it's the only thing pan/zoom still triggers.
  let settleTimeout: ReturnType<typeof setTimeout> | undefined;
  const scheduleSettledRefresh = () => {
    clearTimeout(settleTimeout);
    settleTimeout = setTimeout(updateViewportIntersect, VIEWPORT_SETTLE_MS);
  }

  /** Call on every pan/zoom frame - the only thing on the per-frame path. **/
  const notifyViewportChanged = () => {
    resize();
    paintCamera();
    scheduleSettledRefresh();
  }

  /** Call when an image is registered/unregistered (a real, if rare, data-shape change). **/
  const notifyImagesChanged = () => {
    fullRebuild();
    updateViewportIntersect();
  }

  // `Store.observe` (unlike nanostores' `.listen()`) has no return-value
  // unsubscribe - `unobserve` needs the exact same callback reference back.
  const onStoreChange = ({ changes }: StoreChangeEvent<SpatialAnnotation>) => {
    (changes.created || []).forEach(upsertAnnotationRow);
    (changes.updated || []).forEach(u => upsertAnnotationRow(u.newValue));
    (changes.deleted || []).forEach(a => {
      polygonRows.remove(a.id);
      pointRows.remove(a.id);
    });

    submitLayers();

    // Debounced, not synchronous - see `scheduleSettledRefresh`'s doc.
    // `updateViewportIntersect` sorts and joins every currently-visible id
    // into a dedup key, an O(visible count log visible count) cost that's
    // negligible once per settled burst but was measured (not assumed) to
    // cost 100ms+ on its own at 100k+ mostly-visible annotations - calling
    // it synchronously here would reintroduce exactly the kind of
    // per-keystroke-of-a-drag cost the rest of this module works to avoid,
    // for a value (`viewportIntersect`) that's explicitly documented
    // elsewhere as informational and fine to lag by up to
    // `VIEWPORT_SETTLE_MS`.
    scheduleSettledRefresh();
  }
  store.observe(onStoreChange);

  const unsubscribeDrafts = draftStore.subscribe(onDraftsChanged);

  const onWindowResize = () => { resize(); paintCamera(); }
  window.addEventListener('resize', onWindowResize);

  /**
   * Full, synchronous resync of everything - rows and viewportIntersect.
   * Called once at construction, and available for callers whose change
   * isn't covered by the triggers above (e.g. a viewer-specific "image
   * finished loading" event).
   */
  const refresh = () => {
    resize();
    fullRebuild();
    updateViewportIntersect();
  }

  const destroy = () => {
    window.removeEventListener('resize', onWindowResize);
    store.unobserve(onStoreChange);
    unsubscribeDrafts();
    clearTimeout(settleTimeout);
    deck.finalize();
    canvasdiv.remove();
  }

  refresh();

  return {
    canvasdiv,
    deck,
    destroy,
    notifyImagesChanged,
    notifyViewportChanged,
    refresh,
    render: fullRebuild,
    setHighlighted,
    setHints,
    setVisible
  };

}

export type DeckRenderLoop<Img> = ReturnType<typeof createDeckRenderLoop<Img>>;
