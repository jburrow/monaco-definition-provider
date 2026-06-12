import { describe, it, expect, vi } from 'vitest';
import { WorkspaceIndex } from '../workspace/WorkspaceIndex';
import { FakeMonaco } from './helpers/fakeMonaco';

describe('WorkspaceIndex', () => {
  it('exposes open models as documents', () => {
    const monaco = new FakeMonaco();
    monaco.addModel('file:///proj/a.py', 'x = 1\n', 'python');
    const index = new WorkspaceIndex(monaco);

    expect(index.getDocument('file:///proj/a.py')?.getValue()).toBe('x = 1\n');
    expect(index.getDocument('file:///proj/missing.py')).toBeNull();
  });

  it('tracks models created after construction', () => {
    const monaco = new FakeMonaco();
    const index = new WorkspaceIndex(monaco);
    monaco.addModel('file:///proj/late.py', 'y = 2\n', 'python');

    expect(index.getDocument('file:///proj/late.py')?.getValue()).toBe('y = 2\n');
  });

  it('forgets disposed models', () => {
    const monaco = new FakeMonaco();
    const model = monaco.addModel('file:///proj/a.py', 'x = 1\n', 'python');
    const index = new WorkspaceIndex(monaco);

    model.dispose();
    expect(index.getDocument('file:///proj/a.py')).toBeNull();
  });

  it('resolves relative imports against open models without calling loadFile', async () => {
    const monaco = new FakeMonaco();
    monaco.addModel('file:///proj/pkg/utils.py', 'def helper(): pass\n', 'python');
    const loadFile = vi.fn();
    const index = new WorkspaceIndex(monaco, { loadFile });

    const doc = await index.resolveImport('.utils', 'file:///proj/pkg/main.py');
    expect(doc?.uri).toBe('file:///proj/pkg/utils.py');
    expect(loadFile).not.toHaveBeenCalled();
  });

  it('falls back to loadFile and creates a model from the result', async () => {
    const monaco = new FakeMonaco();
    const loadFile = vi.fn(async (uri: string) =>
      uri === 'file:///proj/pkg/utils.py' ? { uri, content: 'def helper(): pass\n' } : null
    );
    const index = new WorkspaceIndex(monaco, { loadFile, defaultLanguageId: 'python' });

    const doc = await index.resolveImport('.utils', 'file:///proj/pkg/main.py');
    expect(doc?.uri).toBe('file:///proj/pkg/utils.py');
    expect(doc?.getValue()).toBe('def helper(): pass\n');

    // The loaded file became a real model...
    const model = monaco.editor.getModel(monaco.Uri.parse('file:///proj/pkg/utils.py'));
    expect(model?.getLanguageId()).toBe('python');

    // ...so a second resolve hits the model, not the hook.
    await index.resolveImport('.utils', 'file:///proj/pkg/main.py');
    expect(loadFile).toHaveBeenCalledTimes(1);
  });

  it('tries loadFile candidates in priority order', async () => {
    const monaco = new FakeMonaco();
    const attempted: string[] = [];
    const loadFile = vi.fn(async (uri: string) => {
      attempted.push(uri);
      return uri.endsWith('__init__.py') ? { uri, content: '' } : null;
    });
    const index = new WorkspaceIndex(monaco, { loadFile });

    const doc = await index.resolveImport('.utils', 'file:///proj/pkg/main.py');
    expect(doc?.uri).toBe('file:///proj/pkg/utils/__init__.py');
    expect(attempted).toEqual([
      'file:///proj/pkg/utils.py',
      'file:///proj/pkg/utils/__init__.py'
    ]);
  });

  it('de-duplicates concurrent loads of the same uri', async () => {
    const monaco = new FakeMonaco();
    let resolveLoad!: (value: { uri: string; content: string }) => void;
    const loadFile = vi.fn(
      () => new Promise<{ uri: string; content: string }>(resolve => (resolveLoad = resolve))
    );
    const index = new WorkspaceIndex(monaco, { loadFile });

    const first = index.resolveImport('.utils', 'file:///proj/pkg/main.py');
    const second = index.resolveImport('.utils', 'file:///proj/pkg/main.py');
    await vi.waitFor(() => expect(loadFile).toHaveBeenCalled());
    resolveLoad({ uri: 'file:///proj/pkg/utils.py', content: 'x = 1\n' });

    const [a, b] = await Promise.all([first, second]);
    expect(a?.uri).toBe('file:///proj/pkg/utils.py');
    expect(b?.uri).toBe('file:///proj/pkg/utils.py');
    expect(loadFile).toHaveBeenCalledTimes(1);
  });

  it('prefers the resolveModuleUri hook over built-in heuristics', async () => {
    const monaco = new FakeMonaco();
    monaco.addModel('file:///elsewhere/special.py', 'x = 1\n', 'python');
    const index = new WorkspaceIndex(monaco, {
      resolveModuleUri: importPath =>
        importPath === 'special' ? 'file:///elsewhere/special.py' : null
    });

    const doc = await index.resolveImport('special', 'file:///proj/main.py');
    expect(doc?.uri).toBe('file:///elsewhere/special.py');
  });

  it('resolves absolute imports against the common root of open python models', async () => {
    const monaco = new FakeMonaco();
    monaco.addModel('file:///proj/main.py', 'import pkg.utils\n', 'python');
    monaco.addModel('file:///proj/pkg/utils.py', 'def helper(): pass\n', 'python');
    const index = new WorkspaceIndex(monaco);

    const doc = await index.resolveImport('pkg.utils', 'file:///proj/main.py');
    expect(doc?.uri).toBe('file:///proj/pkg/utils.py');
  });

  it('survives a throwing loadFile hook', async () => {
    const monaco = new FakeMonaco();
    const index = new WorkspaceIndex(monaco, {
      loadFile: async () => {
        throw new Error('network down');
      }
    });

    const doc = await index.resolveImport('.utils', 'file:///proj/pkg/main.py');
    expect(doc).toBeNull();
  });

  it('stops tracking after dispose', async () => {
    const monaco = new FakeMonaco();
    const index = new WorkspaceIndex(monaco);
    index.dispose();
    monaco.addModel('file:///proj/late.py', 'x = 1\n', 'python');

    expect(index.getDocument('file:///proj/late.py')).toBeNull();
  });
});
