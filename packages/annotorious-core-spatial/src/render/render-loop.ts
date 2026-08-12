import { Deck, OrthographicView } from '@deck.gl/core';
import type { Filter, Store, ViewportState } from '@annotorious/core';
import type { Bounds } from '../geometry';
import type { DraftStore } from '../draft-store';
import type { ImageIndexes } from '../image-indexes';
import type { SpatialAnnotation, SpatialAnnotationTarget } from '../model';
import { isDraftAnnotationId } from '../draft-store';
import { markAsApplicationRegion } from './display-container';
import { buildAnnotationLayers } from './layers';
import { buildHintLayers } from './hint-layers';
import type { LODOptions, RenderViewport } from './lod';
import type { RenderStyle } from './layers';
import type { ToolHint } from '../tools/tool-hint';

export interface DeckRenderLoopOptions {

  getStyle?: (target: SpatialAnnotationTarget) => RenderStyle | undefined;

  /** Read fresh on every render - lets `setFilter` take effect without recreating the overlay. **/
  getFilter?: () => Filter<SpatialAnnotation> | undefined;

  lod?: LODOptions;

}

/**
 * The handful of things that differ between viewer backends - everything
 * else in the render loop (caching, coalescing, debouncing, LOD, style,
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

// How long to wait, after the viewport stops changing, before refreshing LOD
// buckets and the viewportIntersect signal - see module doc below.
const VIEWPORT_SETTLE_MS = 500;

/**
 * Owns the DeckGL canvas and render loop for a spatial annotator. Shared
 * across viewer backends (OpenSeadragon, OpenLayers, ...) via `ViewerAdapter`
 * - each backend supplies only how to read its own viewport and transform
 * coordinates; everything else (caching, coalescing, LOD, style, the
 * pan/zoom fast path) is identical regardless of which viewer it's attached
 * to, so it lives here once instead of being copy-pasted per package.
 *
 * Pan/zoom does NOT re-query the spatial index or rebuild deck.gl layers.
 * That would mean re-running a spatial query, re-transforming every visible
 * target to world space, and reconstructing fresh PolygonLayer/
 * ScatterplotLayer instances (forcing deck.gl to re-upload GPU attribute
 * buffers for the entire visible set) on every single frame of a plain pan -
 * duplicating, badly, work the GPU already does for free by just
 * re-rendering its existing buffers under a new camera transform. A viewport
 * change (`notifyViewportChanged`) only ever updates the camera
 * (`paintCamera`) - exactly what a "raw" deck.gl integration with no
 * annotation layer on top would do.
 *
 * Layers are rebuilt (`rebuildLayers`) only when the candidate set or its
 * styling can actually have changed: store/draft mutations, images added/
 * removed, style/filter/hint changes, and - debounced via
 * `scheduleSettledRefresh` - once the viewport settles after a pan/zoom.
 * That last path exists because LOD buckets (full/simplified/culled) depend
 * on on-screen size, so they do need to catch up after a zoom gesture -
 * just not on every single frame of one; a shape's LOD bucket "snapping" to
 * the new zoom level ~500ms after the gesture ends is imperceptible, doing
 * that snap 60 times a second during the gesture is not. The same debounced
 * pass also recomputes `viewportIntersect` (the "visible annotations"
 * lifecycle signal) - informational, not render-critical, so it doesn't
 * need per-frame freshness either.
 *
 * The spatial index itself keeps exactly the job its own docs already claim
 * for it - `AnnotationIndex.getAt` for click hit-testing - plus the
 * occasional, debounced `updateViewportIntersect` query. It's no longer
 * asked to also serve as a per-frame viewport-culling mechanism deck.gl
 * doesn't need: candidates for rendering are simply *every* committed
 * target across every registered image (`rebuildCommitted`), cached and
 * handed to deck.gl whole - the same "just give the GPU everything"
 * approach a plain deck.gl+viewer benchmark would use, and the reason that
 * stays smooth at 100k+.
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

  // The full candidate set - every committed annotation across every
  // registered image, plus in-progress drafts, already transformed to world
  // space - NOT filtered to whatever's currently visible (see module doc).
  // Kept as two separate caches so a draft update (frequent, during a drag)
  // doesn't need to re-scan the (potentially much larger) committed set,
  // and vice versa.
  let committedCache: SpatialAnnotationTarget[] = [];
  let draftsCache: SpatialAnnotationTarget[] = [];

  const rebuildCommitted = () => {
    committedCache = adapter.images().flatMap(({ source, image }) => {
      const index = imageIndexes.get(source);
      return index ? index.all().map(target => adapter.targetToWorld(image, target)) : [];
    });
  }

  const rebuildDrafts = () => {
    draftsCache = draftStore.all().flatMap(({ target }) => {
      const image = adapter.getImage(target.source);
      return image !== undefined ? [adapter.targetToWorld(image, target)] : [];
    });
  }

  const style = (target: SpatialAnnotationTarget): RenderStyle | undefined =>
    isDraftAnnotationId(target.annotation) ? DRAFT_STYLE : opts.getStyle?.(target);

  /**
   * Rebuilds the deck.gl layers from the cached candidates: applies the
   * current filter, LOD-classifies against the *current* resolution, and
   * constructs fresh layers/GPU buffers. This is the relatively expensive
   * path - call it (or schedule it via `scheduleFrame`) when the candidate
   * set or its styling can have changed. Never called from the per-frame
   * viewport handler - see `paintCamera` for that.
   */
  const rebuildLayers = () => {
    const filter = opts.getFilter?.();

    const committed = filter
      ? committedCache.filter(t => {
          const annotation = store.getAnnotation(t.annotation);
          return annotation && filter(annotation);
        })
      : committedCache;

    const candidates = [...committed, ...draftsCache];

    const renderViewport = adapter.getRenderViewport();
    const layers = buildAnnotationLayers(candidates, renderViewport, { ...opts, getStyle: style });

    const hintLayers = hintState
      ? buildHintLayers(hintState.hints.map(h => adapter.hintToWorld(hintState!.image, h)))
      : [];

    deck.setProps({ layers: [...layers, ...hintLayers] });
    deck.redraw();
  }

  /** Cheap camera-only update for pan/zoom - touches no annotation data, no spatial index, at all. **/
  const paintCamera = () => {
    const { bounds, resolution } = adapter.getRenderViewport();

    const center: [number, number] = [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
    // deck.gl zoom Z means "screenPixels = worldUnits * 2^Z" - derived directly
    // from the same `resolution` (world units per screen pixel) that drives
    // the LOD classification, so the two stay consistent with each other.
    const zoom = -Math.log2(resolution);

    deck.setProps({ initialViewState: { target: [center[0], center[1], 0], zoom } });
    deck.redraw();
  }

  /** Recomputes which committed annotations currently intersect the viewport - the one thing that still needs an index query, kept off the per-frame path (see `scheduleSettledRefresh`). **/
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
  // images added/removed, style/filter/selection/hover changes) into a
  // single rebuild. `committedDirty`/`draftsDirty` track which cache(s) (if
  // any) need refreshing first - `rebuildLayers` always runs, since a
  // filter/style/hint/selection/hover change needs it even when neither
  // cache is stale.
  let committedDirty = false;
  let draftsDirty = false;
  let frameScheduled = false;

  const scheduleFrame = () => {
    if (frameScheduled) return;
    frameScheduled = true;
    requestAnimationFrame(() => {
      frameScheduled = false;
      if (committedDirty) { committedDirty = false; rebuildCommitted(); }
      if (draftsDirty) { draftsDirty = false; rebuildDrafts(); }
      rebuildLayers();
    });
  }

  // After the viewport stops changing for VIEWPORT_SETTLE_MS: refresh LOD
  // buckets (resolution may have changed during a zoom) and recompute
  // viewportIntersect. See module doc for why this is debounced rather than
  // run every frame.
  let settleTimeout: ReturnType<typeof setTimeout> | undefined;
  const scheduleSettledRefresh = () => {
    clearTimeout(settleTimeout);
    settleTimeout = setTimeout(() => {
      rebuildLayers();
      updateViewportIntersect();
    }, VIEWPORT_SETTLE_MS);
  }

  /** Call on every pan/zoom frame - the only thing on the per-frame path. **/
  const notifyViewportChanged = () => {
    resize();
    paintCamera();
    scheduleSettledRefresh();
  }

  /** Call when an image is registered/unregistered (a real, if rare, data-shape change). **/
  const notifyImagesChanged = () => {
    committedDirty = true;
    scheduleFrame();
    updateViewportIntersect();
  }

  // Synchronous, NOT through scheduleFrame: a store change during an active
  // editor drag needs to render in the same synchronous pass as the
  // editor's own (also-synchronous) handle repositioning, or the shape
  // visibly lags a frame behind the handles that are supposedly moving it.
  //
  // `Store.observe` (unlike nanostores' `.listen()`) has no return-value
  // unsubscribe - `unobserve` needs the exact same callback reference back.
  const onStoreChange = () => { rebuildCommitted(); rebuildLayers(); updateViewportIntersect(); }
  store.observe(onStoreChange);

  // Coalesced, not synchronous: unlike a store change during an editor
  // drag, there's no separately-rendered DOM overlay a draft needs to stay
  // in lockstep with (drawing tools render no DOM of their own), so the
  // same per-frame coalescing as other not-already-frame-gated triggers is
  // enough here.
  const unsubscribeDrafts = draftStore.subscribe(() => { draftsDirty = true; scheduleFrame(); });

  const onWindowResize = () => { resize(); paintCamera(); scheduleFrame(); }
  window.addEventListener('resize', onWindowResize);

  // Full, synchronous resync of everything - committed/draft caches,
  // layers, and viewportIntersect. Called once at construction, and
  // available for callers whose change isn't covered by the triggers above
  // (e.g. a viewer-specific "image finished loading" event).
  const refresh = () => {
    resize();
    rebuildCommitted();
    rebuildDrafts();
    rebuildLayers();
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
    render: scheduleFrame,
    setHints,
    setVisible
  };

}

export type DeckRenderLoop<Img> = ReturnType<typeof createDeckRenderLoop<Img>>;
