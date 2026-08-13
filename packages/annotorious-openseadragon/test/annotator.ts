import OpenSeadragon from 'openseadragon';
import { createBox, registerDefaultEditors, registerDefaultTools } from '@annotorious/core-spatial';
import type { DrawingMode, SpatialAnnotation } from '@annotorious/core-spatial';
import { createOSDAnnotator } from '../src/annotator';

registerDefaultTools();
registerDefaultEditors();

const IMAGE_1 = 'https://iiif.bodleian.ox.ac.uk/iiif/image/79bf8325-22fa-4696-afe5-7d827d84f393/info.json';
// Reusing IMAGE_1 for the second image too - the point of this demo button
// is to prove out the multi-image *mechanics* (two TiledImages, two
// `source` ids, annotations kept correctly separate), not to source two
// distinct pictures.
const IMAGE_2 = IMAGE_1;

const viewer = OpenSeadragon({
  id: 'openseadragon',
  prefixUrl: 'https://cdn.jsdelivr.net/npm/openseadragon@6/build/openseadragon/images/',
  showNavigationControl: false,
  tileSources: IMAGE_1,
  gestureSettingsMouse: {
    clickToZoom: false
  },
  // OSD defaults to preferring its own WebGL drawer for tiles
  // (['auto', 'webgl', 'canvas', 'html']) - stacking that on top of deck.gl's
  // own WebGL canvas means two independent WebGL contexts competing for the
  // same GPU/texture memory. At 100k+ annotations, deck.gl's buffers are
  // large enough that OSD's own context can start failing texture creation
  // (visible as "Error creating texture in WebGL" - that's OSD's tile
  // renderer, not deck.gl or this library) and its tiles fall behind the
  // viewport our overlay is tracking, which looks like the two drifting
  // apart. Tile rendering doesn't need WebGL - only the 100k-shape overlay
  // does - so keep them on separate rendering paths entirely.
  drawer: 'canvas'
});

const anno = createOSDAnnotator(viewer, { multiSelect: true });

// Debug hook for testing - not part of the published package.
(window as any).__anno = anno;
(window as any).__viewer = viewer;

// Demonstrates AnnotationState (selected/hovered) actually reaching the
// style callback: selected annotations render solid red, hovered ones get
// a heavier stroke, everything else uses the library default.
// Default (unselected/unhovered) shapes render fill-only, no stroke - matches
// test/index.ts's raw deck.gl benchmark (getLineWidth: 0), which exists
// specifically so panning/zooming performance is comparable apples-to-apples:
// a visible stroke means deck.gl builds and rasterizes a second (fill +
// stroke) sub-layer pass for every shape on every redraw, which is real,
// non-trivial GPU cost at high shape counts - not something the library
// defaults to skipping, since annotation borders are usually wanted, but not
// something this side-by-side comparison should be paying for either.
// Stable per-annotation random fill, matching test/index.ts's raw benchmark
// (`fillColor: [255*Math.random(), ...]`, assigned once per shape at
// generation time) - assigned lazily here instead, on first style lookup,
// and cached by id so it doesn't re-roll (and visibly flicker) on every
// rebuild. A `Math.random()` called directly inside the style callback
// would do exactly that, since the callback re-runs whenever the base
// layer rebuilds.
const randomFillColors = new Map<string, string>();
const randomFillFor = (id: string): string => {
  let color = randomFillColors.get(id);
  if (!color) {
    const rand255 = () => Math.floor(255 * Math.random());
    color = `rgb(${rand255()}, ${rand255()}, ${rand255()})`;
    randomFillColors.set(id, color);
  }
  return color;
}

anno.setStyle((annotation, state) => {
  if (state?.selected) return { fill: '#e8341a', fillOpacity: 0.4, stroke: '#e8341a', strokeWidth: 3 };
  if (state?.hovered) return { strokeWidth: 4 };
  return { fill: randomFillFor(annotation.id), fillOpacity: 100 / 255, strokeWidth: 0 };
});

const log = document.getElementById('log') as HTMLDivElement;
const line = (msg: string) => {
  const el = document.createElement('div');
  el.textContent = msg;
  log.prepend(el);
  while (log.childElementCount > 20) log.lastChild?.remove();
}

// createAnnotation fires once per annotation - fine for drawing one shape
// interactively, but a bulk `setAnnotations(100_000_shapes)` call fires it
// 100,000 times. Logging each individually would mean 100,000 DOM writes,
// swamping whatever the actual generate cost is - coalesce into one summary
// line per burst instead, the way any real host handling bulk data would.
// Scheduled at most once per burst (not reset on every event, i.e. throttled
// rather than debounced) - a debounce-style clearTimeout+setTimeout on every
// single call would just relocate the same "100,000 timer operations" cost
// from the DOM write into the scheduling itself.
let pendingCreates: string[] = [];
let flushCreatesScheduled = false;
const flushCreates = () => {
  flushCreatesScheduled = false;
  if (pendingCreates.length === 0) return;
  line(pendingCreates.length === 1
    ? `created ${pendingCreates[0]}`
    : `created ${pendingCreates.length} annotations`);
  pendingCreates = [];
}
anno.on('createAnnotation', a => {
  pendingCreates.push(`${a.id} (${a.target.selector.type})`);
  if (!flushCreatesScheduled) {
    flushCreatesScheduled = true;
    setTimeout(flushCreates, 200);
  }
});
anno.on('selectionChanged', selected => line(`selected [${selected.map(a => a.id.slice(0, 6)).join(', ')}]`));
anno.on('updateAnnotation', a => line(`updated ${a.id}`));
anno.on('deleteAnnotation', a => line(`deleted ${a.id}`));
anno.on('clickAnnotation', a => line(`clicked ${a.id.slice(0, 6)}`));
anno.on('viewportIntersect', visible => line(`viewport: ${visible.length} visible`));

