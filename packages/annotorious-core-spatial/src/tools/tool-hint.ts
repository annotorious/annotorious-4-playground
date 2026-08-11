/**
 * Purely local, ephemeral visual aids a tool can show while drawing -
 * a "click here to close" indicator, a dashed preview edge, and similar
 * chrome that helps the user draw but never becomes part of the committed
 * annotation.
 *
 * Deliberately separate from `SpatialShape`/the draft mechanism: a hint
 * isn't "on its way to becoming a real annotation" the way a draft shape
 * is, so it isn't synced through `DraftStore` in a multiplayer scenario -
 * there's nothing useful for a remote viewer to see in "your own cursor
 * happens to be near your own first vertex". Kept as a small, dedicated
 * type (rather than reusing `SpatialShape`) because dashed lines and
 * highlight variants aren't real annotation geometry concepts.
 */
export type ToolHint =
  | { type: 'point', position: [number, number], variant?: 'default' | 'active' }
  | { type: 'line', from: [number, number], to: [number, number], dashed?: boolean };
