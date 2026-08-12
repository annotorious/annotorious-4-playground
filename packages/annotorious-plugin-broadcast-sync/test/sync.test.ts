import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStore } from '@annotorious/core';
import { createBox, createDraftStore, LOCAL_AUTHOR_ID } from '@annotorious/core-spatial';
import type { SpatialAnnotation, SpatialAnnotator } from '@annotorious/core-spatial';
import { attachAnnotationSync } from '../src/sync';
import type { AnnotationSync } from '../src/sync';
import type { SyncMessage } from '../src/protocol';
import type { SyncTransport } from '../src/transport';

const makeAnnotator = (): SpatialAnnotator => {
  const store = createStore<SpatialAnnotation>();
  const draftStore = createDraftStore();

  // attachAnnotationSync only ever touches .state.store and .draftStore -
  // everything else on the real Annotator interface is unused by it.
  return {
    state: { store, selection: undefined, hover: undefined, viewport: undefined },
    draftStore
  } as unknown as SpatialAnnotator;
}

const makeAnnotation = (id: string): SpatialAnnotation => ({
  id,
  bodies: [],
  target: { annotation: id, selector: createBox(0, 0, 10, 10) }
});

/** A transport double whose incoming-message handler can be driven directly, and whose outgoing messages are captured for inspection. **/
const makeTransport = () => {
  const sent: SyncMessage[] = [];
  let handler: ((message: SyncMessage) => void) | undefined;

  const transport: SyncTransport<SyncMessage> = {
    send: message => sent.push(message),
    onMessage: callback => { handler = callback; return () => { handler = undefined; }; },
    destroy: () => { handler = undefined; }
  };

  const receive = (message: SyncMessage) => handler?.(message);
  const sentOfType = <T extends SyncMessage['type']>(type: T) => sent.filter(m => m.type === type) as Extract<SyncMessage, { type: T }>[];

  return { transport, sent, sentOfType, receive };
}

