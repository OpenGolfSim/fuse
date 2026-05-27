import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
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
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
