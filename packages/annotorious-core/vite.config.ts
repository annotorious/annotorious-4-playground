import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    // bundleTypes requires @microsoft/api-extractor - not worth the extra
    // dependency yet, unbundled per-module .d.ts output works fine as-is.
    dts({ tsconfigPath: './tsconfig.json' })
  ],
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'mjs' : 'cjs'}`,
    },
    rollupOptions: {
      external: ['nanostores'],
    },
    sourcemap: true,
    target: 'es2022',
  },
});