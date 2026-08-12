/**
 * The seam a real backend plugs into: swap `createBroadcastChannelTransport`
 * for a WebSocket relay, a Yjs provider, or anything else that can move
 * messages between peers, and `attachAnnotationSync` (see sync.ts) needs no
 * changes at all - it only ever talks to this interface.
 */
export interface SyncTransport<M = unknown> {

  send(message: M): void;

  /** Registers a listener for incoming messages. Returns a function that unregisters it. **/
  onMessage(callback: (message: M) => void): () => void;

  destroy(): void;

}

/**
 * Reference transport: the browser's native `BroadcastChannel` - same-origin,
 * cross-tab, zero infrastructure. Its `postMessage` uses the structured
 * clone algorithm, so plain objects (annotations, targets, hints) pass
 * through with no custom serialization. Per spec, a `BroadcastChannel`
 * never delivers a message back to the context that sent it, so within a
 * single tab there's no self-echo to guard against here - `sync.ts` still
 * tags every message with a peerId and ignores its own, defensively, since
 * that guarantee doesn't necessarily hold for every transport this
 * interface might be implemented against.
 */
export const createBroadcastChannelTransport = <M = unknown>(channel: string): SyncTransport<M> => {
  const bc = new BroadcastChannel(channel);
  const listeners = new Set<(message: M) => void>();

  bc.onmessage = (event: MessageEvent<M>) => listeners.forEach(fn => fn(event.data));

  const send = (message: M) => bc.postMessage(message);

  const onMessage = (callback: (message: M) => void) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  const destroy = () => {
    listeners.clear();
    bc.close();
  }

  return { send, onMessage, destroy };
}
