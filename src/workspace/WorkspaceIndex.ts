import { MonacoLike, TextModelLike, DisposableLike } from '../monacoEnv';
import {
  LoadFileHook,
  ResolveModuleUriHook,
  WorkspaceAccess,
  WorkspaceDocument
} from '../types';
import { commonRoot, resolvePythonImport, uriDirname } from './moduleResolver';

export interface WorkspaceIndexOptions {
  loadFile?: LoadFileHook;
  resolveModuleUri?: ResolveModuleUriHook;
  /** Language assigned to models created from loadFile results without an explicit languageId. */
  defaultLanguageId?: string;
}

/**
 * Tracks open Monaco models and resolves import specifiers to documents.
 *
 * Resolution order:
 * 1. the host's `resolveModuleUri` hook (when provided) supplies candidate URIs,
 *    otherwise built-in Python path heuristics compute them;
 * 2. candidates are matched against open models;
 * 3. unmatched candidates are offered to the host's `loadFile` hook — returned
 *    content becomes a real Monaco model so later navigation works natively.
 */
export class WorkspaceIndex implements WorkspaceAccess {
  private readonly models = new Map<string, TextModelLike>();
  private readonly disposables: DisposableLike[] = [];
  /** De-duplicates concurrent loadFile calls for the same URI. */
  private readonly pendingLoads = new Map<string, Promise<WorkspaceDocument | null>>();

  constructor(
    private readonly monaco: MonacoLike,
    private readonly options: WorkspaceIndexOptions = {}
  ) {
    for (const model of monaco.editor.getModels()) {
      this.trackModel(model);
    }
    this.disposables.push(monaco.editor.onDidCreateModel(model => this.trackModel(model)));
  }

  private trackModel(model: TextModelLike): void {
    const uri = model.uri.toString();
    this.models.set(uri, model);
    this.disposables.push(
      model.onWillDispose(() => {
        this.models.delete(uri);
      })
    );
  }

  getDocument(uri: string): WorkspaceDocument | null {
    const model = this.models.get(uri);
    if (!model || model.isDisposed()) return null;
    return { uri, getValue: () => model.getValue() };
  }

  async resolveImport(importPath: string, fromUri: string): Promise<WorkspaceDocument | null> {
    const candidates = await this.candidateUris(importPath, fromUri);

    // Open models win over host loading.
    for (const candidate of candidates) {
      const doc = this.getDocument(candidate);
      if (doc) return doc;
    }

    if (!this.options.loadFile) return null;
    for (const candidate of candidates) {
      const doc = await this.loadViaHost(candidate, importPath, fromUri);
      if (doc) return doc;
    }
    return null;
  }

  private async candidateUris(importPath: string, fromUri: string): Promise<string[]> {
    if (this.options.resolveModuleUri) {
      const resolved = await this.options.resolveModuleUri(importPath, fromUri);
      if (resolved) return Array.isArray(resolved) ? resolved : [resolved];
    }

    const roots = this.pythonRoots(fromUri);
    return resolvePythonImport(importPath, fromUri, roots);
  }

  /** Heuristic roots for absolute imports: common dir of open python models, then fromUri's dir. */
  private pythonRoots(fromUri: string): string[] {
    const pythonUris = [...this.models.values()]
      .filter(m => !m.isDisposed() && m.getLanguageId() === 'python')
      .map(m => m.uri.toString());

    const roots: string[] = [];
    const shared = commonRoot([...pythonUris, fromUri]);
    if (shared) roots.push(shared);
    const fromDir = uriDirname(fromUri);
    if (!roots.includes(fromDir)) roots.push(fromDir);
    return roots;
  }

  private loadViaHost(
    uri: string,
    importPath: string,
    fromUri: string
  ): Promise<WorkspaceDocument | null> {
    const pending = this.pendingLoads.get(uri);
    if (pending) return pending;

    const load = (async (): Promise<WorkspaceDocument | null> => {
      try {
        const result = await this.options.loadFile!(uri, importPath, fromUri);
        if (!result) return null;

        const resultUri = result.uri || uri;
        // The host may race us in creating the model.
        const existing = this.getDocument(resultUri);
        if (existing) return existing;

        const model = this.monaco.editor.createModel(
          result.content,
          result.languageId ?? this.options.defaultLanguageId,
          this.monaco.Uri.parse(resultUri)
        );
        this.trackModel(model);
        return this.getDocument(model.uri.toString());
      } catch (error) {
        console.error('monaco-definition-provider: loadFile hook failed for', uri, error);
        return null;
      } finally {
        this.pendingLoads.delete(uri);
      }
    })();

    this.pendingLoads.set(uri, load);
    return load;
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.models.clear();
    this.pendingLoads.clear();
  }
}
