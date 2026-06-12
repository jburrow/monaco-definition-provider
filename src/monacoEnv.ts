/**
 * Narrow structural view of the `monaco-editor` namespace — exactly the
 * surface this library touches. The host passes its own monaco instance,
 * which avoids the classic duplicate-monaco bundling hazard and lets tests
 * run with plain fakes (the real `monaco-editor` cannot load under Node).
 */

export interface DisposableLike {
  dispose(): void;
}

export interface UriLike {
  toString(): string;
}

export interface PositionLike {
  lineNumber: number;
  column: number;
}

export interface TextModelLike {
  uri: UriLike;
  getValue(): string;
  getLanguageId(): string;
  getOffsetAt(position: PositionLike): number;
  getPositionAt(offset: number): PositionLike;
  isDisposed(): boolean;
  onWillDispose(listener: () => void): DisposableLike;
}

export interface TypeScriptWorkerLike {
  getDefinitionAtPosition(
    fileName: string,
    position: number
  ): Promise<ReadonlyArray<DefinitionInfoLike> | undefined>;
}

/** Shape of entries returned by the TS worker's getDefinitionAtPosition. */
export interface DefinitionInfoLike {
  fileName: string;
  textSpan: { start: number; length: number };
}

export interface TypeScriptNamespaceLike {
  getTypeScriptWorker(): Promise<(...uris: UriLike[]) => Promise<TypeScriptWorkerLike>>;
  getJavaScriptWorker(): Promise<(...uris: UriLike[]) => Promise<TypeScriptWorkerLike>>;
  typescriptDefaults?: LanguageServiceDefaultsLike;
  javascriptDefaults?: LanguageServiceDefaultsLike;
}

export interface LanguageServiceDefaultsLike {
  setCompilerOptions(options: Record<string, unknown>): void;
  getCompilerOptions(): Record<string, unknown>;
  setEagerModelSync(value: boolean): void;
}

export interface MonacoLike {
  editor: {
    getModels(): TextModelLike[];
    getModel(uri: UriLike): TextModelLike | null;
    createModel(value: string, language?: string, uri?: UriLike): TextModelLike;
    onDidCreateModel(listener: (model: TextModelLike) => void): DisposableLike;
  };
  languages: {
    registerDefinitionProvider(languageId: string, provider: object): DisposableLike;
    typescript?: TypeScriptNamespaceLike;
  };
  Uri: {
    parse(value: string): UriLike;
  };
}
