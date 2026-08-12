import type { Layer } from '@deck.gl/core';
import { PathStyleExtension } from '@deck.gl/extensions';
import type { PathStyleExtensionProps } from '@deck.gl/extensions';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { ToolHint } from '../tools/tool-hint';

export interface HintStyle {

  /** RGBA, 0-255. Default: the same blue accent used by editor handles. **/
  color?: [number, number, number, number];

  /**
   * RGBA, 0-255 - foreground color for a *dashed* line's dashes. Default
   * white: a dashed hint often overlays the solid draft edge of the same
   * shape (e.g. the polygon tool's "last edge" hint sits on top of the
   * in-progress polygon's own solid outline, same color) - a same-color
   * dash would be invisible in its own gaps, so this needs to contrast with
   * `color`, not match it.
   */
  dashColor?: [number, number, number, number];

  /**
   * RGBA, 0-255 - halo drawn behind a dashed line's dashes, for contrast
   * against light backgrounds too (the same halo-behind-dashes technique
   * used for the box editor's rotate-handle connector).
   */
  dashHaloColor?: [number, number, number, number];

  /** Screen pixels. **/
  lineWidth?: number;

  /** Screen pixels - point hint radius for the 'default' variant. **/
  pointRadius?: number;

  /** Screen pixels - point hint radius once its `variant` is 'active'. **/
  activePointRadius?: number;

}

const DEFAULT_STYLE: Required<HintStyle> = {
  color: [26, 115, 232, 255],
  dashColor: [255, 255, 255, 255],
  dashHaloColor: [0, 0, 0, 140],
  lineWidth: 1.5,
  pointRadius: 5,
  activePointRadius: 8
};

export interface BuildHintLayersOptions {

  style?: HintStyle;

  /** Prefix for layer ids - needed if multiple annotators share one Deck instance. **/
  idPrefix?: string;

}

type PointHint = Extract<ToolHint, { type: 'point' }>;
type LineHint = Extract<ToolHint, { type: 'line' }>;

/**
 * Builds the deck.gl layers for a drawing tool's local `ToolHint`s (see
 * tool-hint.ts) - purely visual drawing aids, never part of a committed
 * annotation and never synced to other users (unlike drafts - see
 * draft-store.ts). A point hint renders as a small circle that grows and
 * switches to a filled accent color for the 'active' variant (e.g. "the
 * cursor is close enough to close the polygon here"); a line hint renders as
 * a path, dashed via `PathStyleExtension` when `dashed` is set - split into
 * separate solid/dashed layers since the extension is a per-layer, not
 * per-datum, capability.
 */
export const buildHintLayers = (hints: ToolHint[], opts: BuildHintLayersOptions = {}): Layer[] => {
  const idPrefix = opts.idPrefix ? `${opts.idPrefix}-` : '';
  const style = { ...DEFAULT_STYLE, ...opts.style };

  const points = hints.filter((h): h is PointHint => h.type === 'point');
  const solidLines = hints.filter((h): h is LineHint => h.type === 'line' && !h.dashed);
  const dashedLines = hints.filter((h): h is LineHint => h.type === 'line' && !!h.dashed);

  const layers: Layer[] = [];

  if (solidLines.length > 0) {
    layers.push(new PathLayer<LineHint>({
      id: `${idPrefix}hints-lines-solid`,
      data: solidLines,
      pickable: false,
      widthUnits: 'pixels',
      getPath: h => [h.from, h.to],
      getColor: style.color,
      getWidth: style.lineWidth
    }));
  }

  if (dashedLines.length > 0) {
    layers.push(new PathLayer<LineHint>({
      id: `${idPrefix}hints-lines-dashed-halo`,
      data: dashedLines,
      pickable: false,
      widthUnits: 'pixels',
      getPath: h => [h.from, h.to],
      getColor: style.dashHaloColor,
      getWidth: style.lineWidth + 2
    }));

    layers.push(new PathLayer<LineHint, PathStyleExtensionProps<LineHint>>({
      id: `${idPrefix}hints-lines-dashed`,
      data: dashedLines,
      pickable: false,
      widthUnits: 'pixels',
      getPath: h => [h.from, h.to],
      getColor: style.dashColor,
      getWidth: style.lineWidth,
      extensions: [new PathStyleExtension({ dash: true })],
      getDashArray: [3, 2],
      dashJustified: true
    }));
  }

  if (points.length > 0) {
    layers.push(new ScatterplotLayer<PointHint>({
      id: `${idPrefix}hints-points`,
      data: points,
      pickable: false,
      stroked: true,
      filled: true,
      radiusUnits: 'pixels',
      lineWidthUnits: 'pixels',
      getPosition: h => h.position,
      getRadius: h => h.variant === 'active' ? style.activePointRadius : style.pointRadius,
      getFillColor: h => h.variant === 'active' ? style.color : [255, 255, 255, 255],
      getLineColor: style.color,
      getLineWidth: 2
    }));
  }

  return layers;
}
