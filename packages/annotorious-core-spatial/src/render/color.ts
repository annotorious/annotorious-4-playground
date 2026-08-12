import type { DrawingStyle } from '@annotorious/core';
import type { RenderStyle } from './layers';

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB_RE = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;

/** Parses a core `Color` (hex, rgb(), or rgba()) into a deck.gl-style [r, g, b, a] (0-255) array. **/
export const parseColor = (color: string, defaultOpacity = 1): [number, number, number, number] => {
  const hexMatch = HEX_RE.exec(color);
  if (hexMatch) {
    const hex = hexMatch[1]!;
    const [r, g, b] = hex.length === 3
      ? hex.split('').map(c => parseInt(c + c, 16))
      : [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
    return [r!, g!, b!, Math.round(defaultOpacity * 255)];
  }

  const rgbMatch = RGB_RE.exec(color);
  if (rgbMatch) {
    const [, r, g, b, a] = rgbMatch;
    const alpha = a !== undefined ? Number(a) : defaultOpacity;
    return [Number(r), Number(g), Number(b), Math.round(alpha * 255)];
  }

  throw new Error(`Unsupported color format: ${color}`);
}

/**
 * Bridges core's CSS-flavored `DrawingStyle` (hex/rgb color strings) to the
 * numeric `RenderStyle` deck.gl layers want. Omits keys the input didn't
 * set, rather than explicitly setting them to `undefined` - `RenderStyle`
 * consumers fall back to their own sensible defaults for anything absent,
 * and an explicit `undefined` would incorrectly override that fallback.
 */
export const toRenderStyle = (style: DrawingStyle): RenderStyle => ({
  ...(style.fill ? { fillColor: parseColor(style.fill, style.fillOpacity ?? 1) } : {}),
  ...(style.stroke ? { lineColor: parseColor(style.stroke, style.strokeOpacity ?? 1) } : {}),
  ...(style.strokeWidth !== undefined ? { lineWidth: style.strokeWidth } : {})
});
