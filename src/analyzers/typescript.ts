import { LanguageAnalyzer, SymbolDefinition, SymbolKind } from '../types';

/**
 * TypeScript/JavaScript language analyzer using regex patterns
 * Provides basic definition finding for TypeScript and JavaScript code
 */
export class TypeScriptAnalyzer implements LanguageAnalyzer {
  // Regex patterns for TypeScript/JavaScript constructs
  private static readonly FUNCTION_DECL = /^(\s*)(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*[<(]/gm;
  private static readonly ARROW_FUNCTION = /^(\s*)(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?(?:\([^)]*\)|[\w]+)\s*=>/gm;
  private static readonly CLASS_DECL = /^(\s*)(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm;
  private static readonly INTERFACE_DECL = /^(\s*)(?:export\s+)?interface\s+(\w+)/gm;
  private static readonly TYPE_DECL = /^(\s*)(?:export\s+)?type\s+(\w+)/gm;
  private static readonly VARIABLE_DECL = /^(\s*)(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=/gm;
  private static readonly METHOD_DECL = /^(\s*)(?:public|private|protected|static|async|readonly|\s)*(\w+)\s*[<(].*[)>]\s*(?::\s*[^{]+)?\s*\{/gm;
  private static readonly IMPORT_NAMED = /^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/gm;
  private static readonly IMPORT_DEFAULT = /^import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/gm;
  private static readonly IMPORT_NAMESPACE = /^import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/gm;

  findDefinitions(source: string): SymbolDefinition[] {
    const definitions: SymbolDefinition[] = [];
    const lines = source.split('\n');

    // Find function declarations
    this.findFunctions(source, lines, definitions);
    
    // Find arrow functions
    this.findArrowFunctions(source, lines, definitions);
    
    // Find class declarations
    this.findClasses(source, lines, definitions);
    
    // Find interface declarations
    this.findInterfaces(source, lines, definitions);
    
    // Find type declarations
    this.findTypes(source, lines, definitions);
    
    // Find variable declarations
    this.findVariables(source, lines, definitions);
    
    // Find imports
    this.findImports(source, lines, definitions);

    return definitions;
  }

  private findFunctions(source: string, lines: string[], definitions: SymbolDefinition[]): void {
    const regex = new RegExp(TypeScriptAnalyzer.FUNCTION_DECL.source, 'gm');
    let match: RegExpExecArray | null;
    
    while ((match = regex.exec(source)) !== null) {
      const name = match[2];
      const position = this.getLineColumn(source, match.index);
      const nameIndex = match[0].indexOf(name);
      
      definitions.push({
        name,
        startLine: position.line,
        startColumn: nameIndex + 1,
        endLine: position.line,
        endColumn: nameIndex + 1 + name.length,
        kind: 'function'
      });
    }
  }

  private findArrowFunctions(source: string, lines: string[], definitions: SymbolDefinition[]): void {
    const regex = new RegExp(TypeScriptAnalyzer.ARROW_FUNCTION.source, 'gm');
    let match: RegExpExecArray | null;
    
    while ((match = regex.exec(source)) !== null) {
      const name = match[2];
      const position = this.getLineColumn(source, match.index);
      const nameIndex = match[0].indexOf(name);
      
      definitions.push({
        name,
        startLine: position.line,
        startColumn: nameIndex + 1,
        endLine: position.line,
        endColumn: nameIndex + 1 + name.length,
        kind: 'function'
      });
    }
  }

  private findClasses(source: string, lines: string[], definitions: SymbolDefinition[]): void {
    const regex = new RegExp(TypeScriptAnalyzer.CLASS_DECL.source, 'gm');
    let match: RegExpExecArray | null;
    
    while ((match = regex.exec(source)) !== null) {
      const name = match[2];
      const position = this.getLineColumn(source, match.index);
      const nameIndex = match[0].indexOf(name);
      
      definitions.push({
        name,
        startLine: position.line,
        startColumn: nameIndex + 1,
        endLine: position.line,
        endColumn: nameIndex + 1 + name.length,
        kind: 'class'
      });
    }
  }

  private findInterfaces(source: string, lines: string[], definitions: SymbolDefinition[]): void {
    const regex = new RegExp(TypeScriptAnalyzer.INTERFACE_DECL.source, 'gm');
    let match: RegExpExecArray | null;
    
    while ((match = regex.exec(source)) !== null) {
      const name = match[2];
      const position = this.getLineColumn(source, match.index);
      const nameIndex = match[0].indexOf(name);
      
      definitions.push({
        name,
        startLine: position.line,
        startColumn: nameIndex + 1,
        endLine: position.line,
        endColumn: nameIndex + 1 + name.length,
        kind: 'class' // Using 'class' for interface as it's similar
      });
    }
  }

  private findTypes(source: string, lines: string[], definitions: SymbolDefinition[]): void {
    const regex = new RegExp(TypeScriptAnalyzer.TYPE_DECL.source, 'gm');
    let match: RegExpExecArray | null;
    
    while ((match = regex.exec(source)) !== null) {
      const name = match[2];
      const position = this.getLineColumn(source, match.index);
      const nameIndex = match[0].indexOf(name);
      
      definitions.push({
        name,
        startLine: position.line,
        startColumn: nameIndex + 1,
        endLine: position.line,
        endColumn: nameIndex + 1 + name.length,
        kind: 'class' // Using 'class' for type alias
      });
    }
  }

  private findVariables(source: string, lines: string[], definitions: SymbolDefinition[]): void {
    const regex = new RegExp(TypeScriptAnalyzer.VARIABLE_DECL.source, 'gm');
    let match: RegExpExecArray | null;
    const seenNames = new Set<string>();
    
    while ((match = regex.exec(source)) !== null) {
      const indent = match[1];
      const name = match[2];
      
      // Skip function declarations (already caught by arrow function pattern)
      if (match[0].includes('=>')) continue;
      
      // Only top-level and class-level (indent 0 or small)
      if (indent.length > 4) continue;
      
      // Skip if we've already seen this name
      const key = `${indent.length}:${name}`;
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      
      const position = this.getLineColumn(source, match.index);
      const nameIndex = match[0].indexOf(name);
      
      definitions.push({
        name,
        startLine: position.line,
        startColumn: nameIndex + 1,
        endLine: position.line,
        endColumn: nameIndex + 1 + name.length,
        kind: 'variable'
      });
    }
  }

  private findImports(source: string, lines: string[], definitions: SymbolDefinition[]): void {
    // Named imports: import { X, Y } from 'module'
    let regex = new RegExp(TypeScriptAnalyzer.IMPORT_NAMED.source, 'gm');
    let match: RegExpExecArray | null;
    
    while ((match = regex.exec(source)) !== null) {
      const importList = match[1];
      const position = this.getLineColumn(source, match.index);
      
      const imports = importList.split(',');
      for (const imp of imports) {
        const parts = imp.trim().split(/\s+as\s+/);
        const name = (parts[1] || parts[0]).trim();
        
        if (name && /^\w+$/.test(name)) {
          definitions.push({
            name,
            startLine: position.line,
            startColumn: 1,
            endLine: position.line,
            endColumn: lines[position.line - 1]?.length || 1,
            kind: 'import'
          });
        }
      }
    }
    
    // Default imports: import X from 'module'
    regex = new RegExp(TypeScriptAnalyzer.IMPORT_DEFAULT.source, 'gm');
    while ((match = regex.exec(source)) !== null) {
      const name = match[1];
      const position = this.getLineColumn(source, match.index);
      
      definitions.push({
        name,
        startLine: position.line,
        startColumn: 1,
        endLine: position.line,
        endColumn: lines[position.line - 1]?.length || 1,
        kind: 'import'
      });
    }
    
    // Namespace imports: import * as X from 'module'
    regex = new RegExp(TypeScriptAnalyzer.IMPORT_NAMESPACE.source, 'gm');
    while ((match = regex.exec(source)) !== null) {
      const name = match[1];
      const position = this.getLineColumn(source, match.index);
      
      definitions.push({
        name,
        startLine: position.line,
        startColumn: 1,
        endLine: position.line,
        endColumn: lines[position.line - 1]?.length || 1,
        kind: 'import'
      });
    }
  }

  getSymbolAtPosition(source: string, line: number, column: number): string | null {
    const lines = source.split('\n');
    if (line < 1 || line > lines.length) return null;
    
    const lineText = lines[line - 1];
    if (column < 1 || column > lineText.length + 1) return null;
    
    // Find word boundaries around the position
    const beforeCursor = lineText.substring(0, column - 1);
    const afterCursor = lineText.substring(column - 1);
    
    const beforeMatch = beforeCursor.match(/(\w*)$/);
    const afterMatch = afterCursor.match(/^(\w*)/);
    
    if (!beforeMatch && !afterMatch) return null;
    
    const word = (beforeMatch?.[1] || '') + (afterMatch?.[1] || '');
    return word || null;
  }

  getImportPath(source: string, symbolName: string): string | null {
    // Check named import: import { symbolName } from 'path'
    const namedPattern = new RegExp(
      `^import\\s+\\{[^}]*\\b${symbolName}\\b[^}]*\\}\\s+from\\s+['"]([^'"]+)['"]`,
      'gm'
    );
    let match = namedPattern.exec(source);
    if (match) {
      return match[1];
    }
    
    // Check default import: import symbolName from 'path'
    const defaultPattern = new RegExp(
      `^import\\s+${symbolName}\\s+from\\s+['"]([^'"]+)['"]`,
      'gm'
    );
    match = defaultPattern.exec(source);
    if (match) {
      return match[1];
    }
    
    // Check namespace import: import * as symbolName from 'path'
    const namespacePattern = new RegExp(
      `^import\\s+\\*\\s+as\\s+${symbolName}\\s+from\\s+['"]([^'"]+)['"]`,
      'gm'
    );
    match = namespacePattern.exec(source);
    if (match) {
      return match[1];
    }
    
    return null;
  }

  private getLineColumn(source: string, index: number): { line: number; column: number } {
    const before = source.substring(0, index);
    const lines = before.split('\n');
    return {
      line: lines.length,
      column: (lines[lines.length - 1]?.length || 0) + 1
    };
  }
}
