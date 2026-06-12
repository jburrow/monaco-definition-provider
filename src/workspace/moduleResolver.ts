/**
 * Pure import-specifier → candidate-URI resolution.
 *
 * All functions here operate on URI strings and return *candidate* URIs in
 * priority order. Callers (WorkspaceIndex) check which candidates actually
 * exist as open models or can be provided by the host's `loadFile` hook.
 */

/** Directory of a URI string, without trailing slash: "file:///a/b/c.py" → "file:///a/b" */
export function uriDirname(uri: string): string {
  const hashless = uri.split(/[?#]/)[0];
  const lastSlash = hashless.lastIndexOf('/');
  if (lastSlash <= 0) return hashless;
  return hashless.substring(0, lastSlash);
}

/** Join path segments onto a base URI, normalizing "." and ".." segments. */
export function uriJoin(base: string, ...segments: string[]): string {
  // Separate scheme/authority from the path so ".." never escapes into them.
  const match = base.match(/^([a-zA-Z][\w+.-]*:\/\/[^/]*)?(.*)$/);
  const prefix = match?.[1] ?? '';
  const parts = (match?.[2] ?? base).split('/').filter(p => p.length > 0);

  for (const segment of segments) {
    for (const part of segment.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') {
        parts.pop();
      } else {
        parts.push(part);
      }
    }
  }
  return `${prefix}/${parts.join('/')}`;
}

/**
 * Resolve a Python import path to candidate file URIs.
 *
 * @param importPath Dotted module path as written in source. Leading dots
 *   denote relative imports: ".utils", "..pkg.mod", ".".
 * @param fromUri URI of the file containing the import.
 * @param roots Base URIs to resolve absolute (non-relative) imports against.
 * @returns Candidate URIs in priority order (module file before package __init__).
 */
export function resolvePythonImport(
  importPath: string,
  fromUri: string,
  roots: string[] = []
): string[] {
  const dotMatch = importPath.match(/^(\.+)(.*)$/);

  if (dotMatch) {
    // Relative import: one dot = current package, each extra dot = one level up.
    const level = dotMatch[1].length;
    const remainder = dotMatch[2];

    let base = uriDirname(fromUri);
    for (let i = 1; i < level; i++) {
      base = uriDirname(base);
    }
    return candidatesForModule(base, remainder);
  }

  // Absolute import: try each root in order.
  const candidates: string[] = [];
  for (const root of roots) {
    candidates.push(...candidatesForModule(root, importPath));
  }
  return candidates;
}

/** Candidates for a dotted module path under a base URI. */
function candidatesForModule(base: string, dottedPath: string): string[] {
  if (!dottedPath) {
    // "from . import x" — the module is the package itself.
    return [uriJoin(base, '__init__.py')];
  }
  const relPath = dottedPath.split('.').join('/');
  return [uriJoin(base, `${relPath}.py`), uriJoin(base, relPath, '__init__.py')];
}

const TS_EXTENSIONS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Resolve a TypeScript/JavaScript import specifier to candidate file URIs.
 * Only relative specifiers are resolved; bare specifiers (packages) return []
 * and must be handled by the host's `resolveModuleUri` hook.
 */
export function resolveTsImport(specifier: string, fromUri: string): string[] {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return [];
  }

  const base = uriDirname(fromUri);
  const resolved = uriJoin(base, specifier);
  const candidates: string[] = [];

  // Specifier may already carry an extension (ESM style "./x.js" often maps to x.ts).
  const extMatch = resolved.match(/\.(ts|tsx|js|jsx|mjs|cjs)$/);
  if (extMatch) {
    candidates.push(resolved);
    if (extMatch[1] === 'js') candidates.push(resolved.replace(/\.js$/, '.ts'), resolved.replace(/\.js$/, '.tsx'));
    if (extMatch[1] === 'mjs') candidates.push(resolved.replace(/\.mjs$/, '.mts'));
    if (extMatch[1] === 'cjs') candidates.push(resolved.replace(/\.cjs$/, '.cts'));
    return candidates;
  }

  for (const ext of TS_EXTENSIONS) {
    candidates.push(`${resolved}${ext}`);
  }
  for (const ext of TS_EXTENSIONS) {
    candidates.push(uriJoin(resolved, `index${ext}`));
  }
  return candidates;
}

/**
 * Heuristic workspace root for absolute Python imports: the longest common
 * directory prefix of the given model URIs. Hosts with non-trivial layouts
 * should supply the `resolveModuleUri` hook instead.
 */
export function commonRoot(uris: string[]): string | null {
  if (uris.length === 0) return null;
  let prefix = uriDirname(uris[0]);
  for (const uri of uris.slice(1)) {
    const dir = uriDirname(uri);
    while (prefix && dir !== prefix && !dir.startsWith(`${prefix}/`)) {
      const parent = uriDirname(prefix);
      if (parent === prefix) return null;
      prefix = parent;
    }
  }
  return prefix || null;
}
