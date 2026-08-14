import { atom } from 'nanostores';

/**
 * Generic 'which annotations are currently in view' store. Must be
 * managed by the media-specfic implementation.
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
