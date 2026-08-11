import OpenSeadragon from 'openseadragon';
import { registerDefaultEditors, registerDefaultTools } from '@annotorious/core-spatial';
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
  tileSources: IMAGE_1
});

const anno = createOSDAnnotator(viewer, { multiSelect: true });

const log = document.getElementById('log') as HTMLDivElement;
const line = (msg: string) => {
  const el = document.createElement('div');
  el.textContent = msg;
  log.prepend(el);
  while (log.childElementCount > 20) log.lastChild?.remove();
}

anno.on('createAnnotation', a => line(`created ${a.id} (${a.target.selector.type})`));
anno.on('selectionChanged', selected => line(`selected [${selected.map(a => a.id.slice(0, 6)).join(', ')}]`));
anno.on('updateAnnotation', a => line(`updated ${a.id}`));
anno.on('deleteAnnotation', a => line(`deleted ${a.id}`));

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
