import type { Annotation, AnnotationBody, RuntimeAnnotationBody } from './annotation';

/**
 * The generic (selector-agnostic) shape of a W3C Web Annotation. Media-specific
 * packages narrow `AbstractW3CSelector` down to their own selector type(s)
 * (e.g. Fragment/SVG selectors for spatial media).
 */
export interface W3CAnnotation {

  '@context': 'http://www.w3.org/ns/anno.jsonld';

  type: 'Annotation';

  id: string;

  creator?: W3CUser;

  created?: string;

  modified?: string;

  body: W3CAnnotationBody | W3CAnnotationBody[];

  target: W3CAnnotationTarget | W3CAnnotationTarget[] | string;

  [key: string]: any;

}

export interface W3CUser {

  type?: string;

  id: string;

  name?: string;

}

export interface W3CAnnotationBody {

  type?: string;

  id?: string;

  format?: string;

  purpose?: string;

  value?: string;

  source?: string;

  creator?: W3CUser;

  created?: string;

  modified?: string;

}

export interface W3CAnnotationTarget {

  id?: string;

  source: string;

  selector?: AbstractW3CSelector;

}

export interface AbstractW3CSelector { }

// https://stackoverflow.com/questions/6122571/simple-non-secure-hash-function-for-javascript
const hashCode = (obj: object): string => {
  const str = JSON.stringify(obj);

  let hash = 0;

  for (let i = 0, len = str.length; i < len; i++) {
    const chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0; // Convert to 32bit integer
  }

  return `${hash}`;
}

export const parseW3CUser = (user?: any): W3CUser | undefined =>
  user ? (typeof user === 'object' ? { ...user } : user) : undefined;

/** Crosswalks W3C annotation body/bodies to core AnnotationBody objects. **/
export const parseW3CBodies = (
  body: W3CAnnotationBody | W3CAnnotationBody[],
  annotationId: string
): AnnotationBody[] => (Array.isArray(body) ? body : [body]).map(b => {
  // Extract properties that conform to the internal model, but keep custom props
  const { id, type, purpose, value, created, modified, creator, ...rest } = b;

  // The internal model strictly requires IDs, W3C bodies may not have one.
  // Generate an ad-hoc id deterministically, so re-parsing the same body is idempotent.
  return {
    id: id || `temp-${hashCode(b)}`,
    annotation: annotationId,
    type,
    purpose,
    value,
    creator: parseW3CUser(creator),
    created: created ? new Date(created) : undefined,
    updated: modified ? new Date(modified) : undefined,
    ...rest
  } as AnnotationBody;
});

/** Serialization helper to remove core-specific fields from the annotation body. **/
export const serializeW3CBodies = (bodies: (AnnotationBody | RuntimeAnnotationBody)[]): W3CAnnotationBody[] =>
  bodies.map(b => {
    const { created, updated, _annotation, ...rest } = b as typeof b & { _annotation?: unknown };

    const w3cBody: W3CAnnotationBody = {
      ...rest,
      created: created?.toISOString(),
      modified: updated?.toISOString()
    } as W3CAnnotationBody;

    if (w3cBody.id?.startsWith('temp-'))
      delete w3cBody.id;

    return w3cBody;
  });

export const isW3CAnnotation = (annotation: Annotation | W3CAnnotation): annotation is W3CAnnotation =>
  '@context' in annotation && 'body' in annotation;
