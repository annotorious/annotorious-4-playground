import type Map from 'ol/Map.js';
import { Deck, OrthographicView } from '@deck.gl/core';
import { buildAnnotationLayers, buildHintLayers, isDraftAnnotationId, markAsApplicationRegion } from '@annotorious/core-spatial';
import type { DraftStore, ImageIndexes, LODOptions, RenderStyle, SpatialAnnotation, SpatialAnnotationTarget, ToolHint } from '@annotorious/core-spatial';
import type { Filter, Store } from '@annotorious/core';
import { hintToWorld, targetToWorld, worldBoundsToLocal } from './coordinates';
import { getRenderViewport } from './viewport';
import type { ImageRegistry, RegisteredImage } from './image-registry';

export interface DeckOverlayOptions {

  getStyle?: (target: SpatialAnnotationTarget) => RenderStyle | undefined;

  /** Read fresh on every render - lets `setFilter` take effect without recreating the overlay. **/
  getFilter?: () => Filter<SpatialAnnotation> | undefined;

  lod?: LODOptions;

}

const DRAFT_STYLE: RenderStyle = { fillColor: [26, 115, 232, 60], lineColor: [26, 115, 232, 255], lineWidth: 2 };

/**
 * Owns the DeckGL canvas and render loop - same structure and reasoning as
 * the OpenSeadragon package's `deck-overlay.ts`, ported to OpenLayers'
 * event/API surface. See that file's history for why `update-viewport`/
 * `postrender` and store changes render *synchronously* rather than through
 * `scheduleRender`'s requestAnimationFrame coalescing: both are already
 * frame-gated by the host viewer's own render loop, so deferring through
 * another RAF would only add a full extra frame of visible lag.
 */
export const createDeckOverlay = (
  map: Map,
  store: Store<SpatialAnnotation>,
  imageRegistry: ImageRegistry,
  imageIndexes: ImageIndexes,
  draftStore: DraftStore<SpatialAnnotationTarget>,
  opts: DeckOverlayOptions = {}
) => {
  const viewport = map.getViewport();

  let containerWidth = 0;
  let containerHeight = 0;

  const canvasdiv = document.createElement('div');
  canvasdiv.style.position = 'absolute';
  canvasdiv.style.left = '0px';
  canvasdiv.style.top = '0px';
  canvasdiv.style.width = '100%';
  canvasdiv.style.height = '100%';
  viewport.appendChild(canvasdiv);

  markAsApplicationRegion(canvasdiv, { label: 'Annotation canvas' });

  const deck = new Deck<OrthographicView>({
    parent: canvasdiv,
    views: new OrthographicView(),
    controller: false
  });

  const resize = () => {
    if (containerWidth !== viewport.clientWidth) {
      containerWidth = viewport.clientWidth;
      canvasdiv.setAttribute('width', String(containerWidth));
    }

    if (containerHeight !== viewport.clientHeight) {
      containerHeight = viewport.clientHeight;
      canvasdiv.setAttribute('height', String(containerHeight));
    }
  }

  let hintState: { hints: ToolHint[], image: RegisteredImage } | undefined;

  /** The active drawing tool's local hints (if any) - see `tool-hint.ts`. Unlike drafts, purely local: never read from `draftStore`. **/
  const setHints = (hints: ToolHint[], image?: RegisteredImage) => {
    hintState = (hints.length > 0 && image) ? { hints, image } : undefined;
    scheduleRender();
  }

  /** Every visible annotation, across every registered image, with geometry already in world space. **/
  const gatherCandidates = (worldBounds: ReturnType<typeof getRenderViewport>['bounds']): SpatialAnnotationTarget[] => {
    const filter = opts.getFilter?.();

    const committed = imageRegistry.all().flatMap(image => {
      const index = imageIndexes.get(image.source);
      if (!index) return [];

      const localBounds = worldBoundsToLocal(image, worldBounds);
      const targets = filter
        ? index.getIntersecting(localBounds).filter(t => {
            const annotation = store.getAnnotation(t.annotation);
            return annotation && filter(annotation);
          })
        : index.getIntersecting(localBounds);

      return targets.map(target => targetToWorld(image, target));
    });

    // Drafts (this session's own in-progress shape, and - in a
    // collaborative setup - other authors' too, see draft-store.ts) are
    // drawn regardless of whether they currently fall within worldBounds -
    // they're actively being interacted with, so they should never pop
    // in/out because a corner briefly left the viewport during a drag.
    const drafts = draftStore.all().flatMap(({ target }) => {
      const image = imageRegistry.get(target.source);
      return image ? [targetToWorld(image, target)] : [];
    });

    return [...committed, ...drafts];
  }

  const style = (target: SpatialAnnotationTarget): RenderStyle | undefined =>
    isDraftAnnotationId(target.annotation) ? DRAFT_STYLE : opts.getStyle?.(target);

  const render = () => {
    const rv = getRenderViewport(map);
    const candidates = gatherCandidates(rv.bounds);
    const layers = buildAnnotationLayers(candidates, rv, { ...opts, getStyle: style });

    const hintLayers = hintState
      ? buildHintLayers(hintState.hints.map(h => hintToWorld(hintState!.image, h)))
      : [];

    // Center of the currently-visible world-space bounds - avoids needing a
    // separate world-space "get view center" helper in viewport.ts.
    const center: [number, number] = [(rv.bounds.minX + rv.bounds.maxX) / 2, (rv.bounds.minY + rv.bounds.maxY) / 2];

    // deck.gl zoom Z means "screenPixels = worldUnits * 2^Z" - derived directly
    // from the same `resolution` (world units per screen pixel) that drives
    // the LOD classification, so the two stay consistent with each other.
    const zoom = -Math.log2(rv.resolution);

    deck.setProps({
      initialViewState: { target: [center[0], center[1], 0], zoom },
      layers: [...layers, ...hintLayers]
    });

    deck.redraw();
  }

  // Coalesce rapid-fire triggers (many store updates in one drag gesture,
  // resize) into at most one render per animation frame.
  let scheduled = false;
  const scheduleRender = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      render();
    });
  }

  // postrender fires synchronously in step with OL's own paint - render
  // here directly, NOT through scheduleRender, for the same anti-lag
  // reason as OSD's update-viewport (see module doc).
  const onPostRender = () => { resize(); render(); }
  const onWindowResize = () => { resize(); scheduleRender(); }

  map.on('postrender', onPostRender);
  window.addEventListener('resize', onWindowResize);

  // Synchronous, same reasoning as onPostRender: a store change during an
  // active editor drag needs to render in the same synchronous pass as the
  // editor's own (also-synchronous) handle repositioning, or the shape
  // visibly lags a frame behind the handles that are supposedly moving it.
  const onStoreChange = () => render();
  store.observe(onStoreChange);

  // Coalesced, not synchronous: unlike a store change during an editor
  // drag, there's no separately-rendered DOM overlay a draft needs to stay
  // in lockstep with (drawing tools render no DOM of their own - see
  // drawing-tool.ts), so the same per-frame coalescing as other
  // not-already-frame-gated triggers is enough here.
  const unsubscribeDrafts = draftStore.subscribe(() => scheduleRender());

  const destroy = () => {
    map.un('postrender', onPostRender);
    window.removeEventListener('resize', onWindowResize);
    store.unobserve(onStoreChange);
    unsubscribeDrafts();
    deck.finalize();
    canvasdiv.remove();
  }

  resize();
  render();

  return { canvasdiv, deck, destroy, render: scheduleRender, setHints };

}
