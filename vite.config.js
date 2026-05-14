import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/runtime.js',
      name: 'WebGLRuntime',
      fileName: 'runtime',
      formats: ['iife'],  // self-executing — sets globals immediately on load
    },
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
