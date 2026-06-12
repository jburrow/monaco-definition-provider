import { Parser, Language } from 'web-tree-sitter';

export interface PythonParserOptions {
  /**
   * URL/path to tree-sitter-python.wasm, or the wasm bytes directly.
   * Defaults to `tree-sitter-python.wasm` next to the built library
   * (shipped in the package's dist), resolved via `import.meta.url`.
   */
  grammarWasm?: string | Uint8Array;
  /**
   * Emscripten `locateFile` for the core web-tree-sitter runtime wasm
   * (`web-tree-sitter.wasm`). Usually only needed when a bundler moves it.
   */
  locateFile?: (fileName: string, scriptDirectory: string) => string;
}

let languagePromise: Promise<Language> | null = null;

/**
 * Initialize the tree-sitter runtime and load the Python grammar.
 * The expensive work happens once; subsequent calls return the same promise.
 */
export function initPythonLanguage(options: PythonParserOptions = {}): Promise<Language> {
  if (!languagePromise) {
    languagePromise = (async () => {
      await Parser.init(options.locateFile ? { locateFile: options.locateFile } : undefined);
      const wasm = options.grammarWasm ?? defaultGrammarUrl();
      return Language.load(wasm as string | Uint8Array);
    })();
    // Allow retrying after a failed init (e.g. wrong wasm path on first attempt).
    languagePromise.catch(() => {
      languagePromise = null;
    });
  }
  return languagePromise;
}

/** Create a parser bound to the Python grammar. */
export async function createPythonParser(options: PythonParserOptions = {}): Promise<Parser> {
  const language = await initPythonLanguage(options);
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}

function defaultGrammarUrl(): string {
  try {
    return new URL('./tree-sitter-python.wasm', import.meta.url).toString();
  } catch {
    throw new Error(
      'monaco-definition-provider: could not resolve a default location for ' +
        'tree-sitter-python.wasm. Pass options.python.grammarWasm with a URL or bytes.'
    );
  }
}
