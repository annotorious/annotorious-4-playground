import type Map from 'ol/Map.js';
import type Interaction from 'ol/interaction/Interaction.js';

/**
 * Suspends/resumes the map's own pan/zoom/rotate interactions for the
 * duration of a custom drag gesture (drawing a shape, dragging an editor
 * handle) - the OpenLayers equivalent of OpenSeadragon's single
 * `viewer.setMouseNavEnabled(bool)` flag.
 *
 * Unlike OSD's flag, which only ever touches OSD's own built-in gesture
 * handling, `map.getInteractions()` can also hold interactions a *host app*
 * added itself. Blanket re-enabling everything on gesture-end would wrongly
 * reactivate an interaction the host had deliberately turned off beforehand
 * (e.g. they'd already disabled rotation, or keep a custom interaction
 * toggled off). Snapshotting exactly which interactions were active before
 * suspending - and restoring only those - avoids that.
 *
 * One shared module (not duplicated into pointer.ts and editor-overlay.ts
 * separately), matching how both of OSD's equivalent files call the exact
 * same `viewer.setMouseNavEnabled`.
 */
let suspended: Interaction[] | undefined;

export const suspendNavigation = (map: Map) => {
  if (suspended) return; // already suspended - pointer.ts and editor-overlay.ts gestures never overlap, but stay defensive

  suspended = map.getInteractions().getArray().filter(i => i.getActive());
  suspended.forEach(i => i.setActive(false));
}

export const resumeNavigation = () => {
  suspended?.forEach(i => i.setActive(true));
  suspended = undefined;
}
