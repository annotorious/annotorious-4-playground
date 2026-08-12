import OpenSeadragon from 'openseadragon';
import { registerDefaultEditors, registerDefaultTools } from '@annotorious/core-spatial';
import { createOSDAnnotator } from '@annotorious/openseadragon';
import { attachAnnotationSync, createBroadcastChannelTransport } from '../src';

registerDefaultTools();
registerDefaultEditors();

const IMAGE_1 = 'https://iiif.bodleian.ox.ac.uk/iiif/image/79bf8325-22fa-4696-afe5-7d827d84f393/info.json';

const viewer = OpenSeadragon({
  id: 'openseadragon',
  prefixUrl: 'https://cdn.jsdelivr.net/npm/openseadragon@6/build/openseadragon/images/',
  showNavigationControl: false,
  tileSources: IMAGE_1,
  gestureSettingsMouse: {
    clickToZoom: false
  }
});

const anno = createOSDAnnotator(viewer, { multiSelect: true });

// One fixed channel for this demo - open this same page in two tabs and
// they'll sync live. A real app would derive the channel name from a room/
// document id.
const sync = attachAnnotationSync(anno, createBroadcastChannelTransport('annotorious-broadcast-sync-demo'));

document.querySelector('#peer-id b')!.textContent = sync.peerId.slice(0, 8);

// Debug hook for testing - not part of the published package.
(window as any).__sync = sync;

const log = document.getElementById('log') as HTMLDivElement;
const line = (msg: string) => {
  const el = document.createElement('div');
  el.textContent = msg;
  log.prepend(el);
  while (log.childElementCount > 20) log.lastChild?.remove();
}

// Logged from the store directly (not anno.on(...)) so both this tab's own
// edits AND synced-in changes from other peers show up - anno.on(...)'s
// lifecycle events are deliberately LOCAL-only (e.g. so autosave doesn't
// re-trigger on a remote peer's change), which would make the log look like
// nothing was received even when sync (and rendering) is working correctly.
anno.state.store.observe(({ origin, changes }) => {
  (changes.created || []).forEach(a => line(`[${origin}] created ${a.id.slice(0, 8)} (${a.target.selector.type})`));
  (changes.deleted || []).forEach(a => line(`[${origin}] deleted ${a.id.slice(0, 8)}`));
  (changes.updated || []).forEach(({ newValue }) => line(`[${origin}] updated ${newValue.id.slice(0, 8)}`));
});
anno.on('selectionChanged', selected => line(`selected [${selected.map(a => a.id.slice(0, 6)).join(', ')}]`));

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

// No explicit destroy-on-unload here: attachAnnotationSync already owns
// its own goodbye-on-close via a `pagehide` listener internally (see
// sync.ts) - calling destroy() again from `beforeunload` would actually be
// counterproductive, since `beforeunload` fires *before* `pagehide` and
// would tear down that internal listener before it gets a chance to run.