const toolButtons: Record<string, HTMLButtonElement> = {
  box: document.getElementById('tool-box') as HTMLButtonElement,
  polygon: document.getElementById('tool-polygon') as HTMLButtonElement,
  point: document.getElementById('tool-point') as HTMLButtonElement,
  off: document.getElementById('tool-off') as HTMLButtonElement
};

const setActiveTool = (name: string | undefined) => {
  Object.entries(toolButtons).forEach(([key, btn]) => btn.classList.toggle('active', key === (name ?? 'off')));

  if (name) {
    anno.setDrawingTool(name);
    anno.setDrawingEnabled(true);
  } else {
    anno.setDrawingEnabled(false);
  }
}

toolButtons.box!.addEventListener('click', () => setActiveTool('box'));
toolButtons.polygon!.addEventListener('click', () => setActiveTool('polygon'));
toolButtons.point!.addEventListener('click', () => setActiveTool('point'));
toolButtons.off!.addEventListener('click', () => setActiveTool(undefined));
setActiveTool(undefined);

document.getElementById('undo')!.addEventListener('click', () => anno.undo());
document.getElementById('redo')!.addEventListener('click', () => anno.redo());

document.getElementById('add-second-image')!.addEventListener('click', async () => {
  const btn = document.getElementById('add-second-image') as HTMLButtonElement;
  btn.disabled = true;
  try {
    await anno.addImage(IMAGE_2, 'image-2', { x: 1.2, y: 0, width: 1 });
    line('added second image at x=1.2 (source: image-2)');
  } catch (err) {
    line(`failed to add second image: ${err}`);
  }
});

const modeButtons: Record<DrawingMode, HTMLButtonElement> = {
  drag: document.getElementById('mode-drag') as HTMLButtonElement,
  click: document.getElementById('mode-click') as HTMLButtonElement
};

const setDrawingMode = (mode: DrawingMode) => {
  Object.entries(modeButtons).forEach(([key, btn]) => btn.classList.toggle('active', key === mode));
  anno.setDrawingMode(mode);
}

modeButtons.drag!.addEventListener('click', () => setDrawingMode('drag'));
modeButtons.click!.addEventListener('click', () => setDrawingMode('click'));
setDrawingMode('drag');

// Performance test: generates N random boxes scattered across the open
// image and loads them via the real Annotator/Store API (setAnnotations),
// rather than pushing shapes into deck.gl directly (see the older,
// pre-annotator-API test/index.ts benchmark this replaces). An FPS counter
// runs continuously so panning/zooming performance is visible right after
// generating a large batch.
const perfCountInput = document.getElementById('perf-count') as HTMLInputElement;
const perfGenerateButton = document.getElementById('perf-generate') as HTMLButtonElement;
const perfFpsLabel = document.getElementById('perf-fps') as HTMLSpanElement;

// Shape size range matches test/index.ts's raw deck.gl benchmark (20-220px)
// deliberately - a fair comparison needs the same on-screen density/overdraw,
// not just the same shape count. `width/10`-scaled boxes (up to ~500x750px
// on this image) cover roughly 7x the area on average, which alone is enough
// to make rendering meaningfully more GPU-expensive independent of anything
// else, and would have made any A/B comparison against the raw demo unfair.
const generateAnnotations = (n: number): SpatialAnnotation[] => {
  const { x: width, y: height } = viewer.world.getItemAt(0).getContentSize();

  return Array.from({ length: n }, () => {
    const w = 20 + Math.random() * 200;
    const h = 20 + Math.random() * 200;
    const x = Math.random() * (width - w);
    const y = Math.random() * (height - h);

    const id = crypto.randomUUID();
    return { id, bodies: [], target: { annotation: id, selector: createBox(x, y, w, h) } };
  });
}

perfGenerateButton.addEventListener('click', () => {
  const n = Number(perfCountInput.value) || 0;
  const annotations = generateAnnotations(n);

  const started = performance.now();
  anno.setAnnotations(annotations);
  line(`generated ${n} annotations (${(performance.now() - started).toFixed(1)}ms)`);
});

let perfFrames = 0;
let perfLastReport = performance.now();

const perfTick = () => {
  perfFrames++;

  const now = performance.now();
  if (now - perfLastReport > 1000) {
    perfFpsLabel.textContent = `${perfFrames} fps`;
    perfFrames = 0;
    perfLastReport = now;
  }

  requestAnimationFrame(perfTick);
};

requestAnimationFrame(perfTick);

// Keyboard: Delete/Backspace removes the selected annotation(s), matching
// what most annotation tools support as a baseline expectation.
window.addEventListener('keydown', event => {
  if (event.key !== 'Delete' && event.key !== 'Backspace') return;
  if ((event.target as HTMLElement)?.tagName === 'INPUT') return;

  const selected = anno.getSelected();
  if (selected.length === 0) return;

  selected.forEach(a => anno.removeAnnotation(a.id));
  anno.cancelSelected();
});
