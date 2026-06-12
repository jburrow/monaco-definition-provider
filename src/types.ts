/**
 * A resolved definition location. URI is a string (a stringified monaco Uri).
 * Lines/columns are 1-based, matching Monaco conventions.
 */
export interface DefinitionLocation {
  uri: string;
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
}

/** A document the library can read — an open Monaco model or host-loaded content. */
export interface WorkspaceDocument {
  uri: string;
  getValue(): string;
}

/**
 * Narrow view of the workspace handed to language analyzers.
 * Implemented by WorkspaceIndex; trivially fakeable in tests.
 */
export interface WorkspaceAccess {
  /** Get an already-known document by exact URI, or null. */
  getDocument(uri: string): WorkspaceDocument | null;
  /**
   * Resolve an import specifier (e.g. Python "..utils.helpers") from a file
   * to a document — checking open models first, then asking the host's
   * `loadFile` hook. Returns null when nothing can provide the file.
   */
  resolveImport(importPath: string, fromUri: string): Promise<WorkspaceDocument | null>;
}

/**
 * Host hook: the library believes a file exists at `uri` but has no model
 * for it. The host fetches it (server, virtual FS, …) and returns its
 * content; the library creates a Monaco model from it so subsequent
 * navigation into that file works natively.
 *
 * @param uri Candidate URI computed from the import specifier.
 * @param importPath The original import specifier as written in source.
 * @param fromUri URI of the document containing the import.
 */
export type LoadFileHook = (
  uri: string,
  importPath: string,
  fromUri: string
) => Promise<{ uri: string; content: string; languageId?: string } | null>;

/**
 * Host hook overriding import-specifier → URI mapping. Return one or more
 * candidate URIs, or null to fall back to the built-in resolution heuristics.
 */
export type ResolveModuleUriHook = (
  importPath: string,
  fromUri: string
) => Promise<string | string[] | null> | string | string[] | null;

/**
 * Escape hatch invoked only when all built-in resolution failed
 * (replaces v1's `onExternalNavigation`).
 */
export type FallbackNavigationHook = (context: {
  symbolName: string;
  importPath?: string;
  fromUri: string;
}) => Promise<DefinitionLocation | null>;

export interface PythonOptions {
  /**
   * URL/path to tree-sitter-python.wasm, or the wasm bytes directly.
   * Defaults to the copy shipped next to the built library.
   */
  grammarWasm?: string | Uint8Array;
  /** Emscripten locateFile for web-tree-sitter's core runtime wasm. */
  locateFile?: (fileName: string, scriptDirectory: string) => string;
}

export interface TypeScriptOptions {
  /**
   * Skip definition results inside default lib files (lib.es5.d.ts, …).
   * Default: true.
   */
  ignoreLibFiles?: boolean;
}

export interface DefinitionProviderOptions {
  loadFile?: LoadFileHook;
  resolveModuleUri?: ResolveModuleUriHook;
  fallbackNavigation?: FallbackNavigationHook;
  python?: PythonOptions;
  typescript?: TypeScriptOptions;
}

/**
 * A language analyzer resolves definitions for one language.
 * Async because parser initialization and cross-file loading are async.
 */
export interface LanguageAnalyzer {
  provideDefinition(
    doc: WorkspaceDocument,
    position: { lineNumber: number; column: number },
    workspace: WorkspaceAccess
  ): Promise<DefinitionLocation[] | null>;
  dispose?(): void;
}
