import { defineConfig } from 'vite';
import path from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      include: ['src'],
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  build: {
    lib: {
      name: 'OpenGolfSimFuse',
      entry: 'src/index.ts',
      fileName: 'fuse',
      formats: ['es'],
    },
    sourcemap: true,
    outDir: 'dist/module',
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: {
      external: [
        'three',
        /^three\//,
      ],
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
