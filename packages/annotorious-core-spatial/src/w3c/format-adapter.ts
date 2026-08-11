import { parseW3CBodies, parseW3CUser, serializeW3CBodies } from '@annotorious/core';
import type { FormatAdapter, ParseResult, W3CAnnotation, W3CAnnotationTarget } from '@annotorious/core';
import { ShapeType } from '../geometry';
import type { SpatialAnnotation, SpatialAnnotationTarget } from '../model';
import { isFragmentSelector, parseFragmentSelector, serializeFragmentSelector } from './fragment-selector';
import { isPointSelector, parsePointSelector, serializePointSelector } from './point-selector';
import { isSVGSelector, parseSVGSelector, serializeSVGSelector } from './svg-selector';

export type W3CSpatialFormatAdapter = FormatAdapter<SpatialAnnotation, W3CAnnotation>;

export interface W3CSpatialFormatAdapterOpts {

  strict?: boolean;

}

/**
 * @param source Default target resource (e.g. an image URL) for annotations
 * that don't carry their own `target.source` - the common single-image case.
 * A multi-image annotation (`target.source` already set on the annotation
 * itself) always takes precedence over this default.
 */
export const W3CSpatialFormat = (
  source?: string,
  opts: W3CSpatialFormatAdapterOpts = { strict: true }
): W3CSpatialFormatAdapter => ({
  parse: (serialized: W3CAnnotation) => parseW3CSpatialAnnotation(serialized, opts),
  serialize: (annotation: SpatialAnnotation) => serializeW3CSpatialAnnotation(annotation, source, opts)
});

const isSupportedSelector = (selector: any): boolean =>
  isFragmentSelector(selector) || isPointSelector(selector) || isSVGSelector(selector);

const isSupportedTarget = (target: any): boolean => {
  if (typeof target === 'string')
    return isFragmentSelector(target);

  const selector = Array.isArray(target?.selector)
    ? target.selector.find(isSupportedSelector)
    : target?.selector;

  return isSupportedSelector(selector);
}

export const parseW3CSpatialAnnotation = (
  annotation: W3CAnnotation,
  opts: W3CSpatialFormatAdapterOpts = { strict: true }
): ParseResult<SpatialAnnotation> => {
  const annotationId = annotation.id || crypto.randomUUID();

  const { creator, created, modified, body, target: rawTarget, ...rest } = annotation;

  const bodies = parseW3CBodies(body || [], annotationId);

  const w3cTarget = Array.isArray(rawTarget) ? rawTarget.find(isSupportedTarget) : rawTarget;

  if (!w3cTarget)
    return { error: new Error(`Unsupported target(s): ${JSON.stringify(rawTarget)}`) };

  const w3cSelector = typeof w3cTarget === 'string' ? w3cTarget
    : Array.isArray(w3cTarget.selector) ? w3cTarget.selector.find(isSupportedSelector) : w3cTarget.selector;

  let selector;
  try {
    selector = isFragmentSelector(w3cSelector) ? parseFragmentSelector(w3cSelector as any)
      : isPointSelector(w3cSelector) ? parsePointSelector(w3cSelector as any)
      : isSVGSelector(w3cSelector) ? parseSVGSelector(w3cSelector as any)
      : undefined;
  } catch (error) {
    if (opts.strict)
      return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  if (!selector)
    return { error: new Error(`Invalid selector: ${JSON.stringify(w3cSelector)}`) };

  const targetSource = typeof w3cTarget === 'string' ? undefined : (w3cTarget as W3CAnnotationTarget).source;

  const target = {
    annotation: annotationId,
    selector,
    ...(targetSource ? { source: targetSource } : {}),
    ...(creator ? { creator: parseW3CUser(creator) } : {}),
    ...(created ? { created: new Date(created) } : {}),
    ...(modified ? { updated: new Date(modified) } : {})
  } as SpatialAnnotationTarget;

  return { parsed: { ...rest, id: annotationId, bodies, target } as SpatialAnnotation };
}

export const serializeW3CSpatialAnnotation = (
  annotation: SpatialAnnotation,
  defaultSource?: string,
  opts: W3CSpatialFormatAdapterOpts = { strict: true }
): W3CAnnotation => {
  const {
    selector, creator, created, updated, updatedBy: _updatedBy, source: targetSource, annotation: _annotationId, ...restTargetFields
  } = annotation.target;

  const resolvedSource = targetSource || defaultSource;
  if (!resolvedSource)
    throw new Error('Cannot serialize: no target source given (neither on the annotation nor as a default)');

  let w3cSelector;
  try {
    w3cSelector = selector.type === ShapeType.BOX && !selector.geometry.rot ? serializeFragmentSelector(selector)
      : selector.type === ShapeType.POINT ? serializePointSelector(selector)
      : serializeSVGSelector(selector);
  } catch (error) {
    if (opts.strict) throw error;
    w3cSelector = selector;
  }

  const { bodies: _bodies, ...annotationRest } = annotation;

  return {
    ...annotationRest,
    '@context': 'http://www.w3.org/ns/anno.jsonld',
    id: annotation.id,
    type: 'Annotation',
    body: serializeW3CBodies(annotation.bodies),
    created: created?.toISOString(),
    creator,
    modified: updated?.toISOString(),
    target: {
      ...restTargetFields,
      source: resolvedSource,
      selector: w3cSelector
    }
  } as unknown as W3CAnnotation;
}
