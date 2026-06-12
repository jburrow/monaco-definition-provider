import { describe, it, expect, beforeAll } from 'vitest';
import { PythonAnalyzer } from '../analyzers/python/PythonAnalyzer';
import { testPythonParser } from './helpers/pythonTestParser';
import type { DefinitionLocation, WorkspaceAccess, WorkspaceDocument } from '../types';
import { resolvePythonImport } from '../workspace/moduleResolver';

/**
 * In-memory workspace over a map of uri → source. Resolves python imports
 * with the real moduleResolver against a fixed root.
 */
class FakeWorkspace implements WorkspaceAccess {
  constructor(
    private readonly files: Record<string, string>,
    private readonly root = 'file:///proj'
  ) {}

  getDocument(uri: string): WorkspaceDocument | null {
    const content = this.files[uri];
    return content === undefined ? null : { uri, getValue: () => content };
  }

  async resolveImport(importPath: string, fromUri: string): Promise<WorkspaceDocument | null> {
    for (const candidate of resolvePythonImport(importPath, fromUri, [this.root])) {
      const doc = this.getDocument(candidate);
      if (doc) return doc;
    }
    return null;
  }
}

const EMPTY_WORKSPACE = new FakeWorkspace({});

let analyzer: PythonAnalyzer;

beforeAll(async () => {
  // Initialize the shared tree-sitter language with Node-friendly wasm paths
  // before the analyzer's lazy init runs with browser defaults.
  await testPythonParser();
  analyzer = new PythonAnalyzer();
});

/** Find `needle`'s position (1-based, at offset within the match) in source. */
function positionOf(source: string, needle: string, occurrence = 1): { lineNumber: number; column: number } {
  let index = -1;
  for (let i = 0; i < occurrence; i++) {
    index = source.indexOf(needle, index + 1);
    if (index === -1) throw new Error(`needle not found: ${needle}`);
  }
  const before = source.substring(0, index);
  const lines = before.split('\n');
  return { lineNumber: lines.length, column: lines[lines.length - 1].length + 1 };
}

async function definitionAt(
  source: string,
  needle: string,
  occurrence = 1,
  workspace: WorkspaceAccess = EMPTY_WORKSPACE,
  uri = 'file:///proj/main.py'
): Promise<DefinitionLocation[] | null> {
  const doc = { uri, getValue: () => source };
  return analyzer.provideDefinition(doc, positionOf(source, needle, occurrence), workspace);
}

