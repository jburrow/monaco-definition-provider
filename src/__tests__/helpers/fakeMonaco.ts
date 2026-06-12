import type {
  DisposableLike,
  MonacoLike,
  PositionLike,
  TextModelLike,
  TypeScriptNamespaceLike,
  UriLike
} from '../../monacoEnv';

export class FakeModel implements TextModelLike {
  readonly uri: UriLike;
  private disposed = false;
  private readonly disposeListeners: Array<() => void> = [];

  constructor(
    uri: string,
    private value: string,
    private readonly languageId: string
  ) {
    this.uri = { toString: () => uri };
  }

  getValue(): string {
    return this.value;
  }

  setValue(value: string): void {
    this.value = value;
  }

  getLanguageId(): string {
    return this.languageId;
  }

  getOffsetAt(position: PositionLike): number {
    const lines = this.value.split('\n');
    let offset = 0;
    for (let i = 0; i < position.lineNumber - 1; i++) {
      offset += lines[i].length + 1;
    }
    return offset + position.column - 1;
  }

  getPositionAt(offset: number): PositionLike {
    const before = this.value.substring(0, offset);
    const lines = before.split('\n');
    return { lineNumber: lines.length, column: lines[lines.length - 1].length + 1 };
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  onWillDispose(listener: () => void): DisposableLike {
    this.disposeListeners.push(listener);
    return { dispose: () => {} };
  }

  dispose(): void {
    for (const listener of this.disposeListeners) listener();
    this.disposed = true;
  }
}

export class FakeMonaco implements MonacoLike {
  private readonly models: FakeModel[] = [];
  private readonly createListeners: Array<(model: TextModelLike) => void> = [];
  readonly registeredProviders: Array<{ languageId: string; provider: object }> = [];

  readonly languages: MonacoLike['languages'];

  constructor(public typescriptNamespace?: TypeScriptNamespaceLike) {
    const self = this;
    this.languages = {
      registerDefinitionProvider: (languageId: string, provider: object): DisposableLike => {
        const entry = { languageId, provider };
        self.registeredProviders.push(entry);
        return {
          dispose: () => {
            const index = self.registeredProviders.indexOf(entry);
            if (index >= 0) self.registeredProviders.splice(index, 1);
          }
        };
      },
      get typescript(): TypeScriptNamespaceLike | undefined {
        return self.typescriptNamespace;
      }
    };
  }

  readonly editor = {
    getModels: (): TextModelLike[] => this.models.filter(m => !m.isDisposed()),
    getModel: (uri: UriLike): TextModelLike | null =>
      this.models.find(m => !m.isDisposed() && m.uri.toString() === uri.toString()) ?? null,
    createModel: (value: string, language?: string, uri?: UriLike): TextModelLike => {
      const model = new FakeModel(uri?.toString() ?? `inmemory://model/${this.models.length}`, value, language ?? 'plaintext');
      this.models.push(model);
      for (const listener of this.createListeners) listener(model);
      return model;
    },
    onDidCreateModel: (listener: (model: TextModelLike) => void): DisposableLike => {
      this.createListeners.push(listener);
      return {
        dispose: () => {
          const index = this.createListeners.indexOf(listener);
          if (index >= 0) this.createListeners.splice(index, 1);
        }
      };
    }
  };

  readonly Uri = {
    parse: (value: string): UriLike => ({ toString: () => value })
  };

  /** Convenience: create a model and return it as FakeModel. */
  addModel(uri: string, value: string, languageId: string): FakeModel {
    const model = new FakeModel(uri, value, languageId);
    this.models.push(model);
    for (const listener of this.createListeners) listener(model);
    return model;
  }
}
