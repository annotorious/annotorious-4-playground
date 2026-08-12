import type Map from 'ol/Map.js';
import { createDeckRenderLoop } from '@annotorious/core-spatial';
import type { DeckRenderLoopOptions, DraftStore, ImageIndexes, SpatialAnnotation, SpatialAnnotationTarget, ToolHint, ViewerAdapter } from '@annotorious/core-spatial';
import type { Store, ViewportState } from '@annotorious/core';
import { hintToWorld, targetToWorld, worldBoundsToLocal } from './coordinates';
import { getRenderViewport } from './viewport';
import type { ImageRegistry, RegisteredImage } from './image-registry';

export type DeckOverlayOptions = DeckRenderLoopOptions;

/**
 * Thin OpenLayers-specific adapter over `@annotorious/core-spatial`'s
 * `createDeckRenderLoop` - same structure and reasoning as the
 * OpenSeadragon package's `deck-overlay.ts`; see that file's module doc and
 * `render-loop.ts` for why pan/zoom no longer triggers a spatial requery or
 * layer rebuild. This file only supplies what's OpenLayers-specific: where
 * the canvas mounts, how to read the map's own viewport, and OpenLayers'
 * single "the view changed" event (`postrender`) - there's no OSD-style
 * multi-image add/remove here (single-image MVP, see `image-registry.ts`).
 */
export const createDeckOverlay = (
  map: Map,
  store: Store<SpatialAnnotation>,
  imageRegistry: ImageRegistry,
  imageIndexes: ImageIndexes,
  draftStore: DraftStore<SpatialAnnotationTarget>,
  viewport: ViewportState,
  opts: DeckOverlayOptions = {}
) => {
  const mapViewport = map.getViewport();

  const adapter: ViewerAdapter<RegisteredImage> = {
    images: () => imageRegistry.all().map(image => ({ source: image.source, image })),
    getImage: source => imageRegistry.get(source),
    getContainerSize: () => ({ width: mapViewport.clientWidth, height: mapViewport.clientHeight }),
    getRenderViewport: () => getRenderViewport(map),
    targetToWorld,
    worldBoundsToLocal,
    hintToWorld
  };

  const renderLoop = createDeckRenderLoop(mapViewport, store, imageIndexes, draftStore, viewport, adapter, opts);

  const onPostRender = () => renderLoop.notifyViewportChanged();
  map.on('postrender', onPostRender);

  const destroy = () => {
    map.un('postrender', onPostRender);
    renderLoop.destroy();
  }

  return {
    canvasdiv: renderLoop.canvasdiv,
    deck: renderLoop.deck,
    destroy,
    refresh: renderLoop.refresh,
    render: renderLoop.render,
    setHighlighted: renderLoop.setHighlighted,
    setHints: (hints: ToolHint[], image?: RegisteredImage) => renderLoop.setHints(hints, image),
    setVisible: renderLoop.setVisible
  };

}
