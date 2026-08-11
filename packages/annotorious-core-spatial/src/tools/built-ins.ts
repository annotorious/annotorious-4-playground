import { createBoxEditor } from './box-editor';
import { createBoxTool } from './box-tool';
import { registerTool } from './drawing-tool';
import { ShapeType } from '../geometry';
import { createPointEditor } from './point-editor';
import { createPointTool } from './point-tool';
import { createPolygonEditor } from './polygon-editor';
import { createPolygonTool } from './polygon-tool';
import { registerEditor } from './shape-editor';

/**
 * Registers the box/polygon/point tools under their conventional names.
 * Not called automatically on import (the package has `sideEffects: false`,
 * and auto-registration on import would fight tree-shaking) - call this
 * explicitly, or register individual tools yourself under whatever names
 * you prefer.
 */
export const registerDefaultTools = () => {
  registerTool('box', createBoxTool);
  registerTool('polygon', createPolygonTool);
  registerTool('point', createPointTool);
}

/** Registers the box/polygon/point editors for their respective shape types. **/
export const registerDefaultEditors = () => {
  registerEditor(ShapeType.BOX, createBoxEditor);
  registerEditor(ShapeType.POLYGON, createPolygonEditor);
  registerEditor(ShapeType.POINT, createPointEditor);
}
