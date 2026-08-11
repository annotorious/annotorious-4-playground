import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [
    solid(),
    dts({ tsconfigPath: './tsconfig.json' })
  ],
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'mjs' : 'cjs'}`,
    },
    rollupOptions: {
      // solid-js is NOT external - it's bundled directly into our output so
      // every consumer gets their own private copy of the Solid runtime,
      // fully isolated from any Solid version a host app might use itself.
      // @deck.gl/* MUST stay external, for the opposite reason: deck.gl
      // Layer instances have to come from the exact same module instance as
      // the host's Deck renderer (it does instanceof-based diffing
      // internally) - a bundled private copy would silently fail to render.
      // nanostores stays external too, matching @annotorious/core's own
      // treatment - same package, one shared copy via normal npm dedup.
      external: ['@annotorious/core', 'rbush', 'nanostores', '@deck.gl/core', '@deck.gl/layers', '@deck.gl/extensions'],
    },
    sourcemap: true,
    target: 'es2022',
  },
});
