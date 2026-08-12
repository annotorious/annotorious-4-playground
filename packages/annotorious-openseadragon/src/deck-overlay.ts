import type OpenSeadragon from 'openseadragon';
import { createDeckRenderLoop } from '@annotorious/core-spatial';
import type { DeckRenderLoopOptions, DraftStore, ImageIndexes, SpatialAnnotation, SpatialAnnotationTarget, ToolHint, ViewerAdapter } from '@annotorious/core-spatial';
import type { Store, ViewportState } from '@annotorious/core';
import { hintToWorld, targetToWorld, worldBoundsToLocal } from './coordinates';
import { getRenderViewport } from './viewport';
import type { ImageRegistry } from './image-registry';

export type DeckOverlayOptions = DeckRenderLoopOptions;

/**
 * Thin OpenSeadragon-specific adapter over `@annotorious/core-spatial`'s
 * `createDeckRenderLoop` - the actual caching/coalescing/LOD/render logic is
 * shared with the OpenLayers package (and any future viewer backend); this
 * file only supplies the handful of things that differ: where the canvas
 * mounts and how its size is measured, how to read OSD's own viewport, how
 * to transform annotation targets between an image's local pixel space and
 * OSD's shared "world" (viewport) space, and which of OSD's own events
 * count as "the camera moved" vs. "the set of registered images changed".
 */
export const createDeckOverlay = (
  viewer: OpenSeadragon.Viewer,
  store: Store<SpatialAnnotation>,
  imageRegistry: ImageRegistry,
  imageIndexes: ImageIndexes,
  draftStore: DraftStore<SpatialAnnotationTarget>,
  viewport: ViewportState,
  opts: DeckOverlayOptions = {}
) => {
  const adapter: ViewerAdapter<OpenSeadragon.TiledImage> = {
    images: () => imageRegistry.all().map(({ source, tiledImage }) => ({ source, image: tiledImage })),
    getImage: source => imageRegistry.get(source),
    getContainerSize: () => ({ width: viewer.container.clientWidth, height: viewer.container.clientHeight }),
    getRenderViewport: () => getRenderViewport(viewer),
    targetToWorld,
    worldBoundsToLocal,
    hintToWorld
  };

  // Canvas mounts into `viewer.canvas` (not `viewer.container`, which is
  // measured above) - matches OSD's own layering of the tile canvas.
  const renderLoop = createDeckRenderLoop(viewer.canvas, store, imageIndexes, draftStore, viewport, adapter, opts);

  const onUpdateViewport = () => renderLoop.notifyViewportChanged();
  const onOpen = () => renderLoop.refresh();
  const onWorldChange = () => renderLoop.notifyImagesChanged();

  viewer.addHandler('update-viewport', onUpdateViewport);
  viewer.addHandler('open', onOpen);
  viewer.world.addHandler('add-item', onWorldChange);
  viewer.world.addHandler('remove-item', onWorldChange);

  const destroy = () => {
    viewer.removeHandler('update-viewport', onUpdateViewport);
    viewer.removeHandler('open', onOpen);
    viewer.world.removeHandler('add-item', onWorldChange);
    viewer.world.removeHandler('remove-item', onWorldChange);
    renderLoop.destroy();
  }

  return {
    canvasdiv: renderLoop.canvasdiv,
    deck: renderLoop.deck,
    destroy,
    refresh: renderLoop.refresh,
    render: renderLoop.render,
    setHints: (hints: ToolHint[], tiledImage?: OpenSeadragon.TiledImage) => renderLoop.setHints(hints, tiledImage),
    setVisible: renderLoop.setVisible
  };

}