describe('PythonAnalyzer — same-document scope resolution', () => {
  it('resolves a function reference to its definition', async () => {
    const source = 'def greet(name):\n    return name\n\nmessage = greet("World")\n';
    const result = await definitionAt(source, 'greet', 2);
    expect(result).toEqual([
      {
        uri: 'file:///proj/main.py',
        range: { startLineNumber: 1, startColumn: 5, endLineNumber: 1, endColumn: 10 }
      }
    ]);
  });

  it('resolves a local variable to the local, not a same-named global', async () => {
    const source = 'value = 1\n\ndef f():\n    value = 2\n    return value\n';
    const result = await definitionAt(source, 'value', 3);
    expect(result![0].range.startLineNumber).toBe(4);
  });

  it('resolves parameters', async () => {
    const source = 'def f(count, *args, scale=2, **kwargs):\n    return count * scale + len(args) + len(kwargs)\n';
    expect((await definitionAt(source, 'count', 2))![0].range).toMatchObject({
      startLineNumber: 1,
      startColumn: 7
    });
    expect((await definitionAt(source, 'scale', 2))![0].range.startColumn).toBe(21);
    // occurrence 3: "args" also appears inside "**kwargs"
    expect((await definitionAt(source, 'args', 3))![0].range.startColumn).toBe(15);
    expect((await definitionAt(source, 'kwargs', 2))![0].range.startColumn).toBe(32);
  });

  it('resolves typed parameters', async () => {
    const source = 'def f(count: int, scale: float = 1.0):\n    return count * scale\n';
    expect((await definitionAt(source, 'count', 2))![0].range.startColumn).toBe(7);
    expect((await definitionAt(source, 'scale', 2))![0].range.startColumn).toBe(19);
  });

  it('honors shadowing across nested functions', async () => {
    const source = [
      'x = 1',
      'def outer():',
      '    x = 2',
      '    def inner():',
      '        return x',
      '    return inner',
      ''
    ].join('\n');
    const result = await definitionAt(source, 'x', 3);
    expect(result![0].range.startLineNumber).toBe(3);
  });

  it('skips class scopes when resolving from methods', async () => {
    const source = [
      'size = 10',
      'class C:',
      '    size = 20',
      '    def method(self):',
      '        return size',
      ''
    ].join('\n');
    // Python semantics: `size` inside the method sees the module global, not the class attribute.
    const result = await definitionAt(source, 'size', 3);
    expect(result![0].range.startLineNumber).toBe(1);
  });

  it('sees class-level names from directly inside the class body', async () => {
    const source = 'class C:\n    base = 1\n    derived = base + 1\n';
    const result = await definitionAt(source, 'base', 2);
    expect(result![0].range.startLineNumber).toBe(2);
  });

  it('honors global statements', async () => {
    const source = ['counter = 0', 'def bump():', '    global counter', '    counter = counter + 1', ''].join('\n');
    // The read on line 4 must resolve to the module-level binding on line 1.
    const result = await definitionAt(source, 'counter', 4);
    expect(result![0].range.startLineNumber).toBe(1);
  });

  it('honors nonlocal statements', async () => {
    const source = [
      'def outer():',
      '    total = 0',
      '    def inner():',
      '        nonlocal total',
      '        total = total + 1',
      '    return inner',
      ''
    ].join('\n');
    const result = await definitionAt(source, 'total', 4);
    expect(result![0].range.startLineNumber).toBe(2);
  });

  it('prefers the last binding before the reference', async () => {
    const source = 'x = 1\nx = 2\nprint(x)\n';
    const result = await definitionAt(source, 'x', 3);
    expect(result![0].range.startLineNumber).toBe(2);
  });

  it('supports forward references to later definitions', async () => {
    const source = 'def main():\n    helper()\n\ndef helper():\n    pass\n';
    const result = await definitionAt(source, 'helper', 1);
    expect(result![0].range.startLineNumber).toBe(4);
  });

  it('binds comprehension variables in the comprehension scope only', async () => {
    const source = 'item = "outer"\nsquares = [item * item for item in range(10)]\nprint(item)\n';
    // `item` inside the comprehension resolves to the comprehension target...
    const inside = await definitionAt(source, 'item', 2);
    expect(inside![0].range.startLineNumber).toBe(2);
    expect(inside![0].range.startColumn).toBe(28);
    // ...but `item` after it still resolves to the module-level binding.
    const outside = await definitionAt(source, 'item', 5);
    expect(outside![0].range.startLineNumber).toBe(1);
  });

  it('binds walrus targets in the enclosing scope', async () => {
    const source = 'data = [1, 2, 3]\nif (n := len(data)) > 2:\n    print(n)\n';
    const result = await definitionAt(source, 'n)', 1);
    expect(result![0].range).toMatchObject({ startLineNumber: 2, startColumn: 5 });
  });

  it('resolves for-loop targets and with/except aliases', async () => {
    const source = [
      'for row in range(3):',
      '    print(row)',
      'with open("f") as handle:',
      '    handle.read()',
      'try:',
      '    pass',
      'except ValueError as err:',
      '    print(err)',
      ''
    ].join('\n');
    expect((await definitionAt(source, 'row', 2))![0].range.startLineNumber).toBe(1);
    expect((await definitionAt(source, 'handle', 2))![0].range.startLineNumber).toBe(3);
    expect((await definitionAt(source, 'err', 2))![0].range.startLineNumber).toBe(7);
  });

  it('resolves tuple-unpacking targets', async () => {
    const source = 'first, second = 1, 2\nprint(second)\n';
    const result = await definitionAt(source, 'second', 2);
    expect(result![0].range).toMatchObject({ startLineNumber: 1, startColumn: 8 });
  });

  it('returns null for unknown names and keywords', async () => {
    const source = 'def f():\n    return undefined_name\n';
    expect(await definitionAt(source, 'undefined_name')).toBeNull();
    expect(await definitionAt(source, 'def')).toBeNull();
  });

  it('does not resolve names inside strings or comments', async () => {
    const source = 'target = 1\ns = "target"\n# target in a comment\n';
    expect(await definitionAt(source, 'target', 2)).toBeNull();
    expect(await definitionAt(source, 'target', 3)).toBeNull();
  });
});

