import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: './demo',
  // GitHub Pages serves the demo from /<repo-name>/ — set by the deploy workflow.
  base: process.env.DEMO_BASE ?? '/',
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: resolve(__dirname, 'dist-demo'),
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '/src': resolve(__dirname, 'src')
    }
  },
  optimizeDeps: {
    include: ['monaco-editor']
  }
});
