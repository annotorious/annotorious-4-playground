export interface Bounds {

  minX: number;

  minY: number;

  maxX: number;

  maxY: number;

}

export enum ShapeType {

  BOX = 'BOX',

  POLYGON = 'POLYGON',

  POINT = 'POINT'

}

/** Base for all concrete geometries - every geometry knows its own axis-aligned bounds. **/
export interface Geometry {

  bounds: Bounds;

}

export interface BoxGeometry extends Geometry {

  x: number;

  y: number;

  w: number;

  h: number;

  /** Rotation in radians, around the box center. **/
  rot?: number;

}

export interface PolygonGeometry extends Geometry {

  /** A single ring of [x, y] vertices - the polygon is implicitly closed. **/
  points: [number, number][];

}

export interface PointGeometry extends Geometry {

  x: number;

  y: number;

}

export interface Shape<T extends ShapeType = ShapeType, G extends Geometry = Geometry> {

  type: T;

  geometry: G;

}

export interface Box extends Shape<ShapeType.BOX, BoxGeometry> { }

export interface Polygon extends Shape<ShapeType.POLYGON, PolygonGeometry> { }

export interface Point extends Shape<ShapeType.POINT, PointGeometry> { }

export type SpatialShape = Box | Polygon | Point;
