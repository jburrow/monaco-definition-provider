import { describe, it, expect } from 'vitest';
import { TypeScriptAnalyzer } from '../analyzers/typescript';

describe('TypeScriptAnalyzer', () => {
  const analyzer = new TypeScriptAnalyzer();

  describe('findDefinitions', () => {
    it('should find function declarations', () => {
      const source = `
function hello() {
  return 'hello';
}

async function greet(name: string) {
  console.log(name);
}
`;
      const defs = analyzer.findDefinitions(source);
      
      const funcs = defs.filter(d => d.kind === 'function');
      expect(funcs.length).toBe(2);
      expect(funcs.map(f => f.name)).toContain('hello');
      expect(funcs.map(f => f.name)).toContain('greet');
    });

    it('should find arrow functions', () => {
      const source = `
const add = (a: number, b: number) => a + b;
const multiply = (x, y) => x * y;
export const subtract = async (a: number, b: number) => a - b;
`;
      const defs = analyzer.findDefinitions(source);
      
      const funcs = defs.filter(d => d.kind === 'function');
      expect(funcs.length).toBe(3);
      expect(funcs.map(f => f.name)).toContain('add');
      expect(funcs.map(f => f.name)).toContain('multiply');
      expect(funcs.map(f => f.name)).toContain('subtract');
    });

    it('should find class declarations', () => {
      const source = `
class MyClass {
  constructor() {}
}

export class AnotherClass extends BaseClass {
  method() {}
}

abstract class AbstractClass {}
`;
      const defs = analyzer.findDefinitions(source);
      
      const classes = defs.filter(d => d.kind === 'class');
      expect(classes.length).toBe(3);
      expect(classes.map(c => c.name)).toContain('MyClass');
      expect(classes.map(c => c.name)).toContain('AnotherClass');
      expect(classes.map(c => c.name)).toContain('AbstractClass');
    });

    it('should find interface declarations', () => {
      const source = `
interface User {
  name: string;
  age: number;
}

export interface Config {
  port: number;
}
`;
      const defs = analyzer.findDefinitions(source);
      
      const interfaces = defs.filter(d => d.name === 'User' || d.name === 'Config');
      expect(interfaces.length).toBe(2);
    });

    it('should find type declarations', () => {
      const source = `
type StringOrNumber = string | number;
export type Handler = (event: Event) => void;
`;
      const defs = analyzer.findDefinitions(source);
      
      const types = defs.filter(d => d.name === 'StringOrNumber' || d.name === 'Handler');
      expect(types.length).toBe(2);
    });

    it('should find imports', () => {
      const source = `
import { readFile, writeFile } from 'fs';
import path from 'path';
import * as utils from './utils';
`;
      const defs = analyzer.findDefinitions(source);
      
      const imports = defs.filter(d => d.kind === 'import');
      expect(imports.length).toBe(4);
      expect(imports.map(i => i.name)).toContain('readFile');
      expect(imports.map(i => i.name)).toContain('writeFile');
      expect(imports.map(i => i.name)).toContain('path');
      expect(imports.map(i => i.name)).toContain('utils');
    });
  });

  describe('getSymbolAtPosition', () => {
    it('should get symbol at cursor position', () => {
      const source = `function hello() {}`;
      
      // Position on 'hello'
      const symbol = analyzer.getSymbolAtPosition(source, 1, 12);
      expect(symbol).toBe('hello');
    });

    it('should handle middle of word', () => {
      const source = `const variableName = 10`;
      
      const symbol = analyzer.getSymbolAtPosition(source, 1, 10);
      expect(symbol).toBe('variableName');
    });
  });

  describe('getImportPath', () => {
    it('should find import path for named imports', () => {
      const source = `import { readFile } from 'fs'`;
      
      const path = analyzer.getImportPath(source, 'readFile');
      expect(path).toBe('fs');
    });

    it('should find import path for default imports', () => {
      const source = `import path from 'path'`;
      
      const importPath = analyzer.getImportPath(source, 'path');
      expect(importPath).toBe('path');
    });

    it('should find import path for namespace imports', () => {
      const source = `import * as utils from './utils'`;
      
      const path = analyzer.getImportPath(source, 'utils');
      expect(path).toBe('./utils');
    });

    it('should return null for local symbols', () => {
      const source = `
function localFunc() {}
`;
      const path = analyzer.getImportPath(source, 'localFunc');
      expect(path).toBeNull();
    });
  });
});
