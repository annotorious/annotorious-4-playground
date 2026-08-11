export interface ApplicationRegionOptions {

  label?: string;

}

/**
 * Marks the element hosting the DeckGL canvas (shapes-at-rest) as an
 * `application` landmark for assistive tech - a minimum signal that this is
 * an interactive canvas, not a document to read, so a screen reader hands
 * off standard navigation rather than trying to walk pixels that carry no
 * semantic structure.
 *
 * Scope this tightly to the canvas container alone, not a larger page
 * region - `role="application"` suppresses normal reading-mode navigation
 * within its subtree, which would be disorienting if applied too broadly.
 * The interactive tool/editor DOM layer (real focusable, labeled elements)
 * is what carries the actual accessible interaction surface; this role is
 * just there to correctly set expectations around the canvas itself, which
 * - being pixels - can't be made screen-reader-navigable the way any
 * WebGL/canvas-heavy visualization can't.
 */
export const markAsApplicationRegion = (container: HTMLElement, opts: ApplicationRegionOptions = {}) => {
  container.setAttribute('role', 'application');
  container.setAttribute('aria-label', opts.label || 'Annotation canvas');
}
