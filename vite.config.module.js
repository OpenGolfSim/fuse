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
      entry: 'src/module.ts',
      name: 'WebGLModule',
      fileName: 'module',
      formats: ['es']
    },
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2020',
  },
});
