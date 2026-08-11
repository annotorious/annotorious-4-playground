import { describe, expect, it } from 'vitest';
import { createBox, createPoint, createPolygon } from '../src/geometry';
import {
  parseFragmentSelector, serializeFragmentSelector,
  parsePointSelector, serializePointSelector,
  parseSVGSelector, serializeSVGSelector,
  parseW3CSpatialAnnotation, serializeW3CSpatialAnnotation
} from '../src/w3c';
import type { SpatialAnnotation } from '../src/model';

describe('fragment selector', () => {

  it('round-trips an axis-aligned box', () => {
    const box = createBox(10, 20, 100, 50);
    const selector = serializeFragmentSelector(box);
    expect(selector.value).toBe('xywh=pixel:10,20,100,50');

    const parsed = parseFragmentSelector(selector);
    expect(parsed.geometry.x).toBe(10);
    expect(parsed.geometry.y).toBe(20);
    expect(parsed.geometry.w).toBe(100);
    expect(parsed.geometry.h).toBe(50);
  });

  it('parses a plain string fragment', () => {
    const parsed = parseFragmentSelector('xywh=pixel:1,2,3,4');
    expect(parsed.geometry).toMatchObject({ x: 1, y: 2, w: 3, h: 4 });
  });

  it('refuses to serialize a rotated box', () => {
    const box = createBox(0, 0, 10, 10, 0.5);
    expect(() => serializeFragmentSelector(box)).toThrow();
  });

});

describe('point selector', () => {

  it('round-trips a point', () => {
    const point = createPoint(42, 99);
    const selector = serializePointSelector(point);
    expect(selector).toEqual({ type: 'PointSelector', x: 42, y: 99 });

    const parsed = parsePointSelector(selector);
    expect(parsed.geometry).toMatchObject({ x: 42, y: 99 });
  });

});

describe('SVG selector', () => {

  it('round-trips an axis-aligned box as <rect>', () => {
    const box = createBox(5, 5, 50, 25);
    const selector = serializeSVGSelector(box);
    expect(selector.value).toContain('<rect');

    const parsed = parseSVGSelector(selector);
    expect(parsed.geometry).toMatchObject({ x: 5, y: 5, w: 50, h: 25 });
  });

  it('round-trips a rotated box, including its rotation', () => {
    const box = createBox(0, 0, 100, 50, Math.PI / 6); // 30 degrees
    const selector = serializeSVGSelector(box);

    const parsed = parseSVGSelector(selector);
    if (parsed.type !== 'BOX') throw new Error('expected a box');
    expect(parsed.geometry.rot).toBeCloseTo(Math.PI / 6, 6);
    expect(parsed.geometry.x).toBe(0);
    expect(parsed.geometry.y).toBe(0);
  });

  it('round-trips a polygon', () => {
    const polygon = createPolygon([[0, 0], [100, 0], [50, 100]]);
    const selector = serializeSVGSelector(polygon);
    expect(selector.value).toContain('<polygon');

    const parsed = parseSVGSelector(selector);
    expect(parsed.geometry).toMatchObject({ points: [[0, 0], [100, 0], [50, 100]] });
  });

  it('parses a hand-authored, unordered-attribute <rect>', () => {
    const svg = `<svg><rect height="20" width="10" y="2" x="1"/></svg>`;
    const parsed = parseSVGSelector(svg);
    expect(parsed.geometry).toMatchObject({ x: 1, y: 2, w: 10, h: 20 });
  });

});

describe('W3C spatial format adapter', () => {

  const source = 'https://example.org/image.jpg';

  const annotation: SpatialAnnotation = {
    id: 'anno-1',
    bodies: [{ id: 'body-1', annotation: 'anno-1', purpose: 'commenting', value: 'hello' }],
    target: { annotation: 'anno-1', selector: createBox(10, 10, 100, 100) }
  };

  it('round-trips an annotation through serialize -> parse', () => {
    const serialized = serializeW3CSpatialAnnotation(annotation, source);
    expect(serialized.target).toMatchObject({ source, selector: { type: 'FragmentSelector' } });

    const { parsed, error } = parseW3CSpatialAnnotation(serialized);
    expect(error).toBeUndefined();
    expect(parsed!.id).toBe('anno-1');
    expect(parsed!.target.selector.geometry).toMatchObject({ x: 10, y: 10, w: 100, h: 100 });
    expect(parsed!.bodies).toHaveLength(1);
  });

  it('prefers a per-annotation target.source over the adapter default', () => {
    const multiImage: SpatialAnnotation = {
      ...annotation,
      target: { ...annotation.target, source: 'https://example.org/other.jpg' }
    };

    const serialized = serializeW3CSpatialAnnotation(multiImage, source);
    expect((serialized.target as any).source).toBe('https://example.org/other.jpg');
  });

  it('fails to serialize without any source', () => {
    expect(() => serializeW3CSpatialAnnotation(annotation)).toThrow();
  });

  it('rejects a target with no supported selector, in strict mode', () => {
    const { error, parsed } = parseW3CSpatialAnnotation({
      '@context': 'http://www.w3.org/ns/anno.jsonld',
      type: 'Annotation',
      id: 'anno-2',
      body: [],
      target: { source, selector: { type: 'SomeWeirdSelector' } }
    } as any);

    expect(parsed).toBeUndefined();
    expect(error).toBeDefined();
  });

});
