import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: './demo',
  server: {
    port: 3000,
    open: true
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
