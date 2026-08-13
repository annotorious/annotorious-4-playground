import Map from 'ol/Map.js';
import View from 'ol/View.js';
import TileLayer from 'ol/layer/Tile.js';
import IIIF from 'ol/source/IIIF.js';
import IIIFInfo from 'ol/format/IIIFInfo.js';
import { defaults as defaultInteractions } from 'ol/interaction/defaults.js';
import { registerDefaultEditors, registerDefaultTools } from '@annotorious/core-spatial';
import type { DrawingMode } from '@annotorious/core-spatial';
import { createOLAnnotator } from '../src/annotator';

registerDefaultTools();
registerDefaultEditors();

const IMAGE_INFO_URL = 'https://iiif.bodleian.ox.ac.uk/iiif/image/79bf8325-22fa-4696-afe5-7d827d84f393/info.json';

// Rotation interactions disabled: coordinates.ts/getEditorTransform assume
// the image itself is never rotated in the world (same scope limit the
// OpenSeadragon package's coordinates.ts already documents for a rotated
// TiledImage placement) - see the plan's Part G verification checklist.
const map = new Map({
  target: 'openlayers',
  layers: [],
  view: new View({ center: [0, 0], zoom: 1 }),
  interactions: defaultInteractions({ altShiftDragRotate: false, pinchRotate: false })
});

fetch(IMAGE_INFO_URL)
  .then(r => r.json())
  .then(imageInfo => {
    const options = new IIIFInfo(imageInfo).getTileSourceOptions();
    if (!options) throw new Error('Could not parse IIIF image info');

    options.zDirection = -1;
    const source = new IIIF(options);
    map.addLayer(new TileLayer({ source }));

    const tileGrid = source.getTileGrid();
    if (!tileGrid) throw new Error('IIIF source has no tile grid');

    const extent = tileGrid.getExtent();
    const view = new View({ resolutions: tileGrid.getResolutions(), extent, constrainOnlyCenter: true });
    map.setView(view);
    view.fit(extent);

    const [width, height] = options.size;
    const anno = createOLAnnotator(map, { width, height, multiSelect: true });
    (window as any).__anno = anno;

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
  })
  .catch(err => {
    const log = document.getElementById('log') as HTMLDivElement;
    log.textContent = `Failed to load image: ${err}`;
  });
