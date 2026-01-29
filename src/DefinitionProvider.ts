import * as monaco from 'monaco-editor';
import { 
  DefinitionProviderOptions, 
  IDefinitionProvider, 
  LanguageAnalyzer,
  SymbolDefinition 
} from './types';
import { PythonAnalyzer } from './analyzers/python';
import { TypeScriptAnalyzer } from './analyzers/typescript';

/**
 * A definition provider for Monaco Editor that supports jump-to-definition
 * for Python and TypeScript/JavaScript.
 * 
 * Features:
 * - Same-document navigation: Jumps to definitions within the current file
 * - Cross-document navigation: Uses a callback for external file navigation
 * - Supports functions, classes, variables, and imports
 * 
 * @example
 * ```typescript
 * import { DefinitionProvider } from 'monaco-definition-provider';
 * 
 * const provider = new DefinitionProvider({
 *   onExternalNavigation: async (symbolName, importPath, currentUri) => {
 *     // Handle navigation to external files
 *     const fileUri = await resolveImport(importPath);
 *     return { uri: fileUri, range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 } };
 *   }
 * });
 * 
 * // Register for Python
 * provider.register('python');
 * 
 * // Register for TypeScript
 * provider.register('typescript');
 * ```
 */
export class DefinitionProvider implements IDefinitionProvider {
  private readonly options: DefinitionProviderOptions;
  private readonly analyzers: Map<string, LanguageAnalyzer> = new Map();
  private readonly disposables: monaco.IDisposable[] = [];

  constructor(options: DefinitionProviderOptions = {}) {
    this.options = options;
    
    // Initialize built-in analyzers
    this.analyzers.set('python', new PythonAnalyzer());
    this.analyzers.set('typescript', new TypeScriptAnalyzer());
    this.analyzers.set('javascript', new TypeScriptAnalyzer());
  }

  /**
   * Register this provider for a specific language
   * @param languageId The Monaco language ID (e.g., 'python', 'typescript', 'javascript')
   * @returns A disposable to unregister the provider
   */
  register(languageId: string): monaco.IDisposable {
    const disposable = monaco.languages.registerDefinitionProvider(languageId, this);
    this.disposables.push(disposable);
    return disposable;
  }

  /**
   * Register a custom language analyzer
   * @param languageId The language identifier
   * @param analyzer The analyzer implementation
   */
  registerAnalyzer(languageId: string, analyzer: LanguageAnalyzer): void {
    this.analyzers.set(languageId, analyzer);
  }

  /**
   * Monaco definition provider implementation
   */
  async provideDefinition(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    token: monaco.CancellationToken
  ): Promise<monaco.languages.Definition | null> {
    const languageId = model.getLanguageId();
    const analyzer = this.analyzers.get(languageId);
    
    if (!analyzer) {
      return null;
    }

    const source = model.getValue();
    const symbolName = analyzer.getSymbolAtPosition(
      source, 
      position.lineNumber, 
      position.column
    );

    if (!symbolName) {
      return null;
    }

    // Check for cancellation
    if (token.isCancellationRequested) {
      return null;
    }

    // Find definitions in the current document
    const definitions = analyzer.findDefinitions(source);
    const localDefinition = this.findMatchingDefinition(definitions, symbolName);

    if (localDefinition) {
      // Found in current document - return location
      return {
        uri: model.uri,
        range: new monaco.Range(
          localDefinition.startLine,
          localDefinition.startColumn,
          localDefinition.endLine,
          localDefinition.endColumn
        )
      };
    }

    // Check if it's an imported symbol
    const importPath = analyzer.getImportPath(source, symbolName);
    
    if (importPath && this.options.onExternalNavigation) {
      // Invoke the external navigation callback
      try {
        const externalDef = await this.options.onExternalNavigation(
          symbolName,
          importPath,
          model.uri.toString()
        );

        if (externalDef && !token.isCancellationRequested) {
          return {
            uri: monaco.Uri.parse(externalDef.uri),
            range: new monaco.Range(
              externalDef.range.startLineNumber,
              externalDef.range.startColumn,
              externalDef.range.endLineNumber,
              externalDef.range.endColumn
            )
          };
        }
      } catch (error) {
        console.error('Error in external navigation callback:', error);
      }
    }

    return null;
  }

  /**
   * Find a definition that matches the symbol name
   */
  private findMatchingDefinition(
    definitions: SymbolDefinition[], 
    symbolName: string
  ): SymbolDefinition | null {
    // Prefer non-import definitions (actual definitions over imported names)
    const nonImportDef = definitions.find(
      d => d.name === symbolName && d.kind !== 'import'
    );
    
    if (nonImportDef) {
      return nonImportDef;
    }

    // Fall back to import definition
    return definitions.find(d => d.name === symbolName) || null;
  }

  /**
   * Dispose of the provider and all registered resources
   */
  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.analyzers.clear();
  }
}

/**
 * Create and register a definition provider for multiple languages
 * 
 * @param languages Array of language IDs to register
 * @param options Provider options
 * @returns The created provider instance
 * 
 * @example
 * ```typescript
 * const provider = createDefinitionProvider(['python', 'typescript'], {
 *   onExternalNavigation: async (symbol, path) => {
 *     // Handle external navigation
 *     return null;
 *   }
 * });
 * ```
 */
export function createDefinitionProvider(
  languages: string[],
  options: DefinitionProviderOptions = {}
): DefinitionProvider {
  const provider = new DefinitionProvider(options);
  
  for (const lang of languages) {
    provider.register(lang);
  }
  
  return provider;
}
