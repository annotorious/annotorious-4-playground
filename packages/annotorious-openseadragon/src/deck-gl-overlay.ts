import type OpenSeadragon from 'openseadragon';
import { Deck, OrthographicView } from '@deck.gl/core';

export const createDeckGLOverlay = (viewer: OpenSeadragon.Viewer, options?: any) => {
  let containerWidth = 0;
  let containerHeight = 0;

  const canvasdiv = document.createElement('div');
  canvasdiv.style.position = 'absolute';
  canvasdiv.style.left = '0px';
  canvasdiv.style.top = '0px';
  canvasdiv.style.width = '100%';
  canvasdiv.style.height = '100%';
  viewer.canvas.appendChild(canvasdiv);

  const deck = new Deck<OrthographicView>(Object.assign({
    parent: canvasdiv,
    views: new OrthographicView(),
    controller: false
  }, options || {}));

  const resize = () => {
    if (containerWidth !== viewer.container.clientWidth) {
      containerWidth = viewer.container.clientWidth;
      canvasdiv.setAttribute('width', String(containerWidth));
    }

    if (containerHeight !== viewer.container.clientHeight) {
      containerHeight = viewer.container.clientHeight;
      canvasdiv.setAttribute('height', String(containerHeight));
    }
  };

  const updateViewport = () => {
    const viewport = viewer.viewport as any;
    const lastFlag = viewport.silenceMultiImageWarnings || false;
    viewport.silenceMultiImageWarnings = true;

    const center = viewport.viewportToImageCoordinates(viewport.getCenter(true));
    const zoom = Math.log2(viewport.viewportToImageZoom(viewport.getZoom(true)));

    deck.setProps({
      initialViewState: {
        target: [center.x, center.y, 0],
        zoom: zoom
      }
    });

    viewport.silenceMultiImageWarnings = lastFlag;
  };

  viewer.addHandler('update-viewport', () => {
    resize();
    updateViewport();
  });

  viewer.addHandler('open', () => {
    resize();
    updateViewport();
  });

  window.addEventListener('resize', () => {
    resize();
    updateViewport();
  });

  return { deck };

}
