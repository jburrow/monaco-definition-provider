import { DisposableLike, MonacoLike, PositionLike, TextModelLike } from './monacoEnv';
import {
  DefinitionLocation,
  DefinitionProviderOptions,
  LanguageAnalyzer
} from './types';
import { PythonAnalyzer } from './analyzers/python/PythonAnalyzer';
import { TsWorkerStrategy } from './tsWorker';
import { WorkspaceIndex } from './workspace/WorkspaceIndex';

interface CancellationTokenLike {
  isCancellationRequested: boolean;
}

/**
 * Go-to-definition provider for Monaco Editor.
 *
 * - `python` resolves through a scope-aware tree-sitter analyzer.
 * - `typescript`/`javascript` delegate to Monaco's built-in TypeScript
 *   language service, contributing only the lazy-file-loading fallback.
 * - Other languages can be supported via {@link registerAnalyzer}.
 *
 * The host passes its own `monaco` namespace, which keeps the library free of
 * a bundled monaco copy and the duplicate-instance hazard that comes with it.
 *
 * @example
 * ```typescript
 * import * as monaco from 'monaco-editor';
 * import { DefinitionProvider } from 'monaco-definition-provider';
 *
 * const provider = new DefinitionProvider(monaco, {
 *   loadFile: async (uri, importPath, fromUri) => {
 *     const content = await fetchFromServer(uri);
 *     return content === null ? null : { uri, content };
 *   }
 * });
 * provider.register('python');
 * provider.register('typescript');
 * ```
 */
export class DefinitionProvider {
  private readonly workspace: WorkspaceIndex;
  private readonly tsStrategy: TsWorkerStrategy;
  private readonly analyzers = new Map<string, LanguageAnalyzer>();
  private readonly disposables: DisposableLike[] = [];

  constructor(
    private readonly monaco: MonacoLike,
    private readonly options: DefinitionProviderOptions = {}
  ) {
    this.workspace = new WorkspaceIndex(monaco, {
      loadFile: options.loadFile,
      resolveModuleUri: options.resolveModuleUri,
      defaultLanguageId: 'python'
    });
    this.tsStrategy = new TsWorkerStrategy(monaco, options);
    this.analyzers.set('python', new PythonAnalyzer(options.python));
  }

  /**
   * Register this provider with Monaco for a language.
   * @returns A disposable that unregisters just this registration.
   */
  register(languageId: string): DisposableLike {
    const disposable = this.monaco.languages.registerDefinitionProvider(languageId, this);
    this.disposables.push(disposable);
    return disposable;
  }

  /** Add or replace the analyzer used for a language. */
  registerAnalyzer(languageId: string, analyzer: LanguageAnalyzer): void {
    this.analyzers.set(languageId, analyzer);
  }

  /** Monaco DefinitionProvider implementation. */
  async provideDefinition(
    model: TextModelLike,
    position: PositionLike,
    token?: CancellationTokenLike
  ): Promise<Array<{ uri: unknown; range: DefinitionLocation['range'] }> | null> {
    const languageId = model.getLanguageId();
    let locations: DefinitionLocation[] | null = null;

    if (languageId === 'typescript' || languageId === 'javascript') {
      locations = await this.tsStrategy.provideDefinition(model, position);
    } else {
      const analyzer = this.analyzers.get(languageId);
      if (!analyzer) return null;

      const doc = { uri: model.uri.toString(), getValue: () => model.getValue() };
      locations = await analyzer.provideDefinition(doc, position, this.workspace);

      if ((!locations || locations.length === 0) && this.options.fallbackNavigation) {
        // TS/JS deliberately never reaches the fallback: a null result there
        // usually means Monaco's built-in provider already handled the jump.
        const symbolName = wordAt(model.getValue(), position);
        if (symbolName) {
          const fallback = await this.options.fallbackNavigation({
            symbolName,
            fromUri: model.uri.toString()
          });
          locations = fallback ? [fallback] : null;
        }
      }
    }

    if (!locations || locations.length === 0 || token?.isCancellationRequested) {
      return null;
    }
    return locations.map(location => ({
      uri: this.monaco.Uri.parse(location.uri),
      range: location.range
    }));
  }

  /** Dispose all registrations, the workspace tracker, and analyzers. */
  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.workspace.dispose();
    for (const analyzer of this.analyzers.values()) {
      analyzer.dispose?.();
    }
    this.analyzers.clear();
  }
}

/**
 * Create a provider and register it for several languages at once.
 *
 * @example
 * ```typescript
 * const provider = createDefinitionProvider(monaco, ['python', 'typescript'], {
 *   loadFile: async uri => ({ uri, content: await fetchFromServer(uri) })
 * });
 * ```
 */
export function createDefinitionProvider(
  monaco: MonacoLike,
  languages: string[],
  options: DefinitionProviderOptions = {}
): DefinitionProvider {
  const provider = new DefinitionProvider(monaco, options);
  for (const language of languages) {
    provider.register(language);
  }
  return provider;
}

function wordAt(source: string, position: PositionLike): string | null {
  const line = source.split('\n')[position.lineNumber - 1];
  if (line === undefined) return null;
  const before = line.substring(0, position.column - 1).match(/(\w*)$/)?.[1] ?? '';
  const after = line.substring(position.column - 1).match(/^(\w*)/)?.[1] ?? '';
  const word = before + after;
  return word || null;
}
