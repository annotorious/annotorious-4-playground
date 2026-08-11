import { createBox } from '../geometry';
import type { Box } from '../geometry';

export interface FragmentSelector {

  type: 'FragmentSelector';

  conformsTo: 'http://www.w3.org/TR/media-frags/';

  value: string;

}

const number = '-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?';

const MAX_FRAGMENT_LENGTH = 512; // ReDoS guard

const XYWH_RE = new RegExp(`#?xywh=((?:pixel|percent):)?(${number}),(${number}),(${number}),(${number})$`, 'i');

export const isFragmentSelector = (selector: any): boolean => {
  if (selector?.type === 'FragmentSelector')
    return true;

  if (typeof selector === 'string') {
    if (selector.length > MAX_FRAGMENT_LENGTH) return false;
    return XYWH_RE.test(selector);
  }

  return false;
}

/**
 * Media Fragments only express axis-aligned boxes - a rotated box must be
 * serialized as an SVG selector instead (see `serializeSVGSelector`).
 */
export const parseFragmentSelector = (fragmentOrSelector: FragmentSelector | string): Box => {
  const fragment = typeof fragmentOrSelector === 'string' ? fragmentOrSelector : fragmentOrSelector.value;

  if (fragment.length > MAX_FRAGMENT_LENGTH)
    throw new Error('Fragment too long: ' + fragment);

  const matches = XYWH_RE.exec(fragment);
  if (!matches)
    throw new Error('Not a MediaFragment xywh selector: ' + fragment);

  const [, unit, a, b, c, d] = matches;

  if (unit && unit !== 'pixel:')
    throw new Error(`Unsupported MediaFragment unit: ${unit}`);

  const [x, y, w, h] = [a, b, c, d].map(Number) as [number, number, number, number];

  return createBox(x, y, w, h);
}

export const serializeFragmentSelector = (box: Box): FragmentSelector => {
  const { x, y, w, h, rot } = box.geometry;

  if (rot)
    throw new Error('Cannot serialize a rotated box as a Media Fragment selector - use an SVG selector instead');

  return {
    type: 'FragmentSelector',
    conformsTo: 'http://www.w3.org/TR/media-frags/',
    value: `xywh=pixel:${x},${y},${w},${h}`
  };
}
