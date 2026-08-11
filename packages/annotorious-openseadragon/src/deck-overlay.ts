import type OpenSeadragon from 'openseadragon';
import { Deck, OrthographicView } from '@deck.gl/core';
import { buildAnnotationLayers, markAsApplicationRegion } from '@annotorious/core-spatial';
import type { LODOptions, RenderStyle, SpatialAnnotation, SpatialAnnotationTarget } from '@annotorious/core-spatial';
import type { Filter, Store } from '@annotorious/core';
import { targetToWorld, worldBoundsToLocal } from './coordinates';
import { getRenderViewport } from './viewport';
import type { ImageIndexes } from './image-indexes';
import type { ImageRegistry } from './image-registry';

export interface DeckOverlayOptions {

  getStyle?: (target: SpatialAnnotationTarget) => RenderStyle | undefined;

  /** Read fresh on every render - lets `setFilter` take effect without recreating the overlay. **/
  getFilter?: () => Filter<SpatialAnnotation> | undefined;

  lod?: LODOptions;

}

/** Fixed id for the shape currently being drawn, styled distinctly and never confused with a real annotation. **/
export const DRAFT_ANNOTATION_ID = '__annotorious-draft__';

const DRAFT_STYLE: RenderStyle = { fillColor: [26, 115, 232, 60], lineColor: [26, 115, 232, 255], lineWidth: 2 };

/**
 * Owns the DeckGL canvas and render loop. Adapted from
 * https://github.com/ynitto/openseadragon-deckgl-overlay/ - the key change
 * from the original single-image prototype is tracking OSD's own *viewport*
 * coordinate space (shared across every image in the world) rather than one
 * image's pixel space, so this works the same whether there's one image or
 * many, placed anywhere.
 */
