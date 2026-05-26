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
      name: 'OpenGolfSim_FUSE',
      // entry: 'src/runtime.js',
      // fileName: 'runtime',
      // formats: ['iife'],  // self-executing — sets globals immediately on load
      entry: 'src/index.ts',
      fileName: 'fuse',
      formats: ['es'],  // self-executing — sets globals immediately on load
    },
    // sourcemap: true,
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    minify: 'esbuild',
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
