import type OpenSeadragon from 'openseadragon';
import { getEditor } from '@annotorious/core-spatial';
import type { EditorContext, ShapeEditor, SnappingProvider, SpatialAnnotation, SpatialAnnotationTarget } from '@annotorious/core-spatial';
import type { AnnotatorState } from '@annotorious/core';
import { createImageTransforms, getEditorTransform } from './coordinates';
import type { ImageRegistry } from './image-registry';

export interface EditorOverlayOptions {

  snapping?: SnappingProvider;

}

/**
 * Mounts/unmounts a `ShapeEditor` (resize/rotate/vertex handles) for the
 * current selection. MVP scope: at most one editor mounted at a time, for
 * the first editable selected annotation - simultaneous multi-shape editing
 * is a reasonable thing to add later, but isn't needed to prove this out.
 */
// Generic over E for the same reason as createPointerHandling - only ever
// touches the internal SpatialAnnotation representation.
export const createEditorOverlay = <E>(
  viewer: OpenSeadragon.Viewer,
  state: AnnotatorState<SpatialAnnotation, E>,
  imageRegistry: ImageRegistry,
  opts: EditorOverlayOptions = {}
) => {
  const { store, selection } = state;

  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '0';
  container.style.top = '0';
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.pointerEvents = 'none'; // individual handles opt back in
  viewer.canvas.appendChild(container);

  let mounted: { id: string, editor: ShapeEditor } | undefined;

  const unmount = () => {
    if (!mounted) return;
    mounted.editor.destroy();
    mounted = undefined;
  }

  const resolveImage = (target: SpatialAnnotationTarget): OpenSeadragon.TiledImage | undefined =>
    imageRegistry.get(target.source);

  const mountFor = (annotation: SpatialAnnotation) => {
    const tiledImage = resolveImage(annotation.target);
    if (!tiledImage) return;

    const factory = getEditor(annotation.target.selector.type);
    if (!factory) return;

    const { toLocalCoordinates } = createImageTransforms(viewer, tiledImage);

    const ctx: EditorContext = {
      toLocalCoordinates,
      ...(opts.snapping ? { snapping: opts.snapping } : {}),
      onChange: shape => store.updateTarget({ annotation: annotation.id, selector: shape }),
      // A handle drag must not also pan/zoom the viewer underneath it.
      onDragStart: () => viewer.setMouseNavEnabled(false),
      onDragEnd: () => viewer.setMouseNavEnabled(true)
    };

    const editor = factory(ctx);
    editor.mount(container, annotation.target.selector, getEditorTransform(viewer, tiledImage));
    mounted = { id: annotation.id, editor };
  }

  selection.subscribe(({ selected }) => {
    unmount();

    const editableId = selected.find(s => s.editable)?.id;
    if (!editableId) return;

    const annotation = store.getAnnotation(editableId);
    if (annotation) mountFor(annotation);
  });

  // Keeps the editor's on-screen position in sync with viewport changes
  // (pan/zoom) and with annotation updates from any source (remote, undo,
  // ...). Synchronous, deliberately - see deck-overlay.ts's onStoreChange
  // for why a deferred/batched update here would visibly lag behind the
  // shape-at-rest layer.
  const refresh = () => {
    if (!mounted) return;

    const annotation = store.getAnnotation(mounted.id);
    if (!annotation) return;

    const tiledImage = resolveImage(annotation.target);
    if (!tiledImage) return;

    mounted.editor.update(annotation.target.selector, getEditorTransform(viewer, tiledImage));
  }

  viewer.addHandler('update-viewport', refresh);
  store.observe(refresh);

  const destroy = () => {
    unmount();
    viewer.removeHandler('update-viewport', refresh);
    store.unobserve(refresh);
    container.remove();
  }

  return { destroy };

}