export const createDeckOverlay = (
  viewer: OpenSeadragon.Viewer,
  store: Store<SpatialAnnotation>,
  imageRegistry: ImageRegistry,
  imageIndexes: ImageIndexes,
  opts: DeckOverlayOptions = {}
) => {
  let containerWidth = 0;
  let containerHeight = 0;

  const canvasdiv = document.createElement('div');
  canvasdiv.style.position = 'absolute';
  canvasdiv.style.left = '0px';
  canvasdiv.style.top = '0px';
  canvasdiv.style.width = '100%';
  canvasdiv.style.height = '100%';
  viewer.canvas.appendChild(canvasdiv);

  markAsApplicationRegion(canvasdiv, { label: 'Annotation canvas' });

  const deck = new Deck<OrthographicView>({
    parent: canvasdiv,
    views: new OrthographicView(),
    controller: false
  });

  const resize = () => {
    if (containerWidth !== viewer.container.clientWidth) {
      containerWidth = viewer.container.clientWidth;
      canvasdiv.setAttribute('width', String(containerWidth));
    }

    if (containerHeight !== viewer.container.clientHeight) {
      containerHeight = viewer.container.clientHeight;
      canvasdiv.setAttribute('height', String(containerHeight));
    }
  }

  let draft: { target: SpatialAnnotationTarget, tiledImage: OpenSeadragon.TiledImage } | undefined;

  /** The shape currently being drawn (if any), not yet a real annotation - see `setDraft`. **/
  const setDraft = (target: SpatialAnnotationTarget | undefined, tiledImage?: OpenSeadragon.TiledImage) => {
    draft = (target && tiledImage) ? { target, tiledImage } : undefined;
    scheduleRender();
  }

  /** Every visible annotation, across every registered image, with geometry already in world space. **/
  const gatherCandidates = (worldBounds: ReturnType<typeof getRenderViewport>['bounds']): SpatialAnnotationTarget[] => {
    const filter = opts.getFilter?.();

    const committed = imageRegistry.all().flatMap(({ source, tiledImage }) => {
      const index = imageIndexes.get(source);
      if (!index) return [];

      const localBounds = worldBoundsToLocal(tiledImage, worldBounds);
      const targets = filter
        ? index.getIntersecting(localBounds).filter(t => {
            const annotation = store.getAnnotation(t.annotation);
            return annotation && filter(annotation);
          })
        : index.getIntersecting(localBounds);

      return targets.map(target => targetToWorld(tiledImage, target));
    });

    // The draft is drawn regardless of whether it currently falls within
    // worldBounds - it's actively being interacted with, so it should never
    // pop in/out because a corner briefly left the viewport during a drag.
    const withDraft = draft ? [...committed, targetToWorld(draft.tiledImage, draft.target)] : committed;
    return withDraft;
  }

  const style = (target: SpatialAnnotationTarget): RenderStyle | undefined =>
    target.annotation === DRAFT_ANNOTATION_ID ? DRAFT_STYLE : opts.getStyle?.(target);

  const render = () => {
    const viewport = getRenderViewport(viewer);
    const candidates = gatherCandidates(viewport.bounds);
    const layers = buildAnnotationLayers(candidates, viewport, { ...opts, getStyle: style });

    const center = viewer.viewport.getCenter(true);
    // deck.gl zoom Z means "screenPixels = worldUnits * 2^Z" - derived directly
    // from the same `resolution` (world units per screen pixel) that drives
    // the LOD classification, so the two stay consistent with each other.
    const zoom = -Math.log2(viewport.resolution);

    deck.setProps({
      initialViewState: { target: [center.x, center.y, 0], zoom },
      layers
    });

    deck.redraw();
  }

  // Coalesce rapid-fire triggers (many store updates in one drag gesture,
  // world add/remove, resize) into at most one render per animation frame.
  let scheduled = false;
  const scheduleRender = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      render();
    });
  }

  // update-viewport/open render synchronously, NOT through scheduleRender:
  // OSD's own animation loop already fires update-viewport at most once per
  // frame, so deferring it through another requestAnimationFrame would only
  // add a full extra frame of lag between what OSD just painted and what
  // DeckGL catches up to - exactly the stale-during-pan/zoom symptom this
  // fixes. scheduleRender's coalescing is for triggers that aren't already
  // frame-gated (many store updates within one drag, etc).
  const onUpdateViewport = () => { resize(); render(); }
  const onOpen = () => { resize(); render(); }
  const onWorldChange = () => scheduleRender();
  const onWindowResize = () => { resize(); scheduleRender(); }

  viewer.addHandler('update-viewport', onUpdateViewport);
  viewer.addHandler('open', onOpen);
  viewer.world.addHandler('add-item', onWorldChange);
  viewer.world.addHandler('remove-item', onWorldChange);
  window.addEventListener('resize', onWindowResize);

  // Synchronous, same reasoning as onUpdateViewport: a store change during
  // an active editor drag needs to render in the same synchronous pass as
  // the editor's own (also-synchronous) handle repositioning, or the shape
  // visibly lags a frame behind the handles that are supposedly moving it.
  // A well-behaved bulk update (bulkUpsertAnnotations etc.) is already a
  // single store event regardless, so this doesn't add per-item overhead
  // for the cases that matter.
  //
  // `Store.observe` (unlike nanostores' `.listen()`) has no return-value
  // unsubscribe - `unobserve` needs the exact same callback reference back.
  const onStoreChange = () => render();
  store.observe(onStoreChange);

  const destroy = () => {
    viewer.removeHandler('update-viewport', onUpdateViewport);
    viewer.removeHandler('open', onOpen);
    viewer.world.removeHandler('add-item', onWorldChange);
    viewer.world.removeHandler('remove-item', onWorldChange);
    window.removeEventListener('resize', onWindowResize);
    store.unobserve(onStoreChange);
    deck.finalize();
    canvasdiv.remove();
  }

  resize();
  render();

  return { canvasdiv, deck, destroy, render: scheduleRender, setDraft };

}
