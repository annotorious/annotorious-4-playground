import { Deck, OrthographicView } from '@deck.gl/core';
import type { AnnotationState, Filter, Store, StoreChangeEvent, ViewportState } from '@annotorious/core';
import type { Bounds } from '../geometry';
import type { DraftStore } from '../draft-store';
import type { ImageIndexes } from '../image-indexes';
import type { SpatialAnnotation, SpatialAnnotationTarget } from '../model';
import { isDraftAnnotationId } from '../draft-store';
import { markAsApplicationRegion } from './display-container';
import { buildAnnotationLayers } from './layers';
import { buildHintLayers } from './hint-layers';
import type { RenderViewport } from './render-viewport';
import type { RenderStyle } from './layers';
import type { ToolHint } from '../tools/tool-hint';

export interface DeckRenderLoopOptions {

  /**
   * `state` is always explicitly `{}` for the base layer (see module doc -
   * base candidates are never selected/hovered *by definition*, that's what
   * the highlight layer is for) and the real, live state for the highlight
   * layer. Never re-derive selected/hovered independently here (e.g. from a
   * closure over live selection/hover state) - a style callback that reads
   * live state itself would bake in whatever happened to be true at the
   * arbitrary moment the base layer was last rebuilt, permanently, until
   * some later, unrelated rebuild happened to overwrite it.
   */
  getStyle?: (target: SpatialAnnotationTarget, state: AnnotationState) => RenderStyle | undefined;

  /** Read fresh on every render - lets `setFilter` take effect without recreating the overlay. **/
  getFilter?: () => Filter<SpatialAnnotation> | undefined;

}

