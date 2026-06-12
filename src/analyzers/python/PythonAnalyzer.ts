import type { Node, Parser } from 'web-tree-sitter';
import {
  DefinitionLocation,
  LanguageAnalyzer,
  PythonOptions,
  WorkspaceAccess,
  WorkspaceDocument
} from '../../types';
import { createPythonParser } from './parser';
import {
  Binding,
  Point,
  buildScopeTree,
  findModuleBinding,
  resolveName,
  scopeAt
} from './scopes';

/**
 * Scope-aware Python definition analyzer backed by tree-sitter.
 *
 * Resolution follows real Python scoping (LEGB with class-scope skipping,
 * global/nonlocal). Imported names resolve through the workspace: open models
 * first, then the host's `loadFile` hook for lazily-loaded files.
 */
export class PythonAnalyzer implements LanguageAnalyzer {
  private parserPromise: Promise<Parser> | null = null;

  constructor(private readonly options: PythonOptions = {}) {}

  private getParser(): Promise<Parser> {
    if (!this.parserPromise) {
      this.parserPromise = createPythonParser(this.options);
      this.parserPromise.catch(() => {
        this.parserPromise = null;
      });
    }
    return this.parserPromise;
  }

  async provideDefinition(
    doc: WorkspaceDocument,
    position: { lineNumber: number; column: number },
    workspace: WorkspaceAccess
  ): Promise<DefinitionLocation[] | null> {
    const parser = await this.getParser();
    const tree = parser.parse(doc.getValue());
    if (!tree) return null;

    try {
      const point: Point = { row: position.lineNumber - 1, column: position.column - 1 };
      const identifier = identifierAt(tree.rootNode, point);
      if (!identifier) return null;

      // Click inside an import statement → navigate to the module/symbol itself.
      const importResult = await this.resolveImportClick(identifier, doc, workspace);
      if (importResult) return importResult;

      // `mod.symbol` with the cursor on `symbol` — resolve only when `mod`
      // is an imported module (no type inference).
      const attrResult = await this.resolveAttributeClick(identifier, doc, workspace);
      if (attrResult !== undefined) return attrResult;

      // Plain reference: walk the scope chain.
      const rootScope = buildScopeTree(tree);
      const scope = scopeAt(rootScope, identifier.startPosition);
      const binding = resolveName(scope, identifier.text, identifier.startPosition);
      if (!binding) return null;

      if (binding.kind !== 'import') {
        return [toLocation(doc.uri, binding.start, binding.end)];
      }
      return this.resolveImportedBinding(binding, doc, workspace);
    } finally {
      tree.delete();
    }
  }

  /**
   * Resolve a click on a name inside an `import`/`from … import` statement.
   * Returns null when the identifier is not part of an import statement.
   */
  private async resolveImportClick(
    identifier: Node,
    doc: WorkspaceDocument,
    workspace: WorkspaceAccess
  ): Promise<DefinitionLocation[] | null> {
    const importStmt = ancestorOfType(identifier, ['import_statement', 'import_from_statement']);
    if (!importStmt) return null;

    if (importStmt.type === 'import_statement') {
      // `import a.b.c [as d]` — navigate to the module file.
      const dotted = ancestorOfType(identifier, ['dotted_name']) ?? identifier;
      return this.navigateToModule(dotted.text, doc, workspace);
    }

    const moduleNode = importStmt.childForFieldName('module_name');
    const importPath = moduleNode?.text ?? '';

    if (moduleNode && isInside(identifier, moduleNode)) {
      // Click on the module part of `from a.b import x`.
      return this.navigateToModule(importPath, doc, workspace);
    }

    // Click on an imported name (or its alias).
    const aliased = ancestorOfType(identifier, ['aliased_import']);
    const importedName = aliased?.childForFieldName('name')?.text ?? identifier.text;
    return this.navigateToImportedSymbol(importPath, importedName, doc, workspace);
  }

  /**
   * Resolve `mod.symbol` attribute access when `mod` is an imported module.
   * Returns undefined when the identifier is not an attribute access (caller
   * should continue with normal resolution); null when it is one but cannot
   * be resolved.
   */
  private async resolveAttributeClick(
    identifier: Node,
    doc: WorkspaceDocument,
    workspace: WorkspaceAccess
  ): Promise<DefinitionLocation[] | null | undefined> {
    const parent = identifier.parent;
    if (parent?.type !== 'attribute') return undefined;
    if (parent.childForFieldName('attribute')?.id !== identifier.id) return undefined;

    const objectNode = parent.childForFieldName('object');
    if (objectNode?.type !== 'identifier') return null;

    const rootScope = buildScopeTree(identifier.tree);
    const scope = scopeAt(rootScope, identifier.startPosition);
    const binding = resolveName(scope, objectNode.text, objectNode.startPosition);
    if (!binding || binding.kind !== 'import' || binding.importedName) return null;

    return this.navigateToImportedSymbol(binding.importPath ?? '', identifier.text, doc, workspace);
  }

