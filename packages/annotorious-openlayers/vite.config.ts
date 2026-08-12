import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({ tsconfigPath: './tsconfig.json' })
  ],
  server: {
    open: '/test/annotator.html'
  },
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'mjs' : 'cjs'}`,
    },
    rollupOptions: {
      external: [
        '@annotorious/core', '@annotorious/core-spatial',
        '@deck.gl/core', '@deck.gl/layers',
        /^ol(\/.*)?$/ // matches bare 'ol' and every 'ol/...' subpath - 'ol' is used almost exclusively via subpath imports
      ],
    },
    sourcemap: true,
    target: 'es2022',
  },
});
