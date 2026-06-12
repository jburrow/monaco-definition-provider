import { defineConfig } from 'tsup';
import { copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  shims: true,
  external: ['monaco-editor', 'web-tree-sitter'],
  onSuccess: async () => {
    // Vendor the python grammar next to the built entry so the runtime
    // default `new URL('./tree-sitter-python.wasm', import.meta.url)` works.
    copyFileSync(
      require.resolve('tree-sitter-python/tree-sitter-python.wasm'),
      'dist/tree-sitter-python.wasm'
    );
  }
});