describe('PythonAnalyzer — cross-file imports', () => {
  const utils = 'def helper(x):\n    return x\n\nCONSTANT = 42\n';
  const pkgInit = 'from .utils import helper\n';

  const workspace = new FakeWorkspace({
    'file:///proj/utils.py': utils,
    'file:///proj/pkg/__init__.py': pkgInit,
    'file:///proj/pkg/utils.py': utils,
    'file:///proj/pkg/sibling.py': 'value = 1\n'
  });

  it('resolves `from utils import helper` usage to the precise symbol', async () => {
    const source = 'from utils import helper\n\nresult = helper(1)\n';
    const result = await definitionAt(source, 'helper', 2, workspace);
    expect(result).toEqual([
      {
        uri: 'file:///proj/utils.py',
        range: { startLineNumber: 1, startColumn: 5, endLineNumber: 1, endColumn: 11 }
      }
    ]);
  });

  it('resolves aliased imports through the alias', async () => {
    const source = 'from utils import helper as h\n\nresult = h(1)\n';
    const result = await definitionAt(source, 'h(1)', 1, workspace);
    expect(result![0].uri).toBe('file:///proj/utils.py');
    expect(result![0].range.startColumn).toBe(5);
  });

  it('resolves multi-line parenthesized imports', async () => {
    const source = 'from utils import (\n    helper,\n    CONSTANT,\n)\n\nprint(CONSTANT)\n';
    const result = await definitionAt(source, 'CONSTANT', 2, workspace);
    expect(result![0].uri).toBe('file:///proj/utils.py');
    expect(result![0].range.startLineNumber).toBe(4);
  });

  it('resolves relative imports', async () => {
    const source = 'from .utils import helper\n\nhelper(1)\n';
    const result = await definitionAt(source, 'helper', 2, workspace, 'file:///proj/pkg/main.py');
    expect(result![0].uri).toBe('file:///proj/pkg/utils.py');
  });

  it('resolves `from . import sibling` to the sibling module file', async () => {
    const source = 'from . import sibling\n\nsibling.value\n';
    const result = await definitionAt(source, 'sibling', 2, workspace, 'file:///proj/pkg/main.py');
    expect(result![0].uri).toBe('file:///proj/pkg/sibling.py');
  });

  it('resolves `import pkg` usage to the package __init__', async () => {
    const source = 'import pkg\n\npkg\n';
    const result = await definitionAt(source, 'pkg', 2, workspace);
    expect(result![0].uri).toBe('file:///proj/pkg/__init__.py');
  });

  it('resolves mod.symbol attribute access into the module', async () => {
    const source = 'import utils\n\nutils.helper(1)\n';
    const result = await definitionAt(source, 'helper', 1, workspace);
    expect(result![0].uri).toBe('file:///proj/utils.py');
    expect(result![0].range.startColumn).toBe(5);
  });

  it('navigates from the import statement itself', async () => {
    const source = 'from utils import helper\n';
    // Click on the module name.
    const onModule = await definitionAt(source, 'utils', 1, workspace);
    expect(onModule![0]).toMatchObject({ uri: 'file:///proj/utils.py' });
    // Click on the imported symbol.
    const onSymbol = await definitionAt(source, 'helper', 1, workspace);
    expect(onSymbol![0].range.startColumn).toBe(5);
  });

  it('returns null when the module cannot be resolved', async () => {
    const source = 'from missing import thing\n\nthing()\n';
    expect(await definitionAt(source, 'thing', 2, workspace)).toBeNull();
  });

  it('falls back to the module file when the symbol is not found in it', async () => {
    const source = 'from utils import reexported\n\nreexported()\n';
    const result = await definitionAt(source, 'reexported', 2, workspace);
    expect(result![0]).toMatchObject({
      uri: 'file:///proj/utils.py',
      range: { startLineNumber: 1, startColumn: 1 }
    });
  });
});