  /** Follow an import binding (`from m import x` / `import m`) used elsewhere in the file. */
  private async resolveImportedBinding(
    binding: Binding,
    doc: WorkspaceDocument,
    workspace: WorkspaceAccess
  ): Promise<DefinitionLocation[] | null> {
    const importPath = binding.importPath ?? '';
    if (binding.importedName) {
      return this.navigateToImportedSymbol(importPath, binding.importedName, doc, workspace);
    }
    return this.navigateToModule(importPath, doc, workspace);
  }

  /** Navigate to a module file (position 1:1). */
  private async navigateToModule(
    importPath: string,
    doc: WorkspaceDocument,
    workspace: WorkspaceAccess
  ): Promise<DefinitionLocation[] | null> {
    const target = await workspace.resolveImport(importPath, doc.uri);
    if (!target) return null;
    return [
      {
        uri: target.uri,
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }
      }
    ];
  }

  /**
   * Navigate to `symbolName` exported by module `importPath`. Falls back to
   * treating `importPath.symbolName` as a module (covers `from pkg import mod`),
   * then to the module file itself.
   */
  private async navigateToImportedSymbol(
    importPath: string,
    symbolName: string,
    doc: WorkspaceDocument,
    workspace: WorkspaceAccess
  ): Promise<DefinitionLocation[] | null> {
    const moduleDoc = await workspace.resolveImport(importPath, doc.uri);
    if (moduleDoc) {
      const location = await this.findInModule(moduleDoc, symbolName);
      if (location) return [location];
    }

    // `from pkg import mod` — the imported name may itself be a module.
    const submodulePath = importPath.endsWith('.')
      ? `${importPath}${symbolName}`
      : `${importPath}.${symbolName}`;
    const submodule = await workspace.resolveImport(submodulePath, doc.uri);
    if (submodule) {
      return [
        {
          uri: submodule.uri,
          range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }
        }
      ];
    }

    if (moduleDoc) {
      // Module found but symbol not located — land on the file rather than failing.
      return [
        {
          uri: moduleDoc.uri,
          range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }
        }
      ];
    }
    return null;
  }

  /** Find a module-level binding in another document. */
  private async findInModule(
    moduleDoc: WorkspaceDocument,
    symbolName: string
  ): Promise<DefinitionLocation | null> {
    const parser = await this.getParser();
    const tree = parser.parse(moduleDoc.getValue());
    if (!tree) return null;
    try {
      const rootScope = buildScopeTree(tree);
      const binding = findModuleBinding(rootScope, symbolName);
      if (!binding) return null;
      return toLocation(moduleDoc.uri, binding.start, binding.end);
    } finally {
      tree.delete();
    }
  }

  dispose(): void {
    this.parserPromise?.then(parser => parser.delete()).catch(() => {});
    this.parserPromise = null;
  }
}

/** Find the identifier node at/just before the cursor position. */
function identifierAt(rootNode: Node, point: Point): Node | null {
  const candidates: Point[] = [point];
  if (point.column > 0) {
    // The cursor may sit just past the last character of the word.
    candidates.push({ row: point.row, column: point.column - 1 });
  }
  for (const candidate of candidates) {
    const node = rootNode.descendantForPosition(candidate);
    if (node?.type === 'identifier') return node;
  }
  return null;
}

function ancestorOfType(node: Node, types: string[]): Node | null {
  let current = node.parent;
  while (current) {
    if (types.includes(current.type)) return current;
    current = current.parent;
  }
  return null;
}

function isInside(node: Node, container: Node): boolean {
  return node.startIndex >= container.startIndex && node.endIndex <= container.endIndex;
}

function toLocation(uri: string, start: Point, end: Point): DefinitionLocation {
  return {
    uri,
    range: {
      startLineNumber: start.row + 1,
      startColumn: start.column + 1,
      endLineNumber: end.row + 1,
      endColumn: end.column + 1
    }
  };
}
