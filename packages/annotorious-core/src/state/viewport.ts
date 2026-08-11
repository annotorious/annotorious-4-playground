import { atom } from 'nanostores';

/**
 * Generic "which annotations are currently in view" slot.
 *
 * Core only holds the state - computing what's actually visible requires
 * media-specific geometry (spatial bounds, text offsets, a video time range, ...)
 * so that logic lives in the media-specific package, which pushes ids in via `set`.
 */
export type ViewportState = ReturnType<typeof createViewportState>;

export const createViewportState = () => {

  const inViewport = atom<string[]>([]);

  return {
    get current() { return inViewport.get(); },
    subscribe: inViewport.subscribe.bind(inViewport),
    set: inViewport.set.bind(inViewport)
  };

}
