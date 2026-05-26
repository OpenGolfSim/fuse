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
      name: 'OpenGolfSim_FUSE',
      entry: 'src/index.ts',
      fileName: 'fuse',
      formats: ['es'],
    },
    sourcemap: true,
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
