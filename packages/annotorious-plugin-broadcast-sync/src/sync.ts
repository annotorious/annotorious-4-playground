import { Origin } from '@annotorious/core';
import { LOCAL_AUTHOR_ID } from '@annotorious/core-spatial';
import type { SpatialAnnotation, SpatialAnnotationTarget, SpatialAnnotator } from '@annotorious/core-spatial';
import type { StoreChangeEvent } from '@annotorious/core';
import type { SyncMessage } from './protocol';
import type { SyncTransport } from './transport';

export interface AnnotationSync {

  readonly peerId: string;

  destroy(): void;

}

/**
 * Wires a `SpatialAnnotator` (works against OpenSeadragon, OpenLayers, or
 * any future viewer backend - the annotator interface this depends on is
 * viewer-agnostic) up to any `SyncTransport`, so annotation create/update/
 * delete and in-progress drawing sync to every other peer on the same
 * transport, live.
 *
 * Deliberately transport-agnostic: this is the part meant to be reused
 * as-is - swap `createBroadcastChannelTransport` (transport.ts) for a
 * WebSocket relay, a Yjs provider, or anything else that implements
 * `SyncTransport`, and nothing here needs to change.
 */
export const attachAnnotationSync = (
  annotator: SpatialAnnotator<any>,
  transport: SyncTransport<SyncMessage>,
  peerId: string = crypto.randomUUID()
): AnnotationSync => {
  const { store } = annotator.state;
  const { draftStore } = annotator;

  // Outbound: only ever broadcasts changes this session itself made -
  // `{ origin: Origin.LOCAL }` means the observer never fires for the
  // Origin.REMOTE writes this same plugin applies below when a message
  // arrives, so there's no echo loop back out.
  const onLocalStoreChange = (event: StoreChangeEvent<SpatialAnnotation>) => {
    const { created, updated, deleted } = event.changes;

    created?.forEach(a => transport.send({ type: 'annotation-upsert', peerId, annotation: a }));
    updated?.forEach(({ newValue }) => transport.send({ type: 'annotation-upsert', peerId, annotation: newValue }));
    deleted?.forEach(a => transport.send({ type: 'annotation-delete', peerId, id: a.id }));
  }

  store.observe(onLocalStoreChange, { origin: Origin.LOCAL });

  // Outbound drafts: draftStore.subscribe fires for *any* author's change,
  // including entries this same plugin just wrote from an incoming remote
  // message - so only ever read and broadcast this session's own entry
  // (LOCAL_AUTHOR_ID), never "whatever changed". Deduped against the last
  // broadcast value so a remote-triggered fire doesn't re-send unchanged data.
  let lastBroadcastDraft: SpatialAnnotationTarget | undefined;

  const onDraftsChange = () => {
    const mine = draftStore.get(LOCAL_AUTHOR_ID);
    if (mine === lastBroadcastDraft) return;

    lastBroadcastDraft = mine;
    transport.send({ type: 'draft', peerId, target: mine });
  }

  const unsubscribeDrafts = draftStore.subscribe(onDraftsChange);

  // Inbound: apply remote writes with Origin.REMOTE, so they render/index
  // via the existing origin-unfiltered observers already inside the viewer
  // package (deck-overlay.ts, image-indexes.ts) without any changes there,
  // and without re-triggering onLocalStoreChange above.
  const onMessage = (message: SyncMessage) => {
    if (message.peerId === peerId) return; // self-echo guard - see transport.ts

    switch (message.type) {
      case 'draft':
        draftStore.set(message.peerId, message.target);
        break;
      case 'annotation-upsert':
        store.upsertAnnotation(message.annotation, Origin.REMOTE);
        break;
      case 'annotation-delete':
        store.deleteAnnotation(message.id, Origin.REMOTE);
        break;
      case 'hello':
        // A peer just joined - reply with a full snapshot so they catch up
        // on annotations that already existed before they connected.
        transport.send({ type: 'sync', peerId, annotations: store.all() });
        break;
      case 'sync':
        store.bulkUpsertAnnotations(message.annotations, Origin.REMOTE);
        break;
      case 'goodbye':
        draftStore.set(message.peerId, undefined);
        break;
    }
  }

  const unsubscribeTransport = transport.onMessage(onMessage);

  // Announce arrival - any already-connected peer replies with 'sync'.
  transport.send({ type: 'hello', peerId });

  // `pagehide`, not `beforeunload`: MDN recommends it as the more reliable
  // of the two for last-gasp work as a page goes away. Best-effort only,
  // not guaranteed - browsers make no promise that async work (including
  // cross-context delivery of a BroadcastChannel message) queued from *any*
  // unload-adjacent event actually flushes before the page is torn down,
  // and testing this under an automated/CDP-driven page close (Playwright's
  // `page.close()`) confirmed exactly that gap: neither `beforeunload` nor
  // `pagehide` reliably got the message out, while an explicit `destroy()`
  // call always did. A production system that needs *guaranteed* presence
  // cleanup - not just "usually, when the user closes normally" - should
  // use a heartbeat/timeout pattern (peers periodically re-announce
  // themselves; a peer not heard from in N seconds is treated as gone)
  // rather than depend on this page ever getting to run cleanup code at
  // all - which explicit calls to `destroy()` can't guarantee either, for
  // the same reason (a crashed tab runs no JS, cleanup or otherwise).
  const sendGoodbye = () => transport.send({ type: 'goodbye', peerId });
  window.addEventListener('pagehide', sendGoodbye);

  const destroy = () => {
    sendGoodbye();
    store.unobserve(onLocalStoreChange);
    unsubscribeDrafts();
    unsubscribeTransport();
    window.removeEventListener('pagehide', sendGoodbye);
  }

  return { peerId, destroy };
}
