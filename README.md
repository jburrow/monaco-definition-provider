# Monaco Definition Provider

A jump-to-definition provider for Monaco Editor that supports **Python** and **TypeScript/JavaScript** with cross-document navigation via callbacks.

## Features

- 🎯 **Same-document navigation**: Jump to function, class, and variable definitions within the current file
- 🔗 **Cross-document navigation**: Callback-based external file navigation for imports
- 🐍 **Python support**: Functions, classes, variables, and import statements
- 📘 **TypeScript/JavaScript support**: Functions, arrow functions, classes, interfaces, types, and imports
- 🔌 **Extensible**: Register custom language analyzers

## Installation

```bash
pnpm add monaco-definition-provider
```

## Quick Start

```typescript
import * as monaco from 'monaco-editor';
import { DefinitionProvider } from 'monaco-definition-provider';

// Create the provider
const provider = new DefinitionProvider({
  // Optional: Handle navigation to external files
  onExternalNavigation: async (symbolName, importPath, currentUri) => {
    console.log(`Navigate to ${symbolName} from ${importPath}`);
    
    // Resolve the import and return the location
    const resolvedUri = await resolveImport(importPath, currentUri);
    const definition = await findDefinitionInFile(resolvedUri, symbolName);
    
    return definition; // { uri: string, range: { startLineNumber, startColumn, endLineNumber, endColumn } }
  }
});

// Register for languages
provider.register('python');
provider.register('typescript');
provider.register('javascript');

// Create your Monaco editor
const editor = monaco.editor.create(document.getElementById('editor'), {
  value: 'def hello():\n    pass',
  language: 'python'
});

// Now Ctrl+Click or F12 will jump to definitions!
```

## API

### `DefinitionProvider`

Main class that implements Monaco's `DefinitionProvider` interface.

```typescript
import { DefinitionProvider } from 'monaco-definition-provider';

const provider = new DefinitionProvider(options?: DefinitionProviderOptions);
```

#### Options

```typescript
interface DefinitionProviderOptions {
  /**
   * Callback invoked when navigation to an external document is needed.
   * If not provided, only same-document definitions will be resolved.
   */
  onExternalNavigation?: (
    symbolName: string,
    importPath: string | undefined,
    currentUri: string
  ) => Promise<DefinitionResult | null>;
  
  /**
   * Whether to include built-in symbols (like print, len in Python)
   * Default: false
   */
  includeBuiltins?: boolean;
}

interface DefinitionResult {
  uri: string;
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
}
```

#### Methods

- `register(languageId: string): IDisposable` - Register the provider for a language
- `registerAnalyzer(languageId: string, analyzer: LanguageAnalyzer): void` - Add a custom analyzer
- `dispose(): void` - Clean up all resources

### `createDefinitionProvider`

Helper function to create and register a provider for multiple languages at once.

```typescript
import { createDefinitionProvider } from 'monaco-definition-provider';

const provider = createDefinitionProvider(
  ['python', 'typescript', 'javascript'],
  {
    onExternalNavigation: async (symbol, path) => {
      // Handle external navigation
      return null;
    }
  }
);
```

## Custom Language Analyzers

You can add support for additional languages by implementing the `LanguageAnalyzer` interface:

```typescript
import { LanguageAnalyzer, SymbolDefinition } from 'monaco-definition-provider';

class MyLanguageAnalyzer implements LanguageAnalyzer {
  findDefinitions(source: string): SymbolDefinition[] {
    // Parse source and return definitions
    return [];
  }
  
  getSymbolAtPosition(source: string, line: number, column: number): string | null {
    // Return the symbol at the given position
    return null;
  }
  
  getImportPath(source: string, symbolName: string): string | null {
    // Return the import path for the symbol if it's imported
    return null;
  }
}

// Register your analyzer
provider.registerAnalyzer('mylang', new MyLanguageAnalyzer());
provider.register('mylang');
```

## How It Works

1. When the user triggers "Go to Definition" (Ctrl+Click, F12, etc.)
2. The provider finds the symbol at the cursor position
3. It searches for the symbol's definition in the current document
4. If found locally, it returns the location within the same file
5. If the symbol is imported, it calls `onExternalNavigation` callback
6. The callback can resolve the import and return the external location

## Examples

### Python

```python
from utils import helper  # Click on 'helper' -> onExternalNavigation called

def greet(name):  # Definition is here
    return f"Hello, {name}"

message = greet("World")  # Click on 'greet' -> jumps to line 3
```

### TypeScript

```typescript
import { format } from './utils';  // Click on 'format' -> onExternalNavigation called

interface User {  // Definition is here
  name: string;
}

const user: User = { name: 'Alice' };  // Click on 'User' -> jumps to line 3
```

## Running the Demo

```bash
pnpm install
pnpm dev
```

Then open http://localhost:3000 in your browser.

## Development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Type check
pnpm lint

# Build
pnpm build
```

## License

MIT