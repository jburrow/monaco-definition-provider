# Integration Guide

This guide walks through adding `monaco-definition-provider` to an existing Monaco-based application — one that already has its own editor(s), a way of listing/opening files (tabs, a file tree), and a backend or virtual file system the files come from.

If you just want a working reference, [demo/main.ts](../demo/main.ts) is a complete two-pane app with a simulated file server. This guide covers the same wiring with the decisions you'll face in a real app.

## Overview

You will:

1. Pick a URI convention for your models (the foundation everything resolves against)
2. Serve the two wasm files the Python analyzer needs
3. Create the provider and wire `loadFile` to your backend
4. Register the languages
5. Route cross-file navigation into your tab/editor system
6. Configure the TypeScript language service (TS/JS only)
7. Handle custom project layouts (optional)
8. Clean up on teardown

## Step 1 — URI conventions

Every Monaco model needs a URI whose **path mirrors your project layout**, because import resolution is URI path math:

```typescript
// from .utils import helper      → file:///project/pkg/utils.py
// inside                          file:///project/pkg/main.py

monaco.editor.createModel(content, 'python', monaco.Uri.parse('file:///project/pkg/main.py'));
```

Rules of thumb:

- Use one scheme consistently (`file://` is conventional; `inmemory://` works too).
- The directory structure in the URI must match what the import statements imply. `from ..helpers import x` walks up one directory from the importing file's URI.
- Don't create models without an explicit URI (`createModel(content, lang)` generates `inmemory://model/1`, which can't participate in path-based resolution).
- Create models with the correct `languageId` (`'python'`, `'typescript'`, `'javascript'`) — the provider dispatches on it.

## Step 2 — Serve the wasm files

The Python analyzer needs two WebAssembly files at runtime:

| File | Ships in |
| --- | --- |
| `tree-sitter-python.wasm` | this package (`monaco-definition-provider/tree-sitter-python.wasm`) |
| `web-tree-sitter.wasm` | the `web-tree-sitter` package |

**Vite**

```typescript
import grammarWasmUrl from 'monaco-definition-provider/tree-sitter-python.wasm?url';
import runtimeWasmUrl from 'web-tree-sitter/web-tree-sitter.wasm?url';
```

**webpack 5** (asset modules)

```typescript
const grammarWasmUrl = new URL(
  'monaco-definition-provider/tree-sitter-python.wasm', import.meta.url).toString();
const runtimeWasmUrl = new URL(
  'web-tree-sitter/web-tree-sitter.wasm', import.meta.url).toString();
```

**Static hosting** — copy both files into your static assets at deploy time and pass their URLs as plain strings.

You'll pass both URLs to the provider in the next step. If they're wrong, the symptom is Python navigation silently doing nothing and a 404 in the network tab.

## Step 3 — Create the provider, wired to your backend

```typescript
import * as monaco from 'monaco-editor';
import { DefinitionProvider } from 'monaco-definition-provider';

const provider = new DefinitionProvider(monaco, {
  python: {
    grammarWasm: grammarWasmUrl,
    locateFile: () => runtimeWasmUrl
  },

  // Called when a definition points at a file with no model yet.
  // `uri` is a candidate the library computed from the import; map it to
  // your backend's path, fetch, and return the content — or null if the
  // file doesn't exist (the library then tries the next candidate).
  loadFile: async (uri, importPath, fromUri) => {
    const path = uri.replace('file:///project/', ''); // your URI ↔ backend mapping
    const content = await api.readFile(path);          // your backend call
    return content === null ? null : { uri, content };
  }
});
```

Notes on `loadFile`:

- The library creates a real Monaco model from what you return, so the file is "open" afterwards — register it with your tab system if you track open files (see Step 5, which fires when navigation lands there).
- Concurrent requests for the same URI are de-duplicated; a missing file may be probed more than once across separate navigations (e.g. `utils.py` then `utils/__init__.py`). If your backend calls are expensive, cache negatives in your hook.
- Returning a different `languageId` is supported; otherwise it's inferred (Python default for python-initiated loads, extension-based for TS).

## Step 4 — Register the languages

```typescript
provider.register('python');
provider.register('typescript');
provider.register('javascript');
```

Each call returns a disposable if you need to unregister one language independently; `provider.dispose()` tears everything down (Step 8).

## Step 5 — Route cross-file navigation into your UI

A standalone Monaco editor **cannot open another file by itself**. When a definition lands in a different model, Monaco asks your app to open it. Without this step, same-file jumps work and cross-file jumps silently do nothing — this is the most commonly missed piece.

```typescript
monaco.editor.registerEditorOpener({
  openCodeEditor(sourceEditor, resource, selectionOrPosition) {
    const model = monaco.editor.getModel(resource);
    if (!model) return false;

    // Integrate with YOUR app here: open/focus the tab for `resource`,
    // then point an editor at the model.
    myTabSystem.openTab(resource.toString());
    const editor = myTabSystem.activeEditor();
    editor.setModel(model);

    if (selectionOrPosition && 'startLineNumber' in selectionOrPosition) {
      editor.setSelection(selectionOrPosition);
      editor.revealRangeInCenter(selectionOrPosition);
    }
    editor.focus();
    return true; // handled
  }
});
```

