export interface RegisteredImage {

  /** `undefined` means "the implicit default image" - matches OpenSeadragon's `RegisteredImage.source` convention. **/
  source: string | undefined;

  width: number;

  height: number;

}

/**
 * Single-image MVP: exactly one image, registered once at construction.
 * Keeps the same function names as the OpenSeadragon package's own
 * `ImageRegistry` (`get`, `getImageAt`, `all`, `destroy`) so `pointer.ts`/
 * `deck-overlay.ts`/`editor-overlay.ts` can stay near-verbatim ports of
 * their OSD counterparts. A future multi-image version would register
 * several images with real world-space placement and give `coordinates.ts`
 * something non-trivial to compute from a `RegisteredImage` - no call site
 * here would need to change.
 */
export const createImageRegistry = (image: { width: number, height: number }) => {

  const registered: RegisteredImage = { source: undefined, width: image.width, height: image.height };

  const get = (source: string | undefined): RegisteredImage | undefined =>
    source === undefined ? registered : undefined;

  /** World-space point -> the registered image, if the point falls within its `[0,0]`-`[width,height]` bounds. **/
  const getImageAt = ([x, y]: [number, number]): RegisteredImage | undefined =>
    (x >= 0 && x <= registered.width && y >= 0 && y <= registered.height) ? registered : undefined;

  const all = (): RegisteredImage[] => [registered];

  const destroy = () => {};

  return { all, destroy, get, getImageAt };

}

export type ImageRegistry = ReturnType<typeof createImageRegistry>;