/**
 * The handful of things that differ between viewer backends - everything
 * else in the render loop (caching, coalescing, debouncing, style,
 * hit-testing scope) is identical between them and lives here instead of
 * being duplicated per package.
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

const DRAFT_STYLE: RenderStyle = { fillColor: [26, 115, 232, 60], lineColor: [26, 115, 232, 255], lineWidth: 2 };

// How long to wait, after the viewport stops changing, before recomputing
// viewportIntersect - see module doc below.
const VIEWPORT_SETTLE_MS = 500;

/**
 * Owns the DeckGL canvas and render loop for a spatial annotator. Shared
 * across viewer backends (OpenSeadragon, OpenLayers, ...) via `ViewerAdapter`
 * - each backend supplies only how to read its own viewport and transform
 * coordinates; everything else (caching, coalescing, style, the pan/zoom
 * fast path) is identical regardless of which viewer it's attached to, so
 * it lives here once instead of being copy-pasted per package.
 *
 * The base layer (`rebuildLayers`) is handed *every* committed annotation,
 * unfiltered by viewport - no CPU-side viewport culling, no level-of-detail
 * simplification. deck.gl already culls what's off-screen via the camera
 * transform (that's what the GPU rasterizer does for free); duplicating
 * that decision on the CPU, or second-guessing it with our own LOD
 * simplification, was strictly worse than just handing deck.gl the data and
 * letting it do the one job it's built for. Concretely: pan/zoom
 * (`notifyViewportChanged`) only ever updates the camera (`paintCamera`) -
 * it never touches the base layer at all, exactly like a plain deck.gl
 * integration with no annotation layer on top would behave. `rebuildLayers`
 * is triggered *only* by an actual change to the candidate set: store/draft
 * mutations, images added/removed, filter/style/hint changes.
 *
 * Hover, selection, and active edits are kept off `rebuildLayers` entirely
 * - see `setHighlighted`/`markActivelyEditing`. A style callback that
 * reacts to `{selected, hovered}` state (a common, expected thing to want)
 * would otherwise force a full rebuild every time either changes - and
 * hover in particular fires on every mousemove, so with thousands of
 * annotations on screen the hovered id changes almost continuously as the
 * pointer crosses shape boundaries. The few currently "active" ids (locally
 * selected/hovered, or anywhere mid-edit) render as a small second layer
 * drawn on top of the base one instead, so that traffic never touches the
 * rest.
 *
 * This is also what keeps editing - local *or remote* - responsive.
 * `onStoreChange` recognizes a target update to an already-active id as
 * "just an edit in progress" and refreshes only the active layer
 * synchronously (so the shape tracks the gesture, not just the editor's
 * handles) while coalescing the base layer's catch-up to at most once per
 * animation frame - a stale "ghost" of the shape at its pre-edit position,
 * in the base layer, for at most one frame, rather than a full rebuild on
 * every single mousemove of the drag. Critically, `markActivelyEditing`
 * doesn't care who caused the target update: a shape a *remote*
 * collaborator is dragging (arriving as ordinary `Origin.REMOTE` store
 * writes, indistinguishable in shape from a local edit) gets exactly the
 * same treatment as one the local user is dragging.
 *
 * `viewportIntersect` (the "visible annotations" lifecycle signal) is the
 * one thing that still needs to know what's actually on screen, so it's
 * the one thing still driven by a debounced (`scheduleSettledRefresh`)
 * spatial query after pan/zoom - informational, not render-critical, so it
 * doesn't need per-frame freshness.
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

  /** The active drawing tool's local hints (if any) - see `tool-hint.ts`. Unlike drafts, purely local: never read from `draftStore`. **/
  const setHints = (hints: ToolHint[], image?: Img) => {
    hintState = (hints.length > 0 && image !== undefined) ? { hints, image } : undefined;
    scheduleFrame();
  }

  let draftsCache: SpatialAnnotationTarget[] = [];

  const rebuildDrafts = () => {
    draftsCache = draftStore.all().flatMap(({ target }) => {
      const image = adapter.getImage(target.source);
      return image !== undefined ? [adapter.targetToWorld(image, target)] : [];
    });
  }

  /** Every committed target, across every registered image, transformed to world space - unfiltered by viewport (see module doc). **/
  const getAllCandidates = (): SpatialAnnotationTarget[] => {
    const filter = opts.getFilter?.();

    return adapter.images().flatMap(({ source, image }) => {
      const index = imageIndexes.get(source);
      if (!index) return [];

      const targets = filter
        ? index.all().filter(t => {
            const annotation = store.getAnnotation(t.annotation);
            return annotation && filter(annotation);
          })
        : index.all();

      return targets.map(target => adapter.targetToWorld(image, target));
    });
  }

  // Base candidates are never selected/hovered *by definition* - that's
  // what the highlight layer is for - so this always passes an empty state,
  // regardless of what's actually selected/hovered live right now. See the
  // warning on `DeckRenderLoopOptions.getStyle` for why that matters.
  const baseStyle = (target: SpatialAnnotationTarget): RenderStyle | undefined =>
    isDraftAnnotationId(target.annotation) ? DRAFT_STYLE : opts.getStyle?.(target, {});

  // The submitted layers are kept in three named pieces and always merged
  // before being handed to deck.gl - see `submitLayers`. Splitting them out
  // is what lets an active-id change (see `activeLayers` below) update
  // without touching the other two, instead of rebuilding a single combined
  // array (which would force deck.gl to re-diff and potentially re-upload
  // everything just because the array reference changed).
  let baseLayers: ReturnType<typeof buildAnnotationLayers> = [];
  let hintLayersCache: ReturnType<typeof buildHintLayers> = [];
  let activeLayers: ReturnType<typeof buildAnnotationLayers> = [];

  const submitLayers = () => {
    deck.setProps({ layers: [...baseLayers, ...hintLayersCache, ...activeLayers] });
    deck.redraw();
  }

  /**
   * Rebuilds the *base* deck.gl layers from every committed annotation
   * (plus in-progress drafts), applying the current filter. This is the
   * expensive path - call it (or schedule it via `scheduleFrame`) when the
   * candidate set itself, or the filter, can have changed. Deliberately NOT
   * triggered by hover/selection changes - see `setHighlighted`. Never
   * called from the per-frame viewport handler either - see `paintCamera`
   * for that.
   */
  const rebuildLayers = () => {
    const candidates = [...getAllCandidates(), ...draftsCache];

    baseLayers = buildAnnotationLayers(candidates, { ...opts, getStyle: baseStyle });

    hintLayersCache = hintState
      ? buildHintLayers(hintState.hints.map(h => adapter.hintToWorld(hintState!.image, h)))
      : [];

    submitLayers();
  }

  // "Active" ids are rendered via the small side layer instead of the base
  // one - two independent sources feed this set, and an id can be in both
  // at once (the shape you're locally dragging is both):
  //
  // 1. Locally selected/hovered ids, with their real {selected, hovered}
  //    state - see `setHighlighted`, called from the host's hover/selection
  //    subscriptions.
  // 2. Any id - local OR remote - with a target-only change since it last
  //    settled - see `markActivelyEditing`/`onStoreChange`. This is what
  //    keeps a REMOTE collaborator's drag exactly as cheap as a local one:
  //    without it, a shape nobody local has selected or hovered would fall
  //    straight through `onStoreChange`'s check into a full rebuild on
  //    every one of the remote author's mousemove-driven target updates -
  //    and with several people editing different shapes at once, each of
  //    them would be forcing that on every other viewer, continuously.
  //
  // (1) is replaced wholesale on every `setHighlighted` call. (2) is added
  // per-id by `markActivelyEditing` and removed per-id, independently, once
  // that specific id has gone `ACTIVE_EDIT_SETTLE_MS` without a further
  // target update - see `scheduleEditSettle`.
  let currentHighlightStates: Map<string, AnnotationState> = new Map();
  const activelyEditingIds = new Set<string>();
  const editSettleTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  // Same idea as VIEWPORT_SETTLE_MS, for the same reason (batch a fast
  // stream of updates into one eventual catch-up instead of reacting to
  // every step) - kept as its own constant since it governs a conceptually
  // different debounce, even though the value happens to match.
  const ACTIVE_EDIT_SETTLE_MS = 500;

  const isActive = (id: string): boolean => currentHighlightStates.has(id) || activelyEditingIds.has(id);

  /** Rebuilds just the active-ids layer - cheap, independent of total annotation count (see module doc). **/
  const rebuildActiveLayer = () => {
    const states = new Map<string, AnnotationState>(currentHighlightStates);
    activelyEditingIds.forEach(id => { if (!states.has(id)) states.set(id, {}); });

    const active: SpatialAnnotationTarget[] = [];
    const stateByTarget = new Map<SpatialAnnotationTarget, AnnotationState>();

    states.forEach((state, id) => {
      const annotation = store.getAnnotation(id);
      if (!annotation) return;

      const image = adapter.getImage(annotation.target.source);
      if (image === undefined) return;

      const target = adapter.targetToWorld(image, annotation.target);
      active.push(target);
      stateByTarget.set(target, state);
    });

    const activeStyle = (target: SpatialAnnotationTarget): RenderStyle | undefined =>
      isDraftAnnotationId(target.annotation) ? DRAFT_STYLE : opts.getStyle?.(target, stateByTarget.get(target) || {});

    activeLayers = active.length > 0
      ? buildAnnotationLayers(active, { ...opts, getStyle: activeStyle, idPrefix: 'active' })
      : [];

    submitLayers();
  }

  /**
   * Call whenever the set of selected/hovered ids (and their state)
   * changes. `states` carries the *actual* live state per id - this is the
   * only place that ever flows real selected/hovered values into a style
   * callback (see the warning on `DeckRenderLoopOptions.getStyle`).
   *
   * Synchronous, not coalesced through `requestAnimationFrame` like
   * `scheduleFrame` - that would add up to a frame of visible lag between
   * the pointer and the highlight following it, and there's nothing here to
   * protect against: `hover`/`selection` are nanostores atoms that already
   * no-op a `.set()` of an unchanged value (see hover.ts/selection.ts), so
   * this only actually runs on a real boundary crossing, not on every raw
   * pointermove - and even a burst of those is cheap, since it only ever
   * touches the 0-few active ids, never the full candidate set (see module
   * doc above).
   */
  const setHighlighted = (states: Map<string, AnnotationState>) => {
    currentHighlightStates = states;
    rebuildActiveLayer();
  }

  /**
   * Marks `id` as actively editing - added to the cheap side layer
   * regardless of local selection/hover - and (re)schedules its solo
   * settle timer. Once `ACTIVE_EDIT_SETTLE_MS` passes with no further call
   * for this specific id, it folds back into the base layer: the base
   * layer's copy of this shape has been stale (at its pre-edit position)
   * for as long as the edit was in progress (see the module doc on why
   * that's an acceptable trade), so folding back means both removing it
   * from the active layer *and* scheduling a base rebuild to pick up its
   * settled, correct position - unless it's still locally highlighted, in
   * which case the active layer is already showing it correctly and
   * neither is needed.
   */
  const scheduleEditSettle = (id: string) => {
    const existing = editSettleTimeouts.get(id);
    if (existing) clearTimeout(existing);

    editSettleTimeouts.set(id, setTimeout(() => {
      editSettleTimeouts.delete(id);
      activelyEditingIds.delete(id);

      if (!currentHighlightStates.has(id)) {
        rebuildActiveLayer();
        scheduleFrame();
      }
    }, ACTIVE_EDIT_SETTLE_MS));
  }

  const markActivelyEditing = (id: string) => {
    activelyEditingIds.add(id);
    scheduleEditSettle(id);
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

  // Coalesces rapid-fire triggers within the same animation frame (many
  // draft updates during one drag gesture, tool hints on every mousemove,
  // images added/removed, filter/style changes, and the base layer's
  // catch-up during an active edit - see onStoreChange) into a single
  // rebuild of the *base* layers. `draftsDirty` tracks whether the draft
  // cache needs refreshing first - `rebuildLayers` always runs on a
  // scheduled frame, since a filter/style/hint change (or an edit's
  // catch-up) needs it even when drafts haven't changed. Selection/hover
  // changes deliberately do NOT go through this - see `setHighlighted`.
  let draftsDirty = false;
  let frameScheduled = false;

  const scheduleFrame = () => {
    if (frameScheduled) return;
    frameScheduled = true;
    requestAnimationFrame(() => {
      frameScheduled = false;
      if (draftsDirty) { draftsDirty = false; rebuildDrafts(); }
      rebuildLayers();
    });
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
    scheduleFrame();
    updateViewportIntersect();
  }

  // Synchronous, NOT through scheduleFrame: a store change to an active id
  // needs the *active* layer to render in the same synchronous pass as
  // whatever's driving it (the local editor's own, also-synchronous, handle
  // repositioning; or just the next remote update arriving), or the shape
  // visibly lags behind. The (expensive) base layer's catch-up is coalesced
  // instead, via `scheduleFrame` - see the module doc for why that split is
  // safe, and why it applies equally to a local edit and a remote one:
  // `markActivelyEditing` adds *any* target-updated id to the active set
  // regardless of who changed it, so a shape someone else is dragging gets
  // exactly the same cheap treatment a shape the local user is dragging
  // does - the alternative (falling through to `rebuildLayers` for every
  // step of every remote author's gesture) is precisely the "multiple
  // people editing simultaneously" scenario that would make this unusable.
  //
  // `Store.observe` (unlike nanostores' `.listen()`) has no return-value
  // unsubscribe - `unobserve` needs the exact same callback reference back.
  const onStoreChange = ({ changes }: StoreChangeEvent<SpatialAnnotation>) => {
    const changedIds = [
      ...(changes.created || []).map(a => a.id),
      ...(changes.updated || []).map(u => u.newValue.id),
      ...(changes.deleted || []).map(a => a.id)
    ];

    (changes.updated || []).forEach(u => { if (u.targetUpdated) markActivelyEditing(u.newValue.id); });

    const allActive = changedIds.length > 0 && changedIds.every(isActive);

    if (allActive) {
      rebuildActiveLayer();
      scheduleFrame();
    } else {
      rebuildLayers();
    }

    updateViewportIntersect();
  }
  store.observe(onStoreChange);

  // Coalesced, not synchronous: unlike a store change during an editor
  // drag, there's no separately-rendered DOM overlay a draft needs to stay
  // in lockstep with (drawing tools render no DOM of their own), so the
  // same per-frame coalescing as other not-already-frame-gated triggers is
  // enough here.
  const unsubscribeDrafts = draftStore.subscribe(() => { draftsDirty = true; scheduleFrame(); });

  const onWindowResize = () => { resize(); paintCamera(); }
  window.addEventListener('resize', onWindowResize);

  // Full, synchronous resync of everything - draft cache, layers, and
  // viewportIntersect. Called once at construction, and available for
  // callers whose change isn't covered by the triggers above (e.g. a
  // viewer-specific "image finished loading" event).
  const refresh = () => {
    resize();
    rebuildDrafts();
    rebuildLayers();
    updateViewportIntersect();
  }

  const destroy = () => {
    window.removeEventListener('resize', onWindowResize);
    store.unobserve(onStoreChange);
    unsubscribeDrafts();
    clearTimeout(settleTimeout);
    editSettleTimeouts.forEach(t => clearTimeout(t));
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
    render: scheduleFrame,
    setHighlighted,
    setHints,
    setVisible
  };

}

export type DeckRenderLoop<Img> = ReturnType<typeof createDeckRenderLoop<Img>>;
