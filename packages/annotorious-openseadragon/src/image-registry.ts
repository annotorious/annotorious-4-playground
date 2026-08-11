import OpenSeadragon from 'openseadragon';

export interface RegisteredImage {

  /** `undefined` means "the implicit default image" - see below. **/
  source: string | undefined;

  tiledImage: OpenSeadragon.TiledImage;

}

/**
 * Tracks which `source` id (see `SpatialAnnotationTarget.source`) each image
 * in the OSD world corresponds to.
 *
 * The common single-image case needs no explicit registration at all: the
 * first image in `viewer.world` is the implicit default, matching
 * `source: undefined` on a target. Additional images placed in the world
 * (a real multi-image world) need an explicit `source` id, assigned via
 * `register` - see `annotator.addImage`, which is the public entry point
 * for this. We don't try to auto-derive a source id from OpenSeadragon's
 * TileSource object: different tile source types shape that information
 * very differently, and the id is meant to be a stable, meaningful resource
 * identifier (typically the image URL) - the caller already knows it, since
 * they're the one who opened the image in the first place.
 */
export const createImageRegistry = (viewer: OpenSeadragon.Viewer) => {

  const explicit = new Map<string, OpenSeadragon.TiledImage>();

  const register = (tiledImage: OpenSeadragon.TiledImage, source: string) =>
    explicit.set(source, tiledImage);

  const unregister = (tiledImage: OpenSeadragon.TiledImage) => {
    for (const [source, registered] of explicit)
      if (registered === tiledImage) explicit.delete(source);
  }

  const onRemoveItem = (event: { item: OpenSeadragon.TiledImage }) => unregister(event.item);
  viewer.world.addHandler('remove-item', onRemoveItem);

  const get = (source: string | undefined): OpenSeadragon.TiledImage | undefined =>
    source === undefined ? viewer.world.getItemAt(0) : explicit.get(source);

  const getSource = (tiledImage: OpenSeadragon.TiledImage): string | undefined => {
    if (viewer.world.getItemAt(0) === tiledImage) return undefined;
    for (const [source, registered] of explicit)
      if (registered === tiledImage) return source;
    return undefined;
  }

  const all = (): RegisteredImage[] => {
    const count = viewer.world.getItemCount();
    return Array.from({ length: count }, (_, i) => viewer.world.getItemAt(i))
      .map(tiledImage => ({ source: getSource(tiledImage), tiledImage }));
  }

  /** The topmost image (by stacking order) whose bounds contain the given world point, if any. **/
  const getImageAt = (worldPoint: OpenSeadragon.Point): RegisteredImage | undefined => {
    for (let i = viewer.world.getItemCount() - 1; i >= 0; i--) {
      const tiledImage = viewer.world.getItemAt(i);
      const bounds = tiledImage.getBounds(true);
      if (bounds.containsPoint(worldPoint))
        return { source: getSource(tiledImage), tiledImage };
    }
    return undefined;
  }

  const destroy = () => viewer.world.removeHandler('remove-item', onRemoveItem);

  return { all, destroy, get, getImageAt, getSource, register };

}

export type ImageRegistry = ReturnType<typeof createImageRegistry>;
