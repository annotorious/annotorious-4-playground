import { describe, expect, it } from 'vitest';
import { createImageRegistry } from '../src/image-registry';

describe('image registry (single-image)', () => {

  it('resolves the registered image for source: undefined, matching the implicit-default convention', () => {
    const registry = createImageRegistry({ width: 100, height: 50 });
    const image = registry.get(undefined);

    expect(image).toBeDefined();
    expect(image).toMatchObject({ source: undefined, width: 100, height: 50 });
  });

  it('resolves nothing for any explicit source id - single-image MVP has none', () => {
    const registry = createImageRegistry({ width: 100, height: 50 });
    expect(registry.get('some-image-id')).toBeUndefined();
  });

  it('lists exactly the one registered image via all()', () => {
    const registry = createImageRegistry({ width: 100, height: 50 });
    expect(registry.all()).toHaveLength(1);
    expect(registry.all()[0]).toMatchObject({ width: 100, height: 50 });
  });

  it('finds the image at a point within its bounds', () => {
    const registry = createImageRegistry({ width: 100, height: 50 });
    expect(registry.getImageAt([50, 25])).toBeDefined();
    expect(registry.getImageAt([0, 0])).toBeDefined();
    expect(registry.getImageAt([100, 50])).toBeDefined(); // inclusive at the far edge
  });

  it('finds nothing outside the image bounds', () => {
    const registry = createImageRegistry({ width: 100, height: 50 });
    expect(registry.getImageAt([-1, 25])).toBeUndefined();
    expect(registry.getImageAt([50, -1])).toBeUndefined();
    expect(registry.getImageAt([101, 25])).toBeUndefined();
    expect(registry.getImageAt([50, 51])).toBeUndefined();
  });

});
