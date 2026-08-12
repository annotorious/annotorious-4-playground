import { describe, expect, it, vi } from 'vitest';
import { createDraftStore, draftAnnotationId, isDraftAnnotationId, LOCAL_AUTHOR_ID } from '../src/draft-store';
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

describe('draft annotation ids', () => {

  it('builds a distinct id per author', () => {
    expect(draftAnnotationId('local')).not.toBe(draftAnnotationId('remote-1'));
  });

  it('is stable for the same author', () => {
    expect(draftAnnotationId(LOCAL_AUTHOR_ID)).toBe(draftAnnotationId(LOCAL_AUTHOR_ID));
  });

  it('recognizes ids it built as draft ids', () => {
    expect(isDraftAnnotationId(draftAnnotationId(LOCAL_AUTHOR_ID))).toBe(true);
    expect(isDraftAnnotationId(draftAnnotationId('remote-1'))).toBe(true);
  });

  it('does not mistake a real annotation id for a draft id', () => {
    expect(isDraftAnnotationId('a1b2c3d4-real-annotation-id')).toBe(false);
  });

});