describe('attachAnnotationSync (single instance, driven transport)', () => {
  let annotator: SpatialAnnotator;
  let transport: ReturnType<typeof makeTransport>;
  let sync: AnnotationSync;

  beforeEach(() => {
    annotator = makeAnnotator();
    transport = makeTransport();
    sync = attachAnnotationSync(annotator, transport.transport, 'peer-a');
  });

  afterEach(() => sync.destroy());

  it('sends hello on attach', () => {
    expect(transport.sentOfType('hello')).toHaveLength(1);
    expect(transport.sentOfType('hello')[0]!.peerId).toBe('peer-a');
  });

  it('sends annotation-upsert when a local annotation is created', () => {
    annotator.state.store.addAnnotation(makeAnnotation('a1'));

    const upserts = transport.sentOfType('annotation-upsert');
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.annotation.id).toBe('a1');
    expect(upserts[0]!.peerId).toBe('peer-a');
  });

  it('sends annotation-upsert when a local annotation is updated', () => {
    annotator.state.store.addAnnotation(makeAnnotation('a1'));
    annotator.state.store.updateAnnotation(makeAnnotation('a1'));

    expect(transport.sentOfType('annotation-upsert')).toHaveLength(2); // create + update
  });

  it('sends annotation-delete when a local annotation is deleted', () => {
    annotator.state.store.addAnnotation(makeAnnotation('a1'));
    annotator.state.store.deleteAnnotation('a1');

    const deletes = transport.sentOfType('annotation-delete');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.id).toBe('a1');
  });

  it('applies a received annotation-upsert to the store, without re-sending it', () => {
    const before = transport.sent.length;

    transport.receive({ type: 'annotation-upsert', peerId: 'peer-b', annotation: makeAnnotation('remote-1') });

    expect(annotator.state.store.getAnnotation('remote-1')).toBeDefined();
    expect(transport.sent.length).toBe(before); // no echo back out
  });

  it('applies a received annotation-delete to the store, without re-sending it', () => {
    annotator.state.store.bulkUpsertAnnotations([makeAnnotation('a1')]); // seed directly, bypassing the LOCAL observer
    const before = transport.sent.length;

    transport.receive({ type: 'annotation-delete', peerId: 'peer-b', id: 'a1' });

    expect(annotator.state.store.getAnnotation('a1')).toBeUndefined();
    expect(transport.sent.length).toBe(before);
  });

  it('broadcasts only this session\'s own draft entry, not other authors\'', () => {
    annotator.draftStore.set(LOCAL_AUTHOR_ID, makeAnnotation('draft-1').target);
    annotator.draftStore.set('some-other-author', makeAnnotation('draft-2').target);

    const drafts = transport.sentOfType('draft');
    expect(drafts.every(d => d.peerId === 'peer-a')).toBe(true);
    // exactly one real (non-undefined-target) broadcast, for the local entry
    expect(drafts.filter(d => d.target !== undefined)).toHaveLength(1);
    expect(drafts.find(d => d.target !== undefined)!.target!.annotation).toBe('draft-1');
  });

  it('does not re-broadcast the same local draft value twice in a row', () => {
    const target = makeAnnotation('draft-1').target;
    annotator.draftStore.set(LOCAL_AUTHOR_ID, target);
    const countAfterFirst = transport.sentOfType('draft').length;

    annotator.draftStore.set(LOCAL_AUTHOR_ID, target); // identical value again
    expect(transport.sentOfType('draft')).toHaveLength(countAfterFirst);
  });

  it('applies a received draft under the sender\'s peerId', () => {
    const target = makeAnnotation('remote-draft').target;
    transport.receive({ type: 'draft', peerId: 'peer-b', target });

    expect(annotator.draftStore.get('peer-b')).toEqual(target);
    expect(annotator.draftStore.get(LOCAL_AUTHOR_ID)).toBeUndefined();
  });

  it('replies to hello with a sync snapshot of the current store', () => {
    annotator.state.store.addAnnotation(makeAnnotation('a1'));
    transport.sent.length = 0; // clear the create broadcast + attach-time hello

    transport.receive({ type: 'hello', peerId: 'peer-b' });

    const syncs = transport.sentOfType('sync');
    expect(syncs).toHaveLength(1);
    expect(syncs[0]!.annotations.map(a => a.id)).toEqual(['a1']);
  });

  it('applies a received sync snapshot via bulk upsert', () => {
    transport.receive({ type: 'sync', peerId: 'peer-b', annotations: [makeAnnotation('a1'), makeAnnotation('a2')] });

    expect(annotator.state.store.getAnnotation('a1')).toBeDefined();
    expect(annotator.state.store.getAnnotation('a2')).toBeDefined();
  });

  it('clears the sender\'s draft on goodbye', () => {
    transport.receive({ type: 'draft', peerId: 'peer-b', target: makeAnnotation('d').target });
    expect(annotator.draftStore.get('peer-b')).toBeDefined();

    transport.receive({ type: 'goodbye', peerId: 'peer-b' });
    expect(annotator.draftStore.get('peer-b')).toBeUndefined();
  });

  it('sends goodbye on destroy', () => {
    sync.destroy();
    expect(transport.sentOfType('goodbye')).toHaveLength(1);
  });

  it('ignores messages carrying its own peerId (self-echo guard)', () => {
    transport.receive({ type: 'annotation-upsert', peerId: 'peer-a', annotation: makeAnnotation('should-be-ignored') });
    expect(annotator.state.store.getAnnotation('should-be-ignored')).toBeUndefined();
  });

  it('stops applying and sending messages after destroy', () => {
    sync.destroy();
    const before = transport.sent.length;

    annotator.state.store.addAnnotation(makeAnnotation('after-destroy'));
    transport.receive({ type: 'annotation-upsert', peerId: 'peer-b', annotation: makeAnnotation('remote-after-destroy') });

    expect(transport.sent.length).toBe(before);
    expect(annotator.state.store.getAnnotation('remote-after-destroy')).toBeUndefined();
  });

});

