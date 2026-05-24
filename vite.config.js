import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    lib: {
      // entry: 'src/index.ts',
      entry: 'src/runtime.js',
      name: 'FUSERuntime',
      fileName: 'runtime',
      formats: ['iife'],  // self-executing — sets globals immediately on load
      // fileName: 'fuse',
      // formats: ['es'],  // self-executing — sets globals immediately on load
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
