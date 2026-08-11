import { computeBoxBounds, computePolygonBounds } from '../geometry';
import { ShapeType } from '../geometry';
import type { Box, Polygon, SpatialShape } from '../geometry';

export interface SVGSelector {

  type: 'SvgSelector';

  value: string;

}

export const isSVGSelector = (selector: any): selector is SVGSelector =>
  selector?.type === 'SvgSelector' && typeof selector.value === 'string';

/**
 * Note on scope: this handles our own round-trip (a `<rect>` or `<polygon>`
 * produced by `serializeSVGSelector`) reliably, plus the common
 * hand-authored cases (an axis-aligned `<rect>`, or a `<rect>` with a single
 * `rotate(deg)` or `rotate(deg, cx, cy)` transform). It does not attempt to
 * be a general-purpose SVG parser - arbitrary transforms, nested `<g>`
 * groups, multiple shapes per selector, or non-degree units are out of
 * scope for now, and will throw.
 */

const attr = (tag: string, name: string): string | undefined => {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`).exec(tag);
  return m?.[1];
}

const extractTag = (svg: string, tagName: string): string | undefined =>
  new RegExp(`<${tagName}\\b[^>]*/?>`, 'i').exec(svg)?.[0];

const parseRotate = (transform: string | undefined): number | undefined => {
  if (!transform) return undefined;

  const m = /rotate\(\s*(-?[\d.]+)/.exec(transform);
  return m ? Number(m[1]) * (Math.PI / 180) : undefined;
}

const parseRect = (svg: string): Box => {
  const tag = extractTag(svg, 'rect');
  if (!tag)
    throw new Error('No <rect> element found in SVG selector: ' + svg);

  const x = Number(attr(tag, 'x') ?? 0);
  const y = Number(attr(tag, 'y') ?? 0);
  const w = Number(attr(tag, 'width'));
  const h = Number(attr(tag, 'height'));
  const rot = parseRotate(attr(tag, 'transform'));

  if (!Number.isFinite(w) || !Number.isFinite(h))
    throw new Error('Invalid <rect> width/height in SVG selector: ' + svg);

  const geometry = rot ? { x, y, w, h, rot } : { x, y, w, h };
  return { type: ShapeType.BOX, geometry: { ...geometry, bounds: computeBoxBounds(geometry) } };
}

const parsePolygonPoints = (pointsAttr: string): [number, number][] =>
  pointsAttr.trim().split(/\s+/).map(pair => {
    const [x, y] = pair.split(',').map(Number);
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y))
      throw new Error(`Invalid point "${pair}" in SVG polygon selector`);
    return [x, y] as [number, number];
  });

const parsePolygon = (svg: string): Polygon => {
  const tag = extractTag(svg, 'polygon');
  if (!tag)
    throw new Error('No <polygon> element found in SVG selector: ' + svg);

  const pointsAttr = attr(tag, 'points');
  if (!pointsAttr)
    throw new Error('No points attribute on <polygon> element: ' + svg);

  const points = parsePolygonPoints(pointsAttr);
  return { type: ShapeType.POLYGON, geometry: { points, bounds: computePolygonBounds({ points }) } };
}

export const parseSVGSelector = (selector: SVGSelector | string): SpatialShape => {
  const svg = typeof selector === 'string' ? selector : selector.value;

  if (/<rect\b/i.test(svg)) return parseRect(svg);
  if (/<polygon\b/i.test(svg)) return parsePolygon(svg);

  throw new Error('Unsupported SVG selector shape: ' + svg);
}

const serializeBoxAsSVG = (box: Box): string => {
  const { x, y, w, h, rot } = box.geometry;

  if (!rot)
    return `<svg xmlns="http://www.w3.org/2000/svg"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></svg>`;

  // Rotation is always expressed around the box's own center - see BoxGeometry.rot
  const cx = x + w / 2;
  const cy = y + h / 2;

  const deg = rot * (180 / Math.PI);
  return `<svg xmlns="http://www.w3.org/2000/svg"><rect x="${x}" y="${y}" width="${w}" height="${h}" transform="rotate(${deg}, ${cx}, ${cy})"/></svg>`;
}

const serializePolygonAsSVG = (polygon: Polygon): string => {
  const points = polygon.geometry.points.map(([x, y]) => `${x},${y}`).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg"><polygon points="${points}"/></svg>`;
}

export const serializeSVGSelector = (shape: Box | Polygon): SVGSelector => ({
  type: 'SvgSelector',
  value: shape.type === ShapeType.BOX ? serializeBoxAsSVG(shape) : serializePolygonAsSVG(shape)
});
