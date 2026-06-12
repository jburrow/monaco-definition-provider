import { describe, it, expect, vi } from 'vitest';
import { TsWorkerStrategy } from '../tsWorker';
import { FakeMonaco } from './helpers/fakeMonaco';
import type { DefinitionInfoLike, TypeScriptNamespaceLike, UriLike } from '../monacoEnv';

/** Scripted TS worker: maps "fileName:offset" → canned definition entries. */
function scriptedTsNamespace(
  responses: Record<string, DefinitionInfoLike[]>,
  calls: Array<{ fileName: string; offset: number; syncedUris: string[] }> = []
): TypeScriptNamespaceLike {
  const accessor = async (...uris: UriLike[]) => ({
    getDefinitionAtPosition: async (fileName: string, offset: number) => {
      calls.push({ fileName, offset, syncedUris: uris.map(u => u.toString()) });
      return responses[`${fileName}:${offset}`];
    }
  });
  return {
    getTypeScriptWorker: async () => accessor,
    getJavaScriptWorker: async () => accessor
  };
}

describe('TsWorkerStrategy', () => {
  it('returns null and warns once when the TS contribution is missing', async () => {
    const monaco = new FakeMonaco();
    const model = monaco.addModel('file:///proj/a.ts', 'const x = 1;\n', 'typescript');
    const strategy = new TsWorkerStrategy(monaco);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await strategy.provideDefinition(model, { lineNumber: 1, column: 7 })).toBeNull();
    expect(await strategy.provideDefinition(model, { lineNumber: 1, column: 7 })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('passes the model uri and a 0-based offset to the worker', async () => {
    const calls: Array<{ fileName: string; offset: number; syncedUris: string[] }> = [];
    const monaco = new FakeMonaco(scriptedTsNamespace({}, calls));
    const model = monaco.addModel('file:///proj/a.ts', 'const x = 1;\nx;\n', 'typescript');
    const strategy = new TsWorkerStrategy(monaco);

    await strategy.provideDefinition(model, { lineNumber: 2, column: 1 });
    expect(calls).toEqual([
      { fileName: 'file:///proj/a.ts', offset: 13, syncedUris: ['file:///proj/a.ts'] }
    ]);
  });

  it('returns null when the built-in provider already covers a cross-file jump', async () => {
    const monaco = new FakeMonaco();
    const model = monaco.addModel('file:///proj/a.ts', 'import { f } from "./b";\nf();\n', 'typescript');
    monaco.addModel('file:///proj/b.ts', 'export function f() {}\n', 'typescript');
    monaco.typescriptNamespace = scriptedTsNamespace({
      'file:///proj/a.ts:25': [
        { fileName: 'file:///proj/b.ts', textSpan: { start: 16, length: 1 } }
      ]
    });
    const strategy = new TsWorkerStrategy(monaco);

    expect(await strategy.provideDefinition(model, { lineNumber: 2, column: 1 })).toBeNull();
  });

  it('filters default lib files', async () => {
    const monaco = new FakeMonaco();
    const model = monaco.addModel('file:///proj/a.ts', 'parseInt("1");\n', 'typescript');
    monaco.typescriptNamespace = scriptedTsNamespace({
      'file:///proj/a.ts:0': [
        { fileName: 'file:///lib.es5.d.ts', textSpan: { start: 100, length: 8 } }
      ]
    });
    const strategy = new TsWorkerStrategy(monaco);

    expect(await strategy.provideDefinition(model, { lineNumber: 1, column: 1 })).toBeNull();
  });

  it('lazily loads an unresolved import and re-queries for the precise location', async () => {
    const source = 'import { helper } from "./utils";\n\nhelper();\n';
    const utilsSource = 'export function helper() {\n  return 1;\n}\n';
    const monaco = new FakeMonaco();
    const model = monaco.addModel('file:///proj/src/app.ts', source, 'typescript');

    const loadFile = vi.fn(async (uri: string) =>
      uri === 'file:///proj/src/utils.ts' ? { uri, content: utilsSource } : null
    );
    const strategy = new TsWorkerStrategy(monaco, { loadFile });

    // First query: the language service can only point at the import binding
    // (same file). After the lazy load, the retry must return the real,
    // cross-file definition.
    let callCount = 0;
    const accessor = async (...uris: UriLike[]) => ({
      getDefinitionAtPosition: async (fileName: string, offset: number) => {
        callCount++;
        if (callCount === 1) {
          return [{ fileName: 'file:///proj/src/app.ts', textSpan: { start: 9, length: 6 } }];
        }
        expect(uris.map(u => u.toString())).toContain('file:///proj/src/utils.ts');
        return [{ fileName: 'file:///proj/src/utils.ts', textSpan: { start: 16, length: 6 } }];
      }
    });
    monaco.typescriptNamespace = {
      getTypeScriptWorker: async () => accessor,
      getJavaScriptWorker: async () => accessor
    };

    const result = await strategy.provideDefinition(model, { lineNumber: 3, column: 1 });

    expect(loadFile).toHaveBeenCalledWith(
      'file:///proj/src/utils.ts',
      './utils',
      'file:///proj/src/app.ts'
    );
    // The loaded file became a real model with the right language.
    expect(
      monaco.editor.getModel(monaco.Uri.parse('file:///proj/src/utils.ts'))?.getLanguageId()
    ).toBe('typescript');
    // "helper" in "export function helper" starts at offset 16 → line 1, col 17.
    expect(result).toEqual([
      {
        uri: 'file:///proj/src/utils.ts',
        range: { startLineNumber: 1, startColumn: 17, endLineNumber: 1, endColumn: 23 }
      }
    ]);
  });

  it('extracts the specifier from the cursor line when there is no result at all', async () => {
    const source = 'import { helper } from "./utils";\n';
    const monaco = new FakeMonaco(scriptedTsNamespace({}));
    const model = monaco.addModel('file:///proj/src/app.ts', source, 'typescript');
    const loadFile = vi.fn(async () => null);
    const strategy = new TsWorkerStrategy(monaco, { loadFile });

    await strategy.provideDefinition(model, { lineNumber: 1, column: 10 });
    // All ./utils candidates offered to the host, .ts first.
    expect(loadFile).toHaveBeenCalledWith(
      'file:///proj/src/utils.ts',
      './utils',
      'file:///proj/src/app.ts'
    );
  });

  it('honors the resolveModuleUri hook for bare specifiers', async () => {
    const source = 'import { x } from "@app/shared";\nx;\n';
    const monaco = new FakeMonaco(scriptedTsNamespace({}));
    const model = monaco.addModel('file:///proj/src/app.ts', source, 'typescript');
    const loadFile = vi.fn(async (uri: string) => ({ uri, content: 'export const x = 1;\n' }));
    const strategy = new TsWorkerStrategy(monaco, {
      loadFile,
      resolveModuleUri: specifier =>
        specifier === '@app/shared' ? 'file:///proj/libs/shared/index.ts' : null
    });

    await strategy.provideDefinition(model, { lineNumber: 1, column: 12 });
    expect(loadFile).toHaveBeenCalledWith(
      'file:///proj/libs/shared/index.ts',
      '@app/shared',
      'file:///proj/src/app.ts'
    );
  });
});
