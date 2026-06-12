import * as monaco from 'monaco-editor';
import { DefinitionProvider, configureTypeScriptDefaults } from '../src/index';
import grammarWasmUrl from 'tree-sitter-python/tree-sitter-python.wasm?url';
import runtimeWasmUrl from 'web-tree-sitter/web-tree-sitter.wasm?url';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
// The TypeScript pane navigates this library's own source. Only the entry
// file is loaded eagerly — every other module is fetched on first jump.
import indexSource from '../src/index.ts?raw';

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case 'typescript':
      case 'javascript':
        return new TsWorker();
      default:
        return new EditorWorker();
    }
  }
};

type LogType = 'local' | 'load' | 'open';

function log(message: string, type: LogType = 'local') {
  const logContent = document.getElementById('log-content')!;
  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logContent.insertBefore(entry, logContent.firstChild);
}

// ----- The "server": this project's real source, fetched lazily -----
// import.meta.glob gives one dynamic import per file; in the built site each
// loadFile call is a genuine network request for that source file.
const projectSources = import.meta.glob(['../src/**/*.ts', '!../src/__tests__/**'], {
  query: '?raw',
  import: 'default'
}) as Record<string, () => Promise<string>>;

const PROJECT_ROOT = 'file:///project/';

function uriToGlobKey(uri: string): string | null {
  if (!uri.startsWith(PROJECT_ROOT)) return null;
  return `../${uri.slice(PROJECT_ROOT.length)}`;
}

// Python has no project source to navigate (this library is TypeScript), so
// the python pane serves a sample exercising the scope-aware features.
const pythonServerFiles: Record<string, string> = {
  'file:///project/python/utils.py': [
    '"""Utility helpers (lazily loaded)."""',
    '',
    'CONSTANT = 42',
    '',
    '',
    'def helper(x):',
    '    """Multiply by the magic constant."""',
    '    return x * CONSTANT',
    ''
  ].join('\n')
};

async function fetchFromServer(uri: string): Promise<string | null> {
  // Real project source — a real dynamic import (network fetch when built).
  const globKey = uriToGlobKey(uri);
  if (globKey && projectSources[globKey]) {
    return projectSources[globKey]();
  }
  // Python sample files get simulated latency.
  if (uri in pythonServerFiles) {
    await new Promise(resolve => setTimeout(resolve, 300));
    return pythonServerFiles[uri];
  }
  return null;
}

const pythonCode = [
  '# main.py — Ctrl+Click symbols to navigate',
  'from utils import helper, CONSTANT',
  '',
  'value = 10  # module-level',
  '',
  '',
  'def scaled(factor):',
  '    value = factor * 2  # local shadows the global',
  '    return value        # jumps to line above, not line 4',
  '',
  '',
  'def total():',
  '    return value + CONSTANT  # global `value`; CONSTANT is lazy-loaded',
  '',
  '',
  'result = helper(value)  # helper() lives in utils.py — not open yet!',
  'print("helper in a string does nothing")',
  ''
].join('\n');

const pythonModel = monaco.editor.createModel(
  pythonCode,
  'python',
  monaco.Uri.parse('file:///project/python/main.py')
);
const typescriptModel = monaco.editor.createModel(
  indexSource,
  'typescript',
  monaco.Uri.parse('file:///project/src/index.ts')
);

// ----- Provider setup -----
configureTypeScriptDefaults(monaco);

const provider = new DefinitionProvider(monaco, {
  python: {
    grammarWasm: grammarWasmUrl,
    locateFile: () => runtimeWasmUrl
  },
  loadFile: async (uri, importPath, fromUri) => {
    log(`loadFile: ${uri} (import "${importPath}" in ${fromUri})`, 'load');
    const content = await fetchFromServer(uri);
    if (content === null) {
      log(`loadFile: ${uri} → not found`, 'load');
      return null;
    }
    log(`loadFile: ${uri} → loaded, model created`, 'load');
    return { uri, content };
  }
});

provider.register('python');
provider.register('typescript');
provider.register('javascript');

// ----- Editors -----
const editorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
  theme: 'vs-dark',
  minimap: { enabled: false },
  fontSize: 13,
  automaticLayout: true
};
const pythonEditor = monaco.editor.create(document.getElementById('python-editor')!, {
  ...editorOptions,
  model: pythonModel
});
const typescriptEditor = monaco.editor.create(document.getElementById('typescript-editor')!, {
  ...editorOptions,
  model: typescriptModel
});

// Route cross-model navigation into the matching editor pane.
monaco.editor.registerEditorOpener({
  openCodeEditor(_sourceEditor, resource, selectionOrPosition) {
    const model = monaco.editor.getModel(resource);
    if (!model) return false;

    const isPython = model.getLanguageId() === 'python';
    const editor = isPython ? pythonEditor : typescriptEditor;
    const filenameEl = document.getElementById(isPython ? 'python-filename' : 'typescript-filename')!;

    editor.setModel(model);
    filenameEl.textContent = resource.path.replace('/project/', '');
    if (selectionOrPosition) {
      const range: monaco.IRange =
        'startLineNumber' in selectionOrPosition
          ? selectionOrPosition
          : {
              startLineNumber: selectionOrPosition.lineNumber,
              startColumn: selectionOrPosition.column,
              endLineNumber: selectionOrPosition.lineNumber,
              endColumn: selectionOrPosition.column
            };
      editor.setSelection(range);
      editor.revealRangeInCenter(range);
    }
    editor.focus();
    log(`opened ${resource.toString()}`, 'open');
    return true;
  }
});

log('Definition provider ready — navigate this library’s own source in the TypeScript pane', 'local');

// Exposed for debugging/driving the demo from the console.
(window as unknown as Record<string, unknown>).__demo = {
  monaco,
  provider,
  pythonEditor,
  typescriptEditor
};
