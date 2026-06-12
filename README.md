# Monaco Definition Provider

Scope-aware jump-to-definition for [Monaco Editor](https://microsoft.github.io/monaco-editor/), built for multi-file workspaces where files are loaded lazily.

- 🐍 **Python**: real parsing via [tree-sitter](https://tree-sitter.github.io/) — proper scope resolution (LEGB, `global`/`nonlocal`, class-scope rules, comprehensions, walrus), imports (relative, aliased, multi-line), and `module.symbol` navigation
- 📘 **TypeScript/JavaScript**: delegates to Monaco's built-in TypeScript language service (already scope-aware and multi-model) and adds the missing piece — loading not-yet-open files on demand
- 📂 **Lazy multi-file workspace**: open editor models are indexed automatically; a `loadFile` hook lets your app fetch any other file the moment a definition points into it
- 🔌 **Extensible**: register analyzers for additional languages

## Installation

```bash
pnpm add monaco-definition-provider
```

`monaco-editor` (>= 0.34) is a peer dependency.

## Quick start

```typescript
import * as monaco from 'monaco-editor';
import { DefinitionProvider } from 'monaco-definition-provider';

const provider = new DefinitionProvider(monaco, {
  // Called when a definition points at a file that has no Monaco model yet.
  // Return its content and the library creates the model and lands on the
  // exact symbol. Return null if the file doesn't exist.
  loadFile: async (uri, importPath, fromUri) => {
    const content = await myBackend.fetchFile(uri);
    return content === null ? null : { uri, content };
  }
});

provider.register('python');
provider.register('typescript');
provider.register('javascript');

monaco.editor.create(document.getElementById('editor')!, {
  value: 'def hello():\n    pass\n',
  language: 'python'
});
// Ctrl+Click / F12 now jumps to definitions, across files.
```

Note the first constructor argument: **you pass your own `monaco` namespace**. The library never imports `monaco-editor` itself, so there is no risk of a duplicate Monaco instance from bundling.

## What scope-aware means

Unlike text-matching approaches, navigation follows real Python scoping rules:

```python
from utils import helper, CONSTANT   # utils.py doesn't need to be open

value = 10

def scaled(factor):
    value = factor * 2
    return value          # → jumps to the local on the line above

def total():
    return value + CONSTANT   # value → line 3 (global); CONSTANT → utils.py, lazy-loaded

result = helper(value)    # helper → def helper in utils.py, exact position
print("helper here does nothing")   # strings and comments are never matched
```

`global`/`nonlocal`, comprehension scopes, walrus targets, `with … as`/`except … as`, tuple unpacking, and aliased/relative/multi-line imports all resolve correctly — see [the test suite](src/__tests__/python.test.ts) for the full behavior matrix.

## Opening cross-file results

A standalone Monaco editor cannot open a different file by itself — when a definition lands in another model, you decide how to show it (switch the model, open a tab, split view, …) by registering an editor opener:

```typescript
monaco.editor.registerEditorOpener({
  openCodeEditor(sourceEditor, resource, selectionOrPosition) {
    const model = monaco.editor.getModel(resource);
    if (!model) return false;

    editor.setModel(model); // or open your app's tab for `resource`
    if (selectionOrPosition && 'startLineNumber' in selectionOrPosition) {
      editor.setSelection(selectionOrPosition);
      editor.revealRangeInCenter(selectionOrPosition);
    }
    editor.focus();
    return true;
  }
});
```

Without this, same-file jumps work but cross-file jumps silently do nothing. See [demo/main.ts](demo/main.ts) for a complete working example with two editor panes and a simulated file server.

## Serving the WASM files

The Python analyzer needs two WebAssembly files at runtime:

1. `tree-sitter-python.wasm` — shipped in this package (`monaco-definition-provider/tree-sitter-python.wasm`)
2. `web-tree-sitter.wasm` — shipped in the `web-tree-sitter` package

With **Vite**:

```typescript
import grammarUrl from 'monaco-definition-provider/tree-sitter-python.wasm?url';
import runtimeUrl from 'web-tree-sitter/web-tree-sitter.wasm?url';

const provider = new DefinitionProvider(monaco, {
  python: {
    grammarWasm: grammarUrl,
    locateFile: () => runtimeUrl
  }
});
```

With **webpack 5** (asset modules):

```typescript
const grammarUrl = new URL(
  'monaco-definition-provider/tree-sitter-python.wasm',
  import.meta.url
).toString();
```

If you serve the files from a static directory instead, pass their URLs the same way. When `python.grammarWasm` is omitted, the library tries `new URL('./tree-sitter-python.wasm', import.meta.url)` — which works when your bundler keeps the wasm next to the built module.

## How TypeScript/JavaScript works

Monaco's TypeScript language service already provides excellent go-to-definition across open models — this library does not replace it. Its TS strategy only contributes when the built-in provider comes up empty because the target file isn't open: it extracts the import specifier, asks your `loadFile` hook for the file, creates the model, and re-queries the language service for the precise location.

For multi-model TS navigation to work, the language service needs Node-style module resolution. If your app doesn't configure this already:

```typescript
import { configureTypeScriptDefaults } from 'monaco-definition-provider';
configureTypeScriptDefaults(monaco); // allowJs, NodeJs moduleResolution, eager model sync
```

If you prefer this library to be the *only* definition provider for TS/JS, disable the built-in one:

```typescript
monaco.languages.typescript.typescriptDefaults.setModeConfiguration({ definitions: false });
```

## Options

```typescript
interface DefinitionProviderOptions {
  /** Fetch a file the library believes exists but has no model for. */
  loadFile?: (uri, importPath, fromUri) => Promise<{ uri; content; languageId? } | null>;

  /** Override import-specifier → URI mapping (monorepos, custom layouts, bare specifiers). */
  resolveModuleUri?: (importPath, fromUri) => string | string[] | null | Promise<...>;

  /** Escape hatch when all built-in resolution failed (non-TS languages). */
  fallbackNavigation?: (ctx: { symbolName; importPath?; fromUri }) => Promise<DefinitionLocation | null>;

  python?: {
    grammarWasm?: string | Uint8Array; // URL or bytes of tree-sitter-python.wasm
    locateFile?: (fileName, scriptDirectory) => string; // for web-tree-sitter.wasm
  };

  typescript?: {
    ignoreLibFiles?: boolean; // skip results inside lib.*.d.ts (default true)
  };
}
```

### Import resolution defaults

- Python relative imports (`from .utils import x`, `from ..pkg import y`) resolve against the importing file's URI — candidates are `<dir>/utils.py` then `<dir>/utils/__init__.py`.
- Python absolute imports (`import pkg.mod`) resolve against the longest common directory of open Python models. For anything smarter, supply `resolveModuleUri`.
- TS/JS relative specifiers expand to the usual extension/index candidates; bare specifiers (packages, path aliases) are only resolved through `resolveModuleUri`.

## Custom language analyzers

```typescript
import type { LanguageAnalyzer } from 'monaco-definition-provider';

const myAnalyzer: LanguageAnalyzer = {
  async provideDefinition(doc, position, workspace) {
    // doc.uri, doc.getValue(); workspace.getDocument / workspace.resolveImport
    return [{ uri: doc.uri, range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 } }];
  }
};

provider.registerAnalyzer('mylang', myAnalyzer);
provider.register('mylang');
```

## Migrating from v1

v2 is a rewrite with a clean API break:

| v1 | v2 |
| --- | --- |
| `new DefinitionProvider(options)` | `new DefinitionProvider(monaco, options)` — pass your monaco namespace |
| `onExternalNavigation(symbol, importPath, uri)` | `loadFile` (preferred — return file *content*, get exact positions for free) or `fallbackNavigation` (return a location yourself) |
| `createDefinitionProvider(languages, options)` | `createDefinitionProvider(monaco, languages, options)` |
| `includeBuiltins` option | removed (was never implemented) |
| Regex analyzers, `findDefinitions`/`getSymbolAtPosition` | tree-sitter (Python) and the TS language service; `LanguageAnalyzer` is now a single async `provideDefinition` |

## Limitations

- Python `obj.attr` navigation works when `obj` is an imported module; there is no type inference for arbitrary object attributes.
- Python wildcard imports (`from m import *`) are not followed.
- TS/JS quality matches Monaco's TypeScript service — this library only adds lazy file loading on top.

## Demo

```bash
pnpm install
pnpm dev     # http://localhost:3000
```

The demo ([demo/main.ts](demo/main.ts)) shows two editor panes (Python and TypeScript) backed by a simulated file server: `utils.py` and `helpers.ts` are *not* open — the first Ctrl+Click into them fetches the file with artificial latency, creates the model, and lands on the exact symbol. A navigation log shows every `loadFile` call.

## Development

```bash
pnpm install
pnpm test    # vitest (runs real tree-sitter parsing under Node)
pnpm lint    # tsc --noEmit
pnpm build   # tsup → dist (ESM + CJS + d.ts + wasm)
```

## License

MIT
