import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({ tsconfigPath: './tsconfig.json' })
  ],
  server: {
    open: '/test/index.html'
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
        'openseadragon'
      ],
    },
    sourcemap: true,
    target: 'es2022',
  },
});