describe('attachAnnotationSync (two linked instances, end-to-end)', () => {

  const linkedTransports = (): [SyncTransport<SyncMessage>, SyncTransport<SyncMessage>] => {
    const listenersA = new Set<(m: SyncMessage) => void>();
    const listenersB = new Set<(m: SyncMessage) => void>();

    const a: SyncTransport<SyncMessage> = {
      send: m => listenersB.forEach(fn => fn(m)),
      onMessage: cb => { listenersA.add(cb); return () => listenersA.delete(cb); },
      destroy: () => listenersA.clear()
    };

    const b: SyncTransport<SyncMessage> = {
      send: m => listenersA.forEach(fn => fn(m)),
      onMessage: cb => { listenersB.add(cb); return () => listenersB.delete(cb); },
      destroy: () => listenersB.clear()
    };

    return [a, b];
  }

  it('propagates a locally-created annotation from one peer to the other', () => {
    const [transportA, transportB] = linkedTransports();
    const annotatorA = makeAnnotator();
    const annotatorB = makeAnnotator();

    const syncA = attachAnnotationSync(annotatorA, transportA, 'peer-a');
    const syncB = attachAnnotationSync(annotatorB, transportB, 'peer-b');

    annotatorA.state.store.addAnnotation(makeAnnotation('a1'));

    expect(annotatorB.state.store.getAnnotation('a1')).toBeDefined();

    syncA.destroy();
    syncB.destroy();
  });

  it('a late-joining peer catches up on annotations that already existed via hello/sync', () => {
    const [transportA, transportB] = linkedTransports();
    const annotatorA = makeAnnotator();
    annotatorA.state.store.addAnnotation(makeAnnotation('a1'));
    annotatorA.state.store.addAnnotation(makeAnnotation('a2'));

    const syncA = attachAnnotationSync(annotatorA, transportA, 'peer-a');

    // peer B attaches later, once a1/a2 already exist
    const annotatorB = makeAnnotator();
    const syncB = attachAnnotationSync(annotatorB, transportB, 'peer-b');

    expect(annotatorB.state.store.getAnnotation('a1')).toBeDefined();
    expect(annotatorB.state.store.getAnnotation('a2')).toBeDefined();

    syncA.destroy();
    syncB.destroy();
  });

  it('propagates a delete from one peer to the other', () => {
    const [transportA, transportB] = linkedTransports();
    const annotatorA = makeAnnotator();
    const annotatorB = makeAnnotator();

    const syncA = attachAnnotationSync(annotatorA, transportA, 'peer-a');
    const syncB = attachAnnotationSync(annotatorB, transportB, 'peer-b');

    annotatorA.state.store.addAnnotation(makeAnnotation('a1'));
    expect(annotatorB.state.store.getAnnotation('a1')).toBeDefined();

    annotatorA.state.store.deleteAnnotation('a1');
    expect(annotatorB.state.store.getAnnotation('a1')).toBeUndefined();

    syncA.destroy();
    syncB.destroy();
  });

  it('propagates a live draft from one peer to the other, keyed by the sender\'s peerId', () => {
    const [transportA, transportB] = linkedTransports();
    const annotatorA = makeAnnotator();
    const annotatorB = makeAnnotator();

    const syncA = attachAnnotationSync(annotatorA, transportA, 'peer-a');
    const syncB = attachAnnotationSync(annotatorB, transportB, 'peer-b');

    const draft = makeAnnotation('in-progress').target;
    annotatorA.draftStore.set(LOCAL_AUTHOR_ID, draft);

    expect(annotatorB.draftStore.get('peer-a')).toEqual(draft);

    syncA.destroy();
    syncB.destroy();
  });

});
