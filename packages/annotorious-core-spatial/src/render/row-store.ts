export interface DirtyRange {

  startRow: number;

  /** Exclusive. **/
  endRow: number;

}

export type RowStore<Row> = ReturnType<typeof createRowStore<Row>>;

/**
 * A persistent, densely-packed, id-addressable array, used for both the
 * point and polygon row sets `render-loop.ts` maintains, feeding deck.gl's
 * `_dataDiff` partial-update mechanism (see `layers.ts`): editing one row
 * out of however many are stored costs deck.gl exactly one row's worth of
 * GPU work, not a full re-upload - verified empirically (not just from the
 * docs, and not just for points - see `layers.ts`'s module doc for the
 * `PolygonLayer` detour this took) to be a large speedup at 100k-300k rows
 * over rebuilding the array from scratch on every change. That guarantee
 * only holds as long as an untouched row's index never moves - the entire
 * point of this module.
 *
 * Two different update strategies, chosen per call:
 *
 * - `upsert` on an *existing* id (by far the hottest path - every keystroke
 *   of a drag, local or remote) replaces that one slot in place, on the
 *   *same* array reference. deck.gl doesn't see a new `data` prop reference
 *   from this alone - see `dataComparator` in layers.ts for how a change is
 *   still reported without paying to rebuild the array.
 * - Anything that changes the array's *contents at existing indices in a
 *   way other than a pure value mutation* - `upsert` on a new id, `remove`
 *   (including its swap-with-last, which moves a *different* row's data
 *   into an existing index) - produces a fresh top-level array reference
 *   instead. This isn't just the simpler, honest thing to do (a real
 *   structural change, no gambling on whether some internal instance-count
 *   or per-slot cache tolerates an in-place mutation on a reference it's
 *   already seen) - it's required for correctness: `layers.ts`'s
 *   `_dataDiff` wrapper uses reference *inequality* against deck.gl's own
 *   last-seen data to detect exactly this class of change and fall back to
 *   a full recompute, because a same-length swap was measured (against the
 *   real `AttributeManager`, not assumed) to silently fail to visually
 *   update when reported merely as a same-index partial range - see that
 *   file's module doc for the full story.
 *
 * `remove` uses swap-with-last rather than a splice, specifically so a
 * deletion never shifts any *other* row's index - a splice would turn one
 * deletion into an O(n) storm of "every row after this one moved" dirty
 * entries, exactly the cost this module exists to avoid.
 */
export const createRowStore = <Row>(idOf: (row: Row) => string) => {

  let rows: Row[] = [];

  const indexById = new Map<string, number>();

  const dirty = new Set<number>();

  const upsert = (id: string, row: Row) => {
    const existing = indexById.get(id);

    if (existing !== undefined) {
      rows[existing] = row;
      dirty.add(existing);
      return;
    }

    const idx = rows.length;
    rows = [...rows, row];
    indexById.set(id, idx);
    dirty.add(idx);
  }

  const remove = (id: string) => {
    const idx = indexById.get(id);
    if (idx === undefined) return;

    indexById.delete(id);

    const lastIdx = rows.length - 1;

    if (idx === lastIdx) {
      rows = rows.slice(0, lastIdx);
      dirty.delete(idx);
      return;
    }

    const moved = rows[lastIdx]!;
    const next = rows.slice(0, lastIdx);
    next[idx] = moved;
    rows = next;

    indexById.set(idOf(moved), idx);
    dirty.add(idx);
    dirty.delete(lastIdx);
  }

  /** Discards everything, including dirty state - only for the rare full-rebuild path (filter/style changes, initial load). **/
  const clear = () => {
    rows = [];
    indexById.clear();
    dirty.clear();
  }

  /**
   * Pulls and clears the dirty index set accumulated since the last call,
   * coalesced into sorted, merged ranges. Purely a same-reference,
   * content-only-mutation signal - `layers.ts`'s `_dataDiff` wrapper only
   * ever consults this when it has *also* confirmed (via reference equality
   * against deck.gl's own last-seen data) that no structural change
   * happened in between, so this function doesn't need to know or care
   * about that case itself.
   */
  const consumeDirty = (): DirtyRange[] => {
    if (dirty.size === 0) return [];

    const sorted = [...dirty].sort((a, b) => a - b);
    dirty.clear();

    const ranges: DirtyRange[] = [];
    let start = sorted[0]!;
    let end = start + 1;

    for (let i = 1; i < sorted.length; i++) {
      const v = sorted[i]!;
      if (v === end) {
        end = v + 1;
      } else {
        ranges.push({ startRow: start, endRow: end });
        start = v;
        end = v + 1;
      }
    }

    ranges.push({ startRow: start, endRow: end });
    return ranges;
  }

  return {
    /** The live backing array - same reference across calls unless the row count changed (see module doc). Never mutate directly. **/
    data: () => rows,
    size: () => rows.length,
    has: (id: string) => indexById.has(id),
    get: (id: string): Row | undefined => {
      const idx = indexById.get(id);
      return idx === undefined ? undefined : rows[idx];
    },
    upsert,
    remove,
    clear,
    consumeDirty
  };

}

/**
 * Wraps a `RowStore.consumeDirty` (or any once-only "pull and clear" getter)
 * so that several independent *consumers* reading it within the same
 * deck.gl reconciliation pass all see the same result, instead of the first
 * one draining it and leaving the rest with nothing.
 *
 * Needed specifically because polygon rows now feed two separate deck.gl
 * layers - a `SolidPolygonLayer` for fill and a `PathLayer` for stroke, see
 * `layers.ts` - both reading from the *same* `RowStore`. Each layer's own
 * `_dataDiff` must still be called lazily (see `dataDiffPropFor`'s doc for
 * why), so this can't just call `consumeDirty()` once up front either - that
 * would reintroduce the exact discard-race the laziness exists to avoid.
 * Instead, the *first* `_dataDiff` invocation in a reconciliation pass (fill
 * or stroke, whichever deck.gl happens to diff first) drains and caches the
 * result; a microtask - guaranteed to run only after deck.gl's own
 * synchronous `layerManager.updateLayers()` has finished diffing every layer
 * in the current pass, and before anything from a *later* pass can run -
 * clears the cache again. Any further calls within the same pass reuse the
 * cached value; a call from a later pass computes fresh.
 */
export const shareDirtyReader = (consumeDirty: () => DirtyRange[]): () => DirtyRange[] => {
  let cached: DirtyRange[] | null = null;

  return () => {
    if (cached === null) {
      const ranges = consumeDirty();
      cached = ranges;
      Promise.resolve().then(() => { cached = null; });
      return ranges;
    }
    return cached;
  };
}
