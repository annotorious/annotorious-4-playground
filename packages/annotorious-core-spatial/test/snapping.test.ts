import { describe, expect, it } from 'vitest';
import { createAnnotationIndex } from '../src/annotation-index';
import { createBox } from '../src/geometry';
import { createGridSnapping, createNearbyAnnotationSnapping } from '../src/tools';
import type { SpatialAnnotationTarget } from '../src/model';

describe('grid snapping', () => {

  it('snaps to the nearest grid cell', () => {
    const snapping = createGridSnapping(10);
    expect(snapping.snap([13, 27])).toEqual([10, 30]);
    expect(snapping.snap([15, 15])).toEqual([20, 20]);
  });

});

describe('nearby annotation snapping', () => {

  it('snaps to the nearest corner of a nearby box within threshold', () => {
    const index = createAnnotationIndex<SpatialAnnotationTarget>();
    index.insert({ annotation: 'a', selector: createBox(100, 100, 50, 50) });

    const snapping = createNearbyAnnotationSnapping(index, 10);

    // Close to the box's top-left corner (100, 100)
    expect(snapping.snap([103, 97])).toEqual([100, 100]);
  });

  it('leaves the point unchanged when nothing is within threshold', () => {
    const index = createAnnotationIndex<SpatialAnnotationTarget>();
    index.insert({ annotation: 'a', selector: createBox(1000, 1000, 50, 50) });

    const snapping = createNearbyAnnotationSnapping(index, 10);
    expect(snapping.snap([0, 0])).toEqual([0, 0]);
  });

});
