import { atom } from 'nanostores';
import { v4 as uuidv4 } from 'uuid';
import type { Annotation } from '../model';
import { diffAnnotations } from '../utils';
import { Origin, shouldNotify } from './store-observer';
import type { ChangeSet, StoreChangeEvent, StoreObserver, StoreObserveOptions, Update } from './store-observer';

// Shorthand
type AnnotationBodyIdentifier = { id: string, annotation: string };

const sanitize = <T extends Annotation>(a: Partial<T>): T => {
  const id = a.id === undefined ? uuidv4() : a.id;

  return {
    ...a,
    id,
    bodies: a.bodies === undefined ? [] : a.bodies.map(b => ({ ...b, annotation: id })),
    target: { ...a.target, annotation: id }
  } as T;
}

const isAnnotation = <T extends Annotation>(arg: unknown): arg is T =>
  Boolean(arg) && typeof arg === 'object' && (arg as { id?: unknown }).id !== undefined;

export type Store<T extends Annotation> = ReturnType<typeof createStore<T>>;

/**
 * The annotation store: the single source of truth for annotation CRUD.
 *
 * Internally, annotations live in one long-lived, mutable Map rather than an
 * immutable structure - at scales of 10,000s-100,000s of annotations, cloning
 * the whole collection on every single edit would be far too expensive. The Map
 * is wrapped in a nanostore atom so it stays subscribable (e.g. for a future
 * `@nanostores/react` binding): after each mutation we notify the atom by
 * re-`set`-ing the *same* Map reference, which is a cheap O(1) "something
 * changed" signal rather than a deep-equality check.
 *
 * For anything more specific than "the collection changed" - e.g. reacting only
 * to updates on a particular annotation, or distinguishing target vs. body
 * changes - use `observe`, which delivers precise created/updated/deleted diffs.
 */
