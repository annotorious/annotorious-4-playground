import { describe, expect, it } from 'vitest';
import { createRowStore, shareDirtyReader } from '../src/render/row-store';

interface TestRow {
  id: string;
  value: number;
}

const row = (id: string, value = 0): TestRow => ({ id, value });

describe('row store', () => {

  it('assigns increasing indices to new ids and returns them in insertion order', () => {
    const store = createRowStore<TestRow>(r => r.id);

    store.upsert('a', row('a'));
    store.upsert('b', row('b'));
    store.upsert('c', row('c'));

    expect(store.data().map(r => r.id)).toEqual(['a', 'b', 'c']);
    expect(store.size()).toBe(3);
  });

  it('replaces an existing id in place without changing its index or the array reference', () => {
    const store = createRowStore<TestRow>(r => r.id);

    store.upsert('a', row('a'));
    store.upsert('b', row('b'));
    store.upsert('c', row('c'));
    store.consumeDirty();

    const before = store.data();
    store.upsert('b', row('b', 42));
    const after = store.data();

    expect(after).toBe(before); // same reference - content-only update mutates in place
    expect(after.map(r => r.id)).toEqual(['a', 'b', 'c']); // index unchanged
    expect(store.get('b')?.value).toBe(42);
  });

  it('removing the last row just shrinks the array, touching no other row', () => {
    const store = createRowStore<TestRow>(r => r.id);
    store.upsert('a', row('a'));
    store.upsert('b', row('b'));
    store.upsert('c', row('c'));
    store.consumeDirty();

    store.remove('c');

    expect(store.data().map(r => r.id)).toEqual(['a', 'b']);
    expect(store.has('c')).toBe(false);
  });

  it('removing a middle row swaps the last row into its slot, keeping the array dense', () => {
    const store = createRowStore<TestRow>(r => r.id);
    store.upsert('a', row('a'));
    store.upsert('b', row('b'));
    store.upsert('c', row('c'));
    store.consumeDirty();

    store.remove('a');

    // 'c' (formerly last) now occupies index 0, where 'a' used to be.
    expect(store.data().map(r => r.id)).toEqual(['c', 'b']);
    expect(store.get('c')).toBeDefined();
    expect(store.has('a')).toBe(false);
    expect(store.size()).toBe(2);
  });

  it('removing a middle row (swap-with-last) produces a fresh array reference', () => {
    // Load-bearing for layers.ts's `_dataDiff` wrapper: it distinguishes
    // "same logical row, content mutated" (safe for a partial dirty-range
    // update) from "a different row's data now occupies this index" (which
    // must force a full recompute) purely by array reference identity - see
    // that file's module doc. A swap-with-last changes *which row* sits at
    // the vacated index, even though the array's length is unchanged, so it
    // must never keep the same reference the way a content-only update does.
    const store = createRowStore<TestRow>(r => r.id);
    store.upsert('a', row('a'));
    store.upsert('b', row('b'));
    store.upsert('c', row('c'));
    store.consumeDirty();

    const before = store.data();
    store.remove('a');
    const after = store.data();

    expect(after).not.toBe(before);
  });

  it('removing an unknown id is a no-op', () => {
    const store = createRowStore<TestRow>(r => r.id);
    store.upsert('a', row('a'));
    store.consumeDirty();

    expect(() => store.remove('does-not-exist')).not.toThrow();
    expect(store.size()).toBe(1);
    expect(store.consumeDirty()).toEqual([]);
  });

  it('consumeDirty reports newly-inserted rows as a single coalesced range', () => {
    const store = createRowStore<TestRow>(r => r.id);
    store.upsert('a', row('a'));
    store.upsert('b', row('b'));
    store.upsert('c', row('c'));

    expect(store.consumeDirty()).toEqual([{ startRow: 0, endRow: 3 }]);
  });

  it('consumeDirty clears dirty state, so a second call with no further changes reports nothing', () => {
    const store = createRowStore<TestRow>(r => r.id);
    store.upsert('a', row('a'));

    store.consumeDirty();
    expect(store.consumeDirty()).toEqual([]);
  });

  it('consumeDirty coalesces adjacent indices but keeps disjoint ones separate', () => {
    const store = createRowStore<TestRow>(r => r.id);
    for (const id of ['a', 'b', 'c', 'd', 'e']) store.upsert(id, row(id));
    store.consumeDirty();

    // touch indices 1,2 (adjacent - one range) and 4 (disjoint - another range)
    store.upsert('b', row('b', 1));
    store.upsert('c', row('c', 1));
    store.upsert('e', row('e', 1));

    expect(store.consumeDirty()).toEqual([
      { startRow: 1, endRow: 3 },
      { startRow: 4, endRow: 5 }
    ]);
  });

  it('marks the swapped-in row dirty and drops the vacated tail index on a middle removal', () => {
    const store = createRowStore<TestRow>(r => r.id);
    for (const id of ['a', 'b', 'c']) store.upsert(id, row(id));
    store.consumeDirty();

    store.remove('a'); // 'c' moves from index 2 into index 0

    // index 0 changed content (now holds 'c'); index 2 no longer exists.
    expect(store.consumeDirty()).toEqual([{ startRow: 0, endRow: 1 }]);
  });

  it('reuses a freed slot on the next insert after a removal, rather than growing unboundedly', () => {
    const store = createRowStore<TestRow>(r => r.id);
    for (const id of ['a', 'b', 'c']) store.upsert(id, row(id));
    store.remove('b'); // last-swap not needed here; 'b' happens to be index 1, 'c' (last) swaps in
    store.consumeDirty();

    store.upsert('d', row('d'));

    expect(store.size()).toBe(3);
    expect(store.data().map(r => r.id).sort()).toEqual(['a', 'c', 'd'].sort());
  });

  it('clear() resets rows, ids and dirty state', () => {
    const store = createRowStore<TestRow>(r => r.id);
    store.upsert('a', row('a'));
    store.clear();

    expect(store.size()).toBe(0);
    expect(store.has('a')).toBe(false);
    expect(store.consumeDirty()).toEqual([]);
  });

});

describe('shareDirtyReader', () => {

  it('calls the underlying getter only once for multiple reads within the same synchronous pass', () => {
    const store = createRowStore<TestRow>(r => r.id);
    store.upsert('a', row('a'));

    const shared = shareDirtyReader(store.consumeDirty);

    const first = shared();
    const second = shared(); // a second "consumer" (e.g. a stroke layer's own _dataDiff) reading the same drain

    expect(first).toEqual([{ startRow: 0, endRow: 1 }]);
    expect(second).toBe(first); // exact same cached result, not re-computed (and not drained-to-empty)
  });

  it('computes fresh on the next microtask-separated pass, reflecting anything newly dirtied in between', async () => {
    const store = createRowStore<TestRow>(r => r.id);
    store.upsert('a', row('a'));

    const shared = shareDirtyReader(store.consumeDirty);

    shared(); // first "reconciliation pass" - drains the initial insert
    await Promise.resolve(); // let the cache-clearing microtask run

    store.upsert('a', row('a', 1)); // content-only edit - dirties index 0 again

    expect(shared()).toEqual([{ startRow: 0, endRow: 1 }]); // fresh drain, not a stale empty cache
  });

  it('does not call the underlying getter until it is actually read', () => {
    const store = createRowStore<TestRow>(r => r.id);
    store.upsert('a', row('a'));

    let calls = 0;
    const shared = shareDirtyReader(() => { calls++; return store.consumeDirty(); });

    expect(calls).toBe(0);
    shared();
    expect(calls).toBe(1);
  });

});
