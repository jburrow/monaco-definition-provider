import { describe, it, expect, vi, beforeAll } from 'vitest';
import { DefinitionProvider, createDefinitionProvider } from '../DefinitionProvider';
import { FakeMonaco } from './helpers/fakeMonaco';
import { testPythonParser } from './helpers/pythonTestParser';

beforeAll(async () => {
  // Prime the shared tree-sitter language with Node-friendly wasm paths.
  await testPythonParser();
});

describe('DefinitionProvider', () => {
  it('registers and unregisters with monaco', () => {
    const monaco = new FakeMonaco();
    const provider = new DefinitionProvider(monaco);

    const reg = provider.register('python');
    provider.register('typescript');
    expect(monaco.registeredProviders.map(r => r.languageId)).toEqual(['python', 'typescript']);

    reg.dispose();
    expect(monaco.registeredProviders.map(r => r.languageId)).toEqual(['typescript']);

    provider.dispose();
    expect(monaco.registeredProviders).toEqual([]);
  });

  it('resolves python definitions end-to-end across lazily loaded files', async () => {
    const monaco = new FakeMonaco();
    const main = monaco.addModel(
      'file:///proj/main.py',
      'from utils import helper\n\nhelper(1)\n',
      'python'
    );
    const loadFile = vi.fn(async (uri: string) =>
      uri === 'file:///proj/utils.py' ? { uri, content: 'def helper(x):\n    return x\n' } : null
    );
    const provider = new DefinitionProvider(monaco, { loadFile });

    const result = await provider.provideDefinition(main, { lineNumber: 3, column: 1 });

    expect(result).toHaveLength(1);
    expect(result![0].uri.toString()).toBe('file:///proj/utils.py');
    expect(result![0].range).toEqual({
      startLineNumber: 1,
      startColumn: 5,
      endLineNumber: 1,
      endColumn: 11
    });
    // The lazily loaded python file became a model with the python language.
    expect(
      monaco.editor.getModel(monaco.Uri.parse('file:///proj/utils.py'))?.getLanguageId()
    ).toBe('python');
    expect(loadFile).toHaveBeenCalledTimes(1);
  });

  it('returns null for unknown languages', async () => {
    const monaco = new FakeMonaco();
    const model = monaco.addModel('file:///proj/x.rb', 'def x; end\n', 'ruby');
    const provider = new DefinitionProvider(monaco);

    expect(await provider.provideDefinition(model, { lineNumber: 1, column: 5 })).toBeNull();
  });

  it('invokes fallbackNavigation when python resolution fails', async () => {
    const monaco = new FakeMonaco();
    const model = monaco.addModel('file:///proj/main.py', 'mystery_symbol\n', 'python');
    const fallbackNavigation = vi.fn(async () => ({
      uri: 'file:///external/found.py',
      range: { startLineNumber: 7, startColumn: 1, endLineNumber: 7, endColumn: 5 }
    }));
    const provider = new DefinitionProvider(monaco, { fallbackNavigation });

    const result = await provider.provideDefinition(model, { lineNumber: 1, column: 3 });

    expect(fallbackNavigation).toHaveBeenCalledWith({
      symbolName: 'mystery_symbol',
      fromUri: 'file:///proj/main.py'
    });
    expect(result![0].uri.toString()).toBe('file:///external/found.py');
  });

  it('does not invoke fallbackNavigation for ts/js (built-in provider owns those)', async () => {
    const monaco = new FakeMonaco();
    const model = monaco.addModel('file:///proj/a.ts', 'const x = 1;\n', 'typescript');
    const fallbackNavigation = vi.fn(async () => null);
    const provider = new DefinitionProvider(monaco, { fallbackNavigation });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await provider.provideDefinition(model, { lineNumber: 1, column: 7 });
    expect(fallbackNavigation).not.toHaveBeenCalled();
  });

  it('returns null when cancellation is requested', async () => {
    const monaco = new FakeMonaco();
    const model = monaco.addModel('file:///proj/main.py', 'x = 1\nx\n', 'python');
    const provider = new DefinitionProvider(monaco);

    const result = await provider.provideDefinition(
      model,
      { lineNumber: 2, column: 1 },
      { isCancellationRequested: true }
    );
    expect(result).toBeNull();
  });

  it('supports custom analyzers', async () => {
    const monaco = new FakeMonaco();
    const model = monaco.addModel('file:///proj/x.custom', 'anything\n', 'customlang');
    const provider = new DefinitionProvider(monaco);
    provider.registerAnalyzer('customlang', {
      provideDefinition: async doc => [
        {
          uri: doc.uri,
          range: { startLineNumber: 9, startColumn: 9, endLineNumber: 9, endColumn: 10 }
        }
      ]
    });

    const result = await provider.provideDefinition(model, { lineNumber: 1, column: 1 });
    expect(result![0].range.startLineNumber).toBe(9);
  });

  it('createDefinitionProvider registers all languages', () => {
    const monaco = new FakeMonaco();
    const provider = createDefinitionProvider(monaco, ['python', 'typescript', 'javascript']);
    expect(monaco.registeredProviders.map(r => r.languageId)).toEqual([
      'python',
      'typescript',
      'javascript'
    ]);
    provider.dispose();
  });
});
