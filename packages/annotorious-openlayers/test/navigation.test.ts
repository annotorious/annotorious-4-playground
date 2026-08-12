import { afterEach, describe, expect, it } from 'vitest';
import Collection from 'ol/Collection.js';
import type Map from 'ol/Map.js';
import type Interaction from 'ol/interaction/Interaction.js';
import { resumeNavigation, suspendNavigation } from '../src/navigation';

const fakeInteraction = (active: boolean): Interaction => {
  let isActive = active;
  return {
    getActive: () => isActive,
    setActive: (a: boolean) => { isActive = a; }
  } as unknown as Interaction;
}

const fakeMap = (interactions: Interaction[]): Map =>
  ({ getInteractions: () => new Collection(interactions) }) as unknown as Map;

// suspendNavigation/resumeNavigation share module-level state - always
// leave it clean between tests regardless of whether a test called resume.
afterEach(() => resumeNavigation());

describe('navigation suspend/resume', () => {

  it('deactivates every currently-active interaction', () => {
    const a = fakeInteraction(true);
    const b = fakeInteraction(true);
    suspendNavigation(fakeMap([a, b]));

    expect(a.getActive()).toBe(false);
    expect(b.getActive()).toBe(false);
  });

  it('reactivates only the interactions that were active before suspending', () => {
    const active = fakeInteraction(true);
    const alreadyInactive = fakeInteraction(false); // e.g. a host had turned off rotation beforehand

    suspendNavigation(fakeMap([active, alreadyInactive]));
    resumeNavigation();

    expect(active.getActive()).toBe(true);
    expect(alreadyInactive.getActive()).toBe(false); // must NOT have been reactivated
  });

  it('is a no-op to call suspend twice in a row', () => {
    const a = fakeInteraction(true);
    const map = fakeMap([a]);

    suspendNavigation(map);
    a.setActive(true); // simulate something external reactivating it mid-gesture
    suspendNavigation(map); // must not re-snapshot (which would now capture "true" as the resume target)

    resumeNavigation();
    expect(a.getActive()).toBe(true); // still correct: it was active before the FIRST suspend
  });

  it('is a no-op to call resume without a prior suspend', () => {
    expect(() => resumeNavigation()).not.toThrow();
  });

});
