import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Parser } from 'web-tree-sitter';
import { createPythonParser } from '../../analyzers/python/parser';

const require = createRequire(import.meta.url);

/** Create a Python parser for Node/vitest, loading grammar wasm from tree-sitter-python. */
export async function testPythonParser(): Promise<Parser> {
  const grammarPath = require.resolve('tree-sitter-python/tree-sitter-python.wasm');
  return createPythonParser({
    grammarWasm: readFileSync(grammarPath),
    locateFile: (fileName: string) => require.resolve(`web-tree-sitter/${fileName}`)
  });
}
