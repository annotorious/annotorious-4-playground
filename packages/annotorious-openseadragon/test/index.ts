import OpenSeadragon, { TileSource } from 'openseadragon';
import { PolygonLayer } from '@deck.gl/layers';
import { createDeckGLOverlay } from '../src/deck-gl-overlay';

const IMAGE_WIDTH = 5040;
const IMAGE_HEIGHT = 7520;

const viewer = OpenSeadragon({
  id: 'openseadragon',
  prefixUrl: 'https://cdn.jsdelivr.net/npm/openseadragon@6/build/openseadragon/images/',
  showNavigationControl: false,
  tileSources: 'https://iiif.bodleian.ox.ac.uk/iiif/image/79bf8325-22fa-4696-afe5-7d827d84f393/info.json'
});

const { deck } = createDeckGLOverlay(viewer);

const countInput = document.getElementById('count') as HTMLInputElement;
const regenerateButton = document.getElementById('regenerate') as HTMLButtonElement;
const fpsLabel = document.getElementById('fps') as HTMLSpanElement;

const generateShapes = (n: number) =>
  Array.from({ length: n }, () => {
    const w = 1 + Math.random() * 20;
    const h = 1 + Math.random() * 15;
    const x = Math.random() * (IMAGE_WIDTH - w);
    const y = Math.random() * (IMAGE_HEIGHT - h);

    return {
      polygon: [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]],
      fillColor: [255 * Math.random(), 255 * Math.random(), 255 * Math.random(), 100],
      lineColor: [255, 0, 0, 220]
    };
  });

const regenerate = () => {
  const n = Number(countInput.value) || 0;
  const data = generateShapes(n);

  deck.setProps({
    layers: [new PolygonLayer({
      data,
      pickable: false,
      stroked: true,
      filled: true,
      getPolygon: (d: any) => d.polygon,
      getFillColor: (d: any) => d.fillColor,
      // getLineColor: (d: any) => d.lineColor,
      getLineWidth: 0,
      lineWidthUnits: 'pixels',
      lineWidthMinPixels: 0
    })]
  });
};

regenerateButton.addEventListener('click', regenerate);
viewer.addHandler('open', regenerate);

let frames = 0;
let lastReport = performance.now();

const tick = () => {
  frames++;

  const now = performance.now();
  if (now - lastReport > 1000) {
    fpsLabel.textContent = `${frames} fps`;
    frames = 0;
    lastReport = now;
  }

  requestAnimationFrame(tick);
};

requestAnimationFrame(tick);
