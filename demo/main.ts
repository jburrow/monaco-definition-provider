import * as monaco from 'monaco-editor';
import { DefinitionProvider, configureTypeScriptDefaults } from '../src/index';
import grammarWasmUrl from 'tree-sitter-python/tree-sitter-python.wasm?url';
import runtimeWasmUrl from 'web-tree-sitter/web-tree-sitter.wasm?url';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

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

// ----- Simulated server: files that exist but are NOT open as models -----
const serverFiles: Record<string, string> = {
  'file:///workspace/utils.py': [
    '"""Utility helpers (lazily loaded)."""',
    '',
    'CONSTANT = 42',
    '',
    '',
    'def helper(x):',
    '    """Multiply by the magic constant."""',
    '    return x * CONSTANT',
    ''
  ].join('\n'),
  'file:///workspace/helpers.ts': [
    'export interface User {',
    '  id: number;',
    '  name: string;',
    '}',
    '',
    'export function formatUser(user: User): string {',
    '  return `#${user.id} ${user.name}`;',
    '}',
    ''
  ].join('\n')
};

async function fetchFromServer(uri: string): Promise<string | null> {
  // Simulate network latency.
  await new Promise(resolve => setTimeout(resolve, 300));
  return serverFiles[uri] ?? null;
}

// ----- Open files -----
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

const typescriptCode = [
  '// app.ts — Ctrl+Click symbols to navigate',
  "import { formatUser, User } from './helpers';",
  '',
  'const alice: User = { id: 1, name: "Alice" };',
  '',
  '// helpers.ts is not open — the first jump lazy-loads it.',
  'console.log(formatUser(alice));',
  ''
].join('\n');

const pythonModel = monaco.editor.createModel(
  pythonCode,
  'python',
  monaco.Uri.parse('file:///workspace/main.py')
);
const typescriptModel = monaco.editor.createModel(
  typescriptCode,
  'typescript',
  monaco.Uri.parse('file:///workspace/app.ts')
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
      log(`loadFile: ${uri} → not found on server`, 'load');
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
  fontSize: 14,
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
    filenameEl.textContent = resource.path.replace('/workspace/', '');
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

log('Definition provider ready — python (tree-sitter) + typescript (language service)', 'local');

// Exposed for debugging/driving the demo from the console.
(window as unknown as Record<string, unknown>).__demo = {
  monaco,
  provider,
  pythonEditor,
  typescriptEditor
};
