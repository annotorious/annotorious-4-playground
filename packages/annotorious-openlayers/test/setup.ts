// jsdom doesn't implement ResizeObserver, but ol/Map's constructor uses one
// internally to track its target element's size. A no-op stub is enough for
// tests that never actually resize a container - they still need the class
// to exist so `new Map(...)` doesn't throw.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(globalThis as any).ResizeObserver ??= ResizeObserverStub;
