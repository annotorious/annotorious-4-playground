import { describe, expect, it } from 'vitest';
import { parseColor, toRenderStyle } from '../src/render/color';

describe('parseColor', () => {

  it('parses a 6-digit hex color, applying the default opacity', () => {
    expect(parseColor('#1a73e8')).toEqual([26, 115, 232, 255]);
  });

  it('parses a 3-digit hex color by doubling each digit', () => {
    expect(parseColor('#0f0')).toEqual([0, 255, 0, 255]);
  });

  it('applies a given default opacity to a hex color', () => {
    expect(parseColor('#ffffff', 0.5)).toEqual([255, 255, 255, 128]);
  });

  it('parses an rgb() color', () => {
    expect(parseColor('rgb(26, 115, 232)')).toEqual([26, 115, 232, 255]);
  });

  it('parses an rgba() color, preferring its own alpha over the default opacity', () => {
    expect(parseColor('rgba(26, 115, 232, 0.25)', 1)).toEqual([26, 115, 232, 64]);
  });

  it('throws on an unsupported color format', () => {
    expect(() => parseColor('cornflowerblue')).toThrow();
  });

});

describe('toRenderStyle', () => {

  it('maps fill, stroke and strokeWidth to their RenderStyle equivalents', () => {
    const style = toRenderStyle({ fill: '#ffffff', fillOpacity: 0.5, stroke: '#1a73e8', strokeOpacity: 1, strokeWidth: 2 });

    expect(style).toEqual({
      fillColor: [255, 255, 255, 128],
      lineColor: [26, 115, 232, 255],
      lineWidth: 2
    });
  });

  it('omits keys the input DrawingStyle did not set, rather than setting them to undefined', () => {
    const style = toRenderStyle({});

    expect(style).toEqual({});
    expect('fillColor' in style).toBe(false);
    expect('lineColor' in style).toBe(false);
    expect('lineWidth' in style).toBe(false);
  });

});
