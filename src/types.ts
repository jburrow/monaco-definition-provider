import type * as monaco from 'monaco-editor';

/**
 * Information about a symbol definition found in the code
 */
export interface SymbolDefinition {
  /** Name of the symbol */
  name: string;
  /** Start line (1-based) */
  startLine: number;
  /** Start column (1-based) */
  startColumn: number;
  /** End line (1-based) */
  endLine: number;
  /** End column (1-based) */
  endColumn: number;
  /** Type of the symbol (function, class, variable, etc.) */
  kind: SymbolKind;
}

/**
 * Types of symbols that can be found
 */
export type SymbolKind = 
  | 'function'
  | 'class'
  | 'method'
  | 'variable'
  | 'parameter'
  | 'import'
  | 'module';

/**
 * Result of a definition lookup
 */
export interface DefinitionResult {
  /** The URI where the definition is located */
  uri: string;
  /** The range of the definition */
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
}

/**
 * Callback for handling cross-document navigation
 * Called when a definition is found in a different document than the current one.
 * 
 * @param symbolName - The name of the symbol to navigate to
 * @param importPath - The import path/module name if available
 * @param currentUri - The URI of the current document
 * @returns A promise that resolves to the definition result, or null if not found
 */
export type ExternalNavigationCallback = (
  symbolName: string,
  importPath: string | undefined,
  currentUri: string
) => Promise<DefinitionResult | null>;

/**
 * Options for configuring the definition provider
 */
export interface DefinitionProviderOptions {
  /**
   * Callback invoked when navigation to an external document is needed.
   * If not provided, only same-document definitions will be resolved.
   */
  onExternalNavigation?: ExternalNavigationCallback;
  
  /**
   * Whether to include built-in symbols (like print, len in Python)
   * Default: false
   */
  includeBuiltins?: boolean;
}

/**
 * Interface for language-specific AST analyzers
 */
export interface LanguageAnalyzer {
  /**
   * Find all symbol definitions in the given source code
   */
  findDefinitions(source: string): SymbolDefinition[];
  
  /**
   * Find the symbol at the given position in the source code
   * @param source - The source code
   * @param line - Line number (1-based)
   * @param column - Column number (1-based)
   * @returns The symbol name at that position, or null if none found
   */
  getSymbolAtPosition(source: string, line: number, column: number): string | null;
  
  /**
   * Get import information for a symbol
   * @param source - The source code
   * @param symbolName - The name of the symbol
   * @returns The import path if the symbol is imported, or null if it's local
   */
  getImportPath(source: string, symbolName: string): string | null;
}

/**
 * Monaco-compatible definition provider interface
 */
export interface IDefinitionProvider extends monaco.languages.DefinitionProvider {
  /**
   * Dispose of the provider and clean up resources
   */
  dispose(): void;
}
