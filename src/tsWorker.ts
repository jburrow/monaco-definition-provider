import {
  DefinitionInfoLike,
  MonacoLike,
  PositionLike,
  TextModelLike,
  TypeScriptWorkerLike
} from './monacoEnv';
import { DefinitionLocation, LoadFileHook, ResolveModuleUriHook, TypeScriptOptions } from './types';
import { resolveTsImport } from './workspace/moduleResolver';

export interface TsWorkerStrategyOptions {
  loadFile?: LoadFileHook;
  resolveModuleUri?: ResolveModuleUriHook;
  typescript?: TypeScriptOptions;
}

const LIB_FILE_PATTERN = /\/lib(\.[\w.]+)?\.d\.ts$/;

/**
 * TS/JS go-to-definition strategy.
 *
 * Monaco's built-in TypeScript language service already provides accurate,
 * multi-model definitions, so this strategy deliberately contributes nothing
 * when the built-in provider would succeed. Its added value is the lazy-load
 * path: when a definition resolves only to an import statement whose target
 * file isn't open, it asks the host's `loadFile` hook for the file, creates a
 * model, and re-queries the language service for the precise location.
 */
export class TsWorkerStrategy {
  private warnedMissingTs = false;

  constructor(
    private readonly monaco: MonacoLike,
    private readonly options: TsWorkerStrategyOptions = {}
  ) {}

  async provideDefinition(
    model: TextModelLike,
    position: PositionLike
  ): Promise<DefinitionLocation[] | null> {
    const ts = this.monaco.languages.typescript;
    if (!ts) {
      if (!this.warnedMissingTs) {
        this.warnedMissingTs = true;
        console.warn(
          'monaco-definition-provider: monaco.languages.typescript is unavailable — ' +
            'the TypeScript language contribution is not loaded; TS/JS definitions are disabled.'
        );
      }
      return null;
    }

    const getWorker =
      model.getLanguageId() === 'javascript' ? ts.getJavaScriptWorker : ts.getTypeScriptWorker;
    const accessor = await getWorker();
    const worker = await accessor(model.uri);
    const offset = model.getOffsetAt(position);
    const entries = await worker.getDefinitionAtPosition(model.uri.toString(), offset);
    const locations = this.mapEntries(entries);

    const currentUri = model.uri.toString();
    const hasCrossFileResult = locations.some(loc => loc.uri !== currentUri);
    if (hasCrossFileResult) {
      // The built-in provider already covers this jump; contributing the same
      // result again would duplicate entries in the peek view.
      return null;
    }

    // No result, or only a same-file result (typically the import binding
    // itself when the target module is unresolved) — try the lazy-load path.
    const specifier = this.specifierToLoad(model, position, locations);
    if (!specifier || !this.options.loadFile) return null;

    const loaded = await this.loadModule(specifier, currentUri);
    if (!loaded) return null;

    // Re-query with both models synced; the language service now knows the file.
    const retryWorker = await accessor(model.uri, loaded.uri);
    const retryEntries = await retryWorker.getDefinitionAtPosition(currentUri, offset);
    const retryLocations = this.mapEntries(retryEntries).filter(loc => loc.uri !== currentUri);
    return retryLocations.length > 0 ? retryLocations : null;
  }

  /**
   * The import specifier worth lazy-loading: from the line of a same-file
   * definition result (the import statement the language service fell back
   * to), or from the cursor's own line when there was no result at all.
   */
  private specifierToLoad(
    model: TextModelLike,
    position: PositionLike,
    locations: DefinitionLocation[]
  ): string | null {
    const lines = model.getValue().split('\n');
    const lineNumbers = locations.length > 0
      ? locations.map(loc => loc.range.startLineNumber)
      : [position.lineNumber];

    for (const lineNumber of lineNumbers) {
      const line = lines[lineNumber - 1] ?? '';
      const match =
        line.match(/from\s+(['"])([^'"]+)\1/) ??
        line.match(/import\s+(['"])([^'"]+)\1/) ??
        line.match(/import\s*\(\s*(['"])([^'"]+)\1/) ??
        line.match(/require\s*\(\s*(['"])([^'"]+)\1/);
      if (match) return match[2];
    }
    return null;
  }

  private async loadModule(specifier: string, fromUri: string): Promise<TextModelLike | null> {
    let candidates: string[] = [];
    if (this.options.resolveModuleUri) {
      const resolved = await this.options.resolveModuleUri(specifier, fromUri);
      if (resolved) candidates = Array.isArray(resolved) ? resolved : [resolved];
    }
    if (candidates.length === 0) {
      candidates = resolveTsImport(specifier, fromUri);
    }

    for (const candidate of candidates) {
      const existing = this.monaco.editor.getModel(this.monaco.Uri.parse(candidate));
      if (existing) return existing;
    }

    for (const candidate of candidates) {
      try {
        const result = await this.options.loadFile!(candidate, specifier, fromUri);
        if (!result) continue;
        const uri = result.uri || candidate;
        const existing = this.monaco.editor.getModel(this.monaco.Uri.parse(uri));
        if (existing) return existing;
        return this.monaco.editor.createModel(
          result.content,
          result.languageId ?? languageIdForUri(uri),
          this.monaco.Uri.parse(uri)
        );
      } catch (error) {
        console.error('monaco-definition-provider: loadFile hook failed for', candidate, error);
      }
    }
    return null;
  }

  private mapEntries(
    entries: ReadonlyArray<DefinitionInfoLike> | undefined
  ): DefinitionLocation[] {
    if (!entries) return [];
    const ignoreLibFiles = this.options.typescript?.ignoreLibFiles ?? true;
    const locations: DefinitionLocation[] = [];

    for (const entry of entries) {
      if (ignoreLibFiles && LIB_FILE_PATTERN.test(entry.fileName)) continue;
      const refModel = this.monaco.editor.getModel(this.monaco.Uri.parse(entry.fileName));
      if (!refModel) continue; // extraLib or otherwise unmappable — skip.
      const start = refModel.getPositionAt(entry.textSpan.start);
      const end = refModel.getPositionAt(entry.textSpan.start + entry.textSpan.length);
      locations.push({
        uri: refModel.uri.toString(),
        range: {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column
        }
      });
    }
    return locations;
  }
}

function languageIdForUri(uri: string): string {
  if (/\.(jsx?|mjs|cjs)$/.test(uri)) return 'javascript';
  return 'typescript';
}

/**
 * Optional helper applying compiler options that make multi-model TS/JS
 * navigation work out of the box (Node-style module resolution, JS support,
 * eager model sync). Call once at startup if your app doesn't already
 * configure `typescriptDefaults` itself.
 */
export function configureTypeScriptDefaults(monaco: MonacoLike): void {
  const ts = monaco.languages.typescript;
  if (!ts) return;
  for (const defaults of [ts.typescriptDefaults, ts.javascriptDefaults]) {
    if (!defaults) continue;
    defaults.setCompilerOptions({
      ...defaults.getCompilerOptions(),
      allowJs: true,
      allowNonTsExtensions: true,
      moduleResolution: 2 // NodeJs
    });
    defaults.setEagerModelSync(true);
  }
}

export type { TypeScriptWorkerLike };