export const createStore = <T extends Annotation>() => {

  const annotationIndex = new Map<string, T>();

  const bodyIndex = new Map<string, string>();

  /** Reactive handle on the annotation collection - `.get()` always returns the same Map instance. **/
  const annotations = atom<Map<string, T>>(annotationIndex);

  const observers: StoreObserver<T>[] = [];

  const observe = (onChange: { (event: StoreChangeEvent<T>): void }, options: StoreObserveOptions = {}) => {
    observers.push({ onChange, options });
  }

  const unobserve = (onChange: { (event: StoreChangeEvent<T>): void }) => {
    const idx = observers.findIndex(observer => observer.onChange === onChange);
    if (idx > -1)
      observers.splice(idx, 1);
  }

  const emit = (origin: Origin, changes: ChangeSet<T>) => {
    // Notify nanostore subscribers via the low-level `notify()` - the Map is
    // mutated in place, so a regular `.set()` would no-op (nanostores gates
    // it on reference equality); `notify()` is nanostores' documented escape
    // hatch for exactly this mutable-collection pattern.
    annotations.notify();

    const event: StoreChangeEvent<T> = {
      origin,
      changes: {
        created: changes.created || [],
        updated: changes.updated || [],
        deleted: changes.deleted || []
      }
    };

    observers.forEach(observer => {
      if (shouldNotify(observer, event))
        observer.onChange(event);
    });
  }

  const insertOneAnnotation = (annotation: T) => {
    annotationIndex.set(annotation.id, annotation);
    annotation.bodies.forEach(b => bodyIndex.set(b.id, annotation.id));
  }

  const addAnnotation = (annotation: Partial<T>, origin = Origin.LOCAL) => {
    if (annotation.id && annotationIndex.get(annotation.id)) {
      throw new Error(`Cannot add annotation ${annotation.id} - exists already`);
    }

    const sanitized = sanitize(annotation);
    insertOneAnnotation(sanitized);
    emit(origin, { created: [sanitized] });
  }

  const updateOneAnnotation = (arg1: string | Partial<T>, arg2?: Partial<T>): Update<T> | undefined => {
    const updated: T = typeof arg1 === 'string' ? sanitize(arg2!) : sanitize(arg1);

    const oldId = typeof arg1 === 'string' ? arg1 : arg1.id;
    const oldValue = oldId && annotationIndex.get(oldId);

    if (!oldValue) {
      console.warn(`Cannot update annotation ${oldId} - does not exist`);
      return undefined;
    }

    if (oldId === updated.id) {
      annotationIndex.set(oldId, updated);
    } else {
      annotationIndex.delete(oldId!);
      annotationIndex.set(updated.id, updated);
    }

    oldValue.bodies.forEach(b => bodyIndex.delete(b.id));
    updated.bodies.forEach(b => bodyIndex.set(b.id, updated.id));

    return diffAnnotations(oldValue, updated);
  }

  const updateAnnotation = (arg1: string | T, arg2: T | Origin = Origin.LOCAL, arg3 = Origin.LOCAL) => {
    const origin = isAnnotation(arg2) ? arg3 : arg2;

    const update = typeof arg1 === 'string'
      ? updateOneAnnotation(arg1, arg2 as T)
      : updateOneAnnotation(arg1);

    if (update)
      emit(origin, { updated: [update] });
  }

  const upsertAnnotation = (annotation: T, origin = Origin.LOCAL) => {
    if (annotationIndex.get(annotation.id)) {
      updateAnnotation(annotation, origin);
    } else {
      addAnnotation(annotation, origin);
    }
  }

  const bulkUpdateAnnotations = (annotations: T[], origin = Origin.LOCAL) => {
    const updated = annotations
      .map(annotation => updateOneAnnotation(annotation))
      .filter((u): u is Update<T> => Boolean(u));

    if (updated.length > 0)
      emit(origin, { updated });
  }

  /**
   * Sanitizes the input and splits it into "new to the store" vs. "already exists in the store".
   * Shared by `bulkUpsertAnnotations` and `syncAnnotations`.
   */
  const partitionAddAndUpdate = (annotations: Partial<T>[]): { toAdd: T[], toUpdate: T[] } => {
    const sanitized = annotations.map(sanitize);

    const toAdd: T[] = [];
    const toUpdate: T[] = [];

    for (const annotation of sanitized) {
      if (annotationIndex.get(annotation.id)) {
        toUpdate.push(annotation);
      } else {
        toAdd.push(annotation);
      }
    }

    return { toAdd, toUpdate };
  }

  /**
   * Merges the given annotations into the store without touching anything else.
   *
   * For each input annotation: if an annotation with the same id already exists,
   * it is updated in place; otherwise it is inserted as new. Annotations already
   * in the store whose ids are absent from the input are left untouched.
   *
   * @see syncAnnotations for the "mirror this exact list" variant that also deletes.
   */
  const bulkUpsertAnnotations = (annotations: Partial<T>[], origin = Origin.LOCAL) => {
    const { toAdd, toUpdate } = partitionAddAndUpdate(annotations);

    const updated = toUpdate.map(a => updateOneAnnotation(a)!).filter(Boolean);
    toAdd.forEach(insertOneAnnotation);

    emit(origin, { created: toAdd, updated });
  }

  const deleteOneAnnotation = (annotationOrId: T | string): T | undefined => {
    const id = typeof annotationOrId === 'string' ? annotationOrId : annotationOrId.id;

    const existing = annotationIndex.get(id);
    if (!existing) {
      console.warn(`Attempt to delete missing annotation: ${id}`);
      return undefined;
    }

    annotationIndex.delete(id);
    existing.bodies.forEach(b => bodyIndex.delete(b.id));
    return existing;
  }

  const deleteAnnotation = (annotationOrId: T | string, origin = Origin.LOCAL) => {
    const deleted = deleteOneAnnotation(annotationOrId);
    if (deleted)
      emit(origin, { deleted: [deleted] });
  }

  const bulkDeleteAnnotations = (annotationsOrIds: (T | string)[], origin = Origin.LOCAL) => {
    const deleted = annotationsOrIds
      .map(arg => deleteOneAnnotation(arg))
      .filter((a): a is T => Boolean(a));

    if (deleted.length > 0)
      emit(origin, { deleted });
  }

  /**
   * Replaces the store's contents with the given annotations, preserving the
   * identity of any annotation that survives the sync (so selection and other
   * id-keyed state don't get invalidated for annotations that are just updated).
   *
   * @see bulkUpsertAnnotations for the "merge in" variant that never deletes.
   */
  const syncAnnotations = (annotations: Partial<T>[], origin = Origin.LOCAL) => {
    const { toAdd, toUpdate } = partitionAddAndUpdate(annotations);

    const incomingIds = new Set([...toAdd, ...toUpdate].map(a => a.id));
    const deleted = [...annotationIndex.keys()]
      .filter(id => !incomingIds.has(id))
      .map(id => deleteOneAnnotation(id)!)
      .filter(Boolean);

    const updated = toUpdate.map(a => updateOneAnnotation(a)!).filter(Boolean);
    toAdd.forEach(insertOneAnnotation);

    emit(origin, { created: toAdd, updated, deleted });
  }

  const addBody = (body: T['bodies'][number], origin = Origin.LOCAL) => {
    const oldValue = annotationIndex.get(body.annotation);
    if (!oldValue) {
      console.warn(`Attempt to add body to missing annotation: ${body.annotation}`);
      return;
    }

    const newValue = { ...oldValue, bodies: [...oldValue.bodies, body] };
    annotationIndex.set(oldValue.id, newValue);
    bodyIndex.set(body.id, newValue.id);

    emit(origin, { updated: [{ oldValue, newValue, bodiesCreated: [body] }] });
  }

  const deleteOneBody = (body: AnnotationBodyIdentifier): Update<T> | undefined => {
    const oldAnnotation = annotationIndex.get(body.annotation);
    if (!oldAnnotation) {
      console.warn(`Attempt to delete body from missing annotation ${body.annotation}`);
      return undefined;
    }

    const oldBody = oldAnnotation.bodies.find(b => b.id === body.id);
    if (!oldBody) {
      console.warn(`Attempt to delete missing body ${body.id} from annotation ${body.annotation}`);
      return undefined;
    }

    bodyIndex.delete(oldBody.id);

    const newAnnotation = { ...oldAnnotation, bodies: oldAnnotation.bodies.filter(b => b.id !== body.id) };
    annotationIndex.set(oldAnnotation.id, newAnnotation);

    return { oldValue: oldAnnotation, newValue: newAnnotation, bodiesDeleted: [oldBody] };
  }

  const deleteBody = (body: AnnotationBodyIdentifier, origin = Origin.LOCAL) => {
    const updated = deleteOneBody(body);
    if (updated)
      emit(origin, { updated: [updated] });
  }

  const bulkDeleteBodies = (bodies: AnnotationBodyIdentifier[], origin = Origin.LOCAL) => {
    const updated = bodies.map(deleteOneBody).filter((u): u is Update<T> => Boolean(u));
    if (updated.length > 0)
      emit(origin, { updated });
  }

  const updateOneBody = (oldBodyId: AnnotationBodyIdentifier, newBody: T['bodies'][number]): Update<T> | undefined => {
    if (oldBodyId.annotation !== newBody.annotation)
      throw new Error('Annotation integrity violation: annotation ID must be the same when updating bodies');

    const oldAnnotation = annotationIndex.get(oldBodyId.annotation);
    if (!oldAnnotation) {
      console.warn(`Attempt to update body on missing annotation ${oldBodyId.annotation}`);
      return undefined;
    }

    const oldBody = oldAnnotation.bodies.find(b => b.id === oldBodyId.id);
    if (!oldBody) {
      console.warn(`Attempt to update missing body ${oldBodyId.id}`);
      return undefined;
    }

    const newAnnotation = {
      ...oldAnnotation,
      bodies: oldAnnotation.bodies.map(b => b.id === oldBody.id ? newBody : b)
    };

    annotationIndex.set(oldAnnotation.id, newAnnotation);

    if (oldBody.id !== newBody.id) {
      bodyIndex.delete(oldBody.id);
      bodyIndex.set(newBody.id, newAnnotation.id);
    }

    return { oldValue: oldAnnotation, newValue: newAnnotation, bodiesUpdated: [{ oldBody, newBody }] };
  }

  const updateBody = (oldBodyId: AnnotationBodyIdentifier, newBody: T['bodies'][number], origin = Origin.LOCAL) => {
    const update = updateOneBody(oldBodyId, newBody);
    if (update)
      emit(origin, { updated: [update] });
  }

  const bulkUpdateBodies = (bodies: Array<T['bodies'][number]>, origin = Origin.LOCAL) => {
    const updated = bodies
      .map(b => updateOneBody({ id: b.id, annotation: b.annotation }, b))
      .filter((u): u is Update<T> => Boolean(u));

    if (updated.length > 0)
      emit(origin, { updated });
  }

  const updateOneTarget = (target: T['target']): Update<T> | undefined => {
    const oldValue = annotationIndex.get(target.annotation);
    if (!oldValue) {
      console.warn(`Attempt to update target on missing annotation: ${target.annotation}`);
      return undefined;
    }

    const newValue = { ...oldValue, target: { ...oldValue.target, ...target } };
    annotationIndex.set(oldValue.id, newValue);

    return { oldValue, newValue, targetUpdated: { oldTarget: oldValue.target, newTarget: target } };
  }

  const updateTarget = (target: T['target'], origin = Origin.LOCAL) => {
    const update = updateOneTarget(target);
    if (update)
      emit(origin, { updated: [update] });
  }

  const bulkUpdateTargets = (targets: Array<T['target']>, origin = Origin.LOCAL) => {
    const updated = targets.map(updateOneTarget).filter((u): u is Update<T> => Boolean(u));
    if (updated.length > 0)
      emit(origin, { updated });
  }

  const all = () => [...annotationIndex.values()];

  const clear = (origin = Origin.LOCAL) => {
    const deleted = [...annotationIndex.values()];

    annotationIndex.clear();
    bodyIndex.clear();

    emit(origin, { deleted });
  }

  const getAnnotation = (id: string): T | undefined => {
    const a = annotationIndex.get(id);
    return a ? { ...a } : undefined;
  }

  const getBody = (id: string): T['bodies'][number] | undefined => {
    const annotationId = bodyIndex.get(id);
    if (!annotationId) {
      console.warn(`Attempt to retrieve missing body: ${id}`);
      return undefined;
    }

    const annotation = getAnnotation(annotationId)!;
    const body = annotation.bodies.find(b => b.id === id);
    if (!body)
      console.error(`Store integrity error: body ${id} in index, but not in annotation`);

    return body;
  }

  const size = () => annotationIndex.size;

  return {
    /** Reactive nanostore atom - subscribe for coarse "the collection changed" notifications. **/
    annotations,
    addAnnotation,
    addBody,
    all,
    bulkDeleteAnnotations,
    bulkDeleteBodies,
    bulkUpdateAnnotations,
    bulkUpdateBodies,
    bulkUpdateTargets,
    bulkUpsertAnnotations,
    clear,
    deleteAnnotation,
    deleteBody,
    getAnnotation,
    getBody,
    observe,
    size,
    syncAnnotations,
    unobserve,
    updateAnnotation,
    updateBody,
    updateTarget,
    upsertAnnotation
  };

}