Register this **once** per page, not per editor.

## Step 6 — TypeScript language service settings

TS/JS navigation is powered by Monaco's built-in TypeScript worker; this library only adds lazy file loading on top. The worker needs Node-style module resolution to connect models to each other:

```typescript
import { configureTypeScriptDefaults } from 'monaco-definition-provider';
configureTypeScriptDefaults(monaco); // allowJs, NodeJs moduleResolution, eager model sync
```

Skip this if your app already calls `typescriptDefaults.setCompilerOptions` — just make sure `moduleResolution` is set (value `2` = NodeJs) and `setEagerModelSync(true)` is on.

Also make sure your `MonacoEnvironment.getWorker` serves the **ts worker** for the `typescript`/`javascript` labels — without it the language service runs on the main thread or not at all. See [demo/main.ts](../demo/main.ts) for the Vite pattern.

If you want this library to be the *only* definition provider for TS/JS (instead of augmenting the built-in one):

```typescript
monaco.languages.typescript.typescriptDefaults.setModeConfiguration({ definitions: false });
```

## Step 7 — Custom layouts (optional)

The built-in resolution covers conventional layouts: Python relative imports against the importing file, Python absolute imports against the common root of open Python models, TS relative specifiers with the usual extension/index candidates. For anything else, supply `resolveModuleUri` — it wins over the heuristics whenever it returns a value:

```typescript
const provider = new DefinitionProvider(monaco, {
  resolveModuleUri: (importPath, fromUri) => {
    // TS path alias: @app/* → file:///project/libs/*
    if (importPath.startsWith('@app/')) {
      const rest = importPath.slice('@app/'.length);
      return [
        `file:///project/libs/${rest}.ts`,
        `file:///project/libs/${rest}/index.ts`
      ];
    }
    // Python src-root: absolute imports live under /project/src
    if (!importPath.startsWith('.') && fromUri.endsWith('.py')) {
      const rel = importPath.split('.').join('/');
      return [`file:///project/src/${rel}.py`, `file:///project/src/${rel}/__init__.py`];
    }
    return null; // fall back to built-in heuristics
  },
  loadFile: /* as in Step 3 */
});
```

There is also `fallbackNavigation` — a last-resort hook (non-TS languages) that receives `{ symbolName, fromUri }` when everything else failed and may return a location itself, e.g. to consult a server-side symbol index.

## Step 8 — Lifecycle

```typescript
provider.dispose();
```

This unregisters all Monaco registrations, stops model tracking, and frees the tree-sitter parser. Models created by `loadFile` are ordinary models owned by your app — dispose them the way you dispose any other model. Call `provider.dispose()` before tearing down Monaco itself.

## Minimal complete integration

A single-editor app, ~50 lines:

```typescript
import * as monaco from 'monaco-editor';
import { DefinitionProvider, configureTypeScriptDefaults } from 'monaco-definition-provider';
import grammarWasmUrl from 'monaco-definition-provider/tree-sitter-python.wasm?url';
import runtimeWasmUrl from 'web-tree-sitter/web-tree-sitter.wasm?url';

configureTypeScriptDefaults(monaco);

const provider = new DefinitionProvider(monaco, {
  python: { grammarWasm: grammarWasmUrl, locateFile: () => runtimeWasmUrl },
  loadFile: async uri => {
    const content = await api.readFile(uri.replace('file:///project/', ''));
    return content === null ? null : { uri, content };
  }
});
provider.register('python');
provider.register('typescript');
provider.register('javascript');

const editor = monaco.editor.create(container, {
  model: monaco.editor.createModel(initialCode, 'python', monaco.Uri.parse('file:///project/main.py'))
});

monaco.editor.registerEditorOpener({
  openCodeEditor(_source, resource, selectionOrPosition) {
    const model = monaco.editor.getModel(resource);
    if (!model) return false;
    editor.setModel(model);
    if (selectionOrPosition && 'startLineNumber' in selectionOrPosition) {
      editor.setSelection(selectionOrPosition);
      editor.revealRangeInCenter(selectionOrPosition);
    }
    editor.focus();
    return true;
  }
});
```

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Cross-file jump does nothing; same-file works | No `registerEditorOpener` (Step 5) |
| Python navigation does nothing at all | wasm 404 — check the network tab for both wasm files; verify `grammarWasm`/`locateFile` URLs |
| Python cross-file never resolves | Model URIs don't mirror the import structure (Step 1), or absolute imports need `resolveModuleUri` (Step 7) |
| TS/JS cross-file never resolves | ts worker not served by `MonacoEnvironment.getWorker`, or `moduleResolution` not set (Step 6) |
| Console warning "monaco.languages.typescript is unavailable" | Your monaco bundle excludes the TypeScript language contribution — import the full `monaco-editor` or include `typescript` in the languages of your monaco plugin |
| `loadFile` called for files that don't exist | Expected — the library probes candidates in priority order (e.g. `utils.py`, then `utils/__init__.py`). Return `null` quickly; cache negatives if calls are expensive |
| Jump lands at line 1 of the right file instead of the symbol | The symbol wasn't found at module level in the target (e.g. re-exported) — the file itself is the best-known location |
