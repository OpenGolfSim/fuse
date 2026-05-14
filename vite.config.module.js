import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/module.js',
      name: 'WebGLModule',
      fileName: 'module',
      formats: ['es']
    },
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2020',
  },
});
