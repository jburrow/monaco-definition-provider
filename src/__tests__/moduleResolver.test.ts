import { describe, it, expect } from 'vitest';
import {
  uriDirname,
  uriJoin,
  resolvePythonImport,
  resolveTsImport,
  commonRoot
} from '../workspace/moduleResolver';

describe('uriDirname', () => {
  it('strips the last segment', () => {
    expect(uriDirname('file:///workspace/app/main.py')).toBe('file:///workspace/app');
    expect(uriDirname('inmemory://model/pkg/mod.py')).toBe('inmemory://model/pkg');
  });

  it('ignores query and fragment', () => {
    expect(uriDirname('file:///a/b.py?x=1#frag')).toBe('file:///a');
  });
});

describe('uriJoin', () => {
  it('joins and normalizes segments', () => {
    expect(uriJoin('file:///a/b', 'c.py')).toBe('file:///a/b/c.py');
    expect(uriJoin('file:///a/b', '../c.py')).toBe('file:///a/c.py');
    expect(uriJoin('file:///a/b', './c/d.py')).toBe('file:///a/b/c/d.py');
  });

  it('never escapes past the authority', () => {
    expect(uriJoin('file:///a', '../../../b.py')).toBe('file:///b.py');
  });
});

describe('resolvePythonImport', () => {
  const fromUri = 'file:///proj/pkg/sub/mod.py';

  it('resolves single-dot relative imports against the current package', () => {
    expect(resolvePythonImport('.utils', fromUri)).toEqual([
      'file:///proj/pkg/sub/utils.py',
      'file:///proj/pkg/sub/utils/__init__.py'
    ]);
  });

  it('resolves multi-dot relative imports by walking up', () => {
    expect(resolvePythonImport('..helpers', fromUri)).toEqual([
      'file:///proj/pkg/helpers.py',
      'file:///proj/pkg/helpers/__init__.py'
    ]);
    expect(resolvePythonImport('...top', fromUri)).toEqual([
      'file:///proj/top.py',
      'file:///proj/top/__init__.py'
    ]);
  });

  it('resolves dotted remainders into nested paths', () => {
    expect(resolvePythonImport('..a.b', fromUri)).toEqual([
      'file:///proj/pkg/a/b.py',
      'file:///proj/pkg/a/b/__init__.py'
    ]);
  });

  it('resolves bare "." to the package __init__', () => {
    expect(resolvePythonImport('.', fromUri)).toEqual([
      'file:///proj/pkg/sub/__init__.py'
    ]);
  });

  it('resolves absolute imports against provided roots in order', () => {
    expect(resolvePythonImport('pkg.utils', fromUri, ['file:///proj', 'file:///other'])).toEqual([
      'file:///proj/pkg/utils.py',
      'file:///proj/pkg/utils/__init__.py',
      'file:///other/pkg/utils.py',
      'file:///other/pkg/utils/__init__.py'
    ]);
  });

  it('returns no candidates for absolute imports without roots', () => {
    expect(resolvePythonImport('os.path', fromUri)).toEqual([]);
  });
});

describe('resolveTsImport', () => {
  const fromUri = 'file:///proj/src/app.ts';

  it('returns [] for bare specifiers', () => {
    expect(resolveTsImport('lodash', fromUri)).toEqual([]);
    expect(resolveTsImport('@scope/pkg', fromUri)).toEqual([]);
  });

  it('expands extensionless relative specifiers', () => {
    const candidates = resolveTsImport('./util', fromUri);
    expect(candidates).toContain('file:///proj/src/util.ts');
    expect(candidates).toContain('file:///proj/src/util.tsx');
    expect(candidates).toContain('file:///proj/src/util/index.ts');
    // File candidates come before directory-index candidates.
    expect(candidates.indexOf('file:///proj/src/util.ts')).toBeLessThan(
      candidates.indexOf('file:///proj/src/util/index.ts')
    );
  });

  it('maps ESM-style .js specifiers back to .ts sources', () => {
    const candidates = resolveTsImport('../lib/x.js', fromUri);
    expect(candidates[0]).toBe('file:///proj/lib/x.js');
    expect(candidates).toContain('file:///proj/lib/x.ts');
  });
});

describe('commonRoot', () => {
  it('finds the longest common directory', () => {
    expect(
      commonRoot(['file:///proj/pkg/a.py', 'file:///proj/pkg/sub/b.py', 'file:///proj/c.py'])
    ).toBe('file:///proj');
  });

  it('returns the dirname for a single uri', () => {
    expect(commonRoot(['file:///proj/a.py'])).toBe('file:///proj');
  });

  it('returns null for empty input', () => {
    expect(commonRoot([])).toBeNull();
  });
});
