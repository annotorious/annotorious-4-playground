import { describe, expect, it, vi } from 'vitest';
import { createDraftStore } from '../src/draft-store';
import { createBox } from '../src/geometry';
import type { SpatialAnnotationTarget } from '../src/model';

const target = (selector = createBox(0, 0, 10, 10)): SpatialAnnotationTarget => ({ annotation: 'draft', selector });

describe('draft store', () => {

  it('sets and retrieves a draft by author', () => {
    const drafts = createDraftStore();
    drafts.set('local', target());

    expect(drafts.get('local')).toBeDefined();
    expect(drafts.all()).toHaveLength(1);
  });

  it('clears a draft by setting undefined', () => {
    const drafts = createDraftStore();
    drafts.set('local', target());
    drafts.set('local', undefined);

    expect(drafts.get('local')).toBeUndefined();
    expect(drafts.all()).toHaveLength(0);
  });

  it('keeps multiple authors independent, for concurrent drawers', () => {
    const drafts = createDraftStore();
    drafts.set('local', target(createBox(0, 0, 10, 10)));
    drafts.set('remote-1', target(createBox(100, 100, 10, 10)));

    expect(drafts.all()).toHaveLength(2);
    expect(drafts.get('local')!.selector.geometry).toMatchObject({ x: 0, y: 0 });
    expect(drafts.get('remote-1')!.selector.geometry).toMatchObject({ x: 100, y: 100 });

    drafts.set('local', undefined);
    expect(drafts.all()).toHaveLength(1);
    expect(drafts.get('remote-1')).toBeDefined();
  });

  it('notifies subscribers on every change', () => {
    const drafts = createDraftStore();
    const listener = vi.fn();
    drafts.subscribe(listener);

    drafts.set('local', target());
    drafts.set('local', target(createBox(5, 5, 5, 5)));
    drafts.set('local', undefined);

    // Once on subscribe (nanostores calls immediately) + 3 updates
    expect(listener).toHaveBeenCalledTimes(4);
  });

});
