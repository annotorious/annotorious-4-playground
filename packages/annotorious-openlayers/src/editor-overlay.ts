import type Map from 'ol/Map.js';
import { getEditor } from '@annotorious/core-spatial';
import type { EditorContext, ShapeEditor, SnappingProvider, SpatialAnnotation, SpatialAnnotationTarget } from '@annotorious/core-spatial';
import type { AnnotatorState } from '@annotorious/core';
import { createImageTransforms, getEditorTransform } from './coordinates';
import { resumeNavigation, suspendNavigation } from './navigation';
import type { ImageRegistry } from './image-registry';

export interface EditorOverlayOptions {

  snapping?: SnappingProvider;

}

/**
 * Mounts/unmounts a `ShapeEditor` (resize/rotate/vertex handles) for the
 * current selection. Same structure as the OpenSeadragon package's
 * `editor-overlay.ts` - MVP scope: at most one editor mounted at a time.
 */
// Generic over E for the same reason as createPointerHandling - only ever
// touches the internal SpatialAnnotation representation.
export const createEditorOverlay = <E>(
  map: Map,
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
  map.getViewport().appendChild(container);

  let mounted: { id: string, editor: ShapeEditor } | undefined;

  const unmount = () => {
    if (!mounted) return;
    mounted.editor.destroy();
    mounted = undefined;
  }

  const resolveImage = (target: SpatialAnnotationTarget) => imageRegistry.get(target.source);

  const mountFor = (annotation: SpatialAnnotation) => {
    const image = resolveImage(annotation.target);
    if (!image) return;

    const factory = getEditor(annotation.target.selector.type);
    if (!factory) return;

    const { toLocalCoordinates } = createImageTransforms(map, image);

    const ctx: EditorContext = {
      toLocalCoordinates,
      ...(opts.snapping ? { snapping: opts.snapping } : {}),
      onChange: shape => store.updateTarget({ annotation: annotation.id, selector: shape }),
      // A handle drag must not also pan/zoom the map underneath it.
      onDragStart: () => suspendNavigation(map),
      onDragEnd: () => resumeNavigation()
    };

    const editor = factory(ctx);
    editor.mount(container, annotation.target.selector, getEditorTransform(map, image));
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

    const image = resolveImage(annotation.target);
    if (!image) return;

    mounted.editor.update(annotation.target.selector, getEditorTransform(map, image));
  }

  map.on('postrender', refresh);
  store.observe(refresh);

  const destroy = () => {
    unmount();
    map.un('postrender', refresh);
    store.unobserve(refresh);
    container.remove();
  }

  return { destroy };

}
