import { LanguageAnalyzer, SymbolDefinition, SymbolKind } from '../types';

/**
 * Python language analyzer using regex patterns
 * Provides basic definition finding for Python code
 */
export class PythonAnalyzer implements LanguageAnalyzer {
  // Regex patterns for Python constructs
  private static readonly FUNCTION_DEF = /^(\s*)def\s+(\w+)\s*\(/gm;
  private static readonly CLASS_DEF = /^(\s*)class\s+(\w+)\s*[:(]/gm;
  private static readonly VARIABLE_ASSIGNMENT = /^(\s*)(\w+)\s*(?::\s*\w+)?\s*=/gm;
  private static readonly IMPORT_FROM = /^from\s+([\w.]+)\s+import\s+(.+)$/gm;
  private static readonly IMPORT_SIMPLE = /^import\s+([\w.]+)(?:\s+as\s+(\w+))?$/gm;

  findDefinitions(source: string): SymbolDefinition[] {
    const definitions: SymbolDefinition[] = [];
    const lines = source.split('\n');

    // Find function definitions
    this.findFunctions(source, lines, definitions);
    
    // Find class definitions
    this.findClasses(source, lines, definitions);
    
    // Find top-level variable assignments
    this.findVariables(source, lines, definitions);
    
    // Find imports
    this.findImports(source, lines, definitions);

    return definitions;
  }

  private findFunctions(source: string, lines: string[], definitions: SymbolDefinition[]): void {
    const regex = new RegExp(PythonAnalyzer.FUNCTION_DEF.source, 'gm');
    let match: RegExpExecArray | null;
    
    while ((match = regex.exec(source)) !== null) {
      const name = match[2];
      const nameStart = match.index + match[1].length + 4; // 'def ' length
      const namePosition = this.getLineColumn(source, nameStart);
      
      definitions.push({
        name,
        startLine: namePosition.line,
        startColumn: namePosition.column,
        endLine: namePosition.line,
        endColumn: namePosition.column + name.length,
        kind: 'function'
      });

      // Also find parameters within this function
      this.findParameters(match[0], namePosition.line, definitions);
    }
  }

  private findParameters(funcDef: string, funcLine: number, definitions: SymbolDefinition[]): void {
    const paramMatch = /\(([^)]*)\)/.exec(funcDef);
    if (!paramMatch) return;
    
    const paramString = paramMatch[1];
    const params = paramString.split(',');
    let colOffset = funcDef.indexOf('(') + 1;
    
    for (const param of params) {
      const trimmed = param.trim();
      if (!trimmed || trimmed === 'self' || trimmed === 'cls') continue;
      
      // Handle type annotations: param: Type = default
      const paramName = trimmed.split(/[=:]/)[0].trim();
      if (paramName && /^\w+$/.test(paramName)) {
        const paramStart = colOffset + param.indexOf(paramName) + 1;
        definitions.push({
          name: paramName,
          startLine: funcLine,
          startColumn: paramStart,
          endLine: funcLine,
          endColumn: paramStart + paramName.length,
          kind: 'parameter'
        });
      }
      colOffset += param.length + 1; // +1 for comma
    }
  }

  private findClasses(source: string, lines: string[], definitions: SymbolDefinition[]): void {
    const regex = new RegExp(PythonAnalyzer.CLASS_DEF.source, 'gm');
    let match: RegExpExecArray | null;
    
    while ((match = regex.exec(source)) !== null) {
      const name = match[2];
      const nameStart = match.index + match[1].length + 6; // 'class ' length
      const namePosition = this.getLineColumn(source, nameStart);
      
      definitions.push({
        name,
        startLine: namePosition.line,
        startColumn: namePosition.column,
        endLine: namePosition.line,
        endColumn: namePosition.column + name.length,
        kind: 'class'
      });
    }
  }

  private findVariables(source: string, lines: string[], definitions: SymbolDefinition[]): void {
    const regex = new RegExp(PythonAnalyzer.VARIABLE_ASSIGNMENT.source, 'gm');
    let match: RegExpExecArray | null;
    const seenNames = new Set<string>();
    
    while ((match = regex.exec(source)) !== null) {
      const indent = match[1];
      const name = match[2];
      
      // Only top-level and class-level assignments (indent 0 or 4 spaces)
      if (indent.length > 4) continue;
      
      // Skip if we've already seen this name at this level
      const key = `${indent.length}:${name}`;
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      
      // Skip special names
      if (name.startsWith('_') && name !== '_') continue;
      
      const nameStart = match.index + indent.length;
      const namePosition = this.getLineColumn(source, nameStart);
      
      definitions.push({
        name,
        startLine: namePosition.line,
        startColumn: namePosition.column,
        endLine: namePosition.line,
        endColumn: namePosition.column + name.length,
        kind: 'variable'
      });
    }
  }

  private findImports(source: string, lines: string[], definitions: SymbolDefinition[]): void {
    // Handle 'from X import Y' style imports
    const fromRegex = new RegExp(PythonAnalyzer.IMPORT_FROM.source, 'gm');
    let match: RegExpExecArray | null;
    
    while ((match = fromRegex.exec(source)) !== null) {
      const importList = match[2];
      const position = this.getLineColumn(source, match.index);
      
      // Parse the import list (handles 'a, b, c' and 'a as b, c as d')
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
    
    // Handle 'import X' style imports
    const simpleRegex = new RegExp(PythonAnalyzer.IMPORT_SIMPLE.source, 'gm');
    while ((match = simpleRegex.exec(source)) !== null) {
      const moduleName = match[2] || match[1].split('.').pop() || match[1];
      const position = this.getLineColumn(source, match.index);
      
      definitions.push({
        name: moduleName,
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
    // Check 'from X import symbolName' pattern
    const fromPattern = new RegExp(
      `^from\\s+([\\w.]+)\\s+import\\s+.*\\b${symbolName}\\b`,
      'gm'
    );
    let match = fromPattern.exec(source);
    if (match) {
      return match[1];
    }
    
    // Check 'import X as symbolName' pattern
    const asPattern = new RegExp(
      `^import\\s+([\\w.]+)\\s+as\\s+${symbolName}\\b`,
      'gm'
    );
    match = asPattern.exec(source);
    if (match) {
      return match[1];
    }
    
    // Check if it's a direct module import
    const directPattern = new RegExp(
      `^import\\s+((?:[\\w.]*\\.)?${symbolName})(?:\\s|$)`,
      'gm'
    );
    match = directPattern.exec(source);
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
