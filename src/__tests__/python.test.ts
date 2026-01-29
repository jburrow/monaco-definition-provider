import { describe, it, expect } from 'vitest';
import { PythonAnalyzer } from '../analyzers/python';

describe('PythonAnalyzer', () => {
  const analyzer = new PythonAnalyzer();

  describe('findDefinitions', () => {
    it('should find function definitions', () => {
      const source = `
def hello():
    pass

def greet(name):
    print(name)
`;
      const defs = analyzer.findDefinitions(source);
      
      const funcs = defs.filter(d => d.kind === 'function');
      expect(funcs.length).toBe(2);
      expect(funcs.map(f => f.name)).toContain('hello');
      expect(funcs.map(f => f.name)).toContain('greet');
    });

    it('should find class definitions', () => {
      const source = `
class MyClass:
    pass

class AnotherClass(BaseClass):
    def method(self):
        pass
`;
      const defs = analyzer.findDefinitions(source);
      
      const classes = defs.filter(d => d.kind === 'class');
      expect(classes.length).toBe(2);
      expect(classes.map(c => c.name)).toContain('MyClass');
      expect(classes.map(c => c.name)).toContain('AnotherClass');
    });

    it('should find variable definitions', () => {
      const source = `
x = 10
y: int = 20
name = "hello"
`;
      const defs = analyzer.findDefinitions(source);
      
      const vars = defs.filter(d => d.kind === 'variable');
      expect(vars.length).toBe(3);
      expect(vars.map(v => v.name)).toContain('x');
      expect(vars.map(v => v.name)).toContain('y');
      expect(vars.map(v => v.name)).toContain('name');
    });

    it('should find imports', () => {
      const source = `
from os import path
from typing import List, Dict
import json
import numpy as np
`;
      const defs = analyzer.findDefinitions(source);
      
      const imports = defs.filter(d => d.kind === 'import');
      expect(imports.length).toBeGreaterThanOrEqual(4);
      expect(imports.map(i => i.name)).toContain('path');
      expect(imports.map(i => i.name)).toContain('List');
      expect(imports.map(i => i.name)).toContain('json');
      expect(imports.map(i => i.name)).toContain('np');
    });
  });

  describe('getSymbolAtPosition', () => {
    it('should get symbol at cursor position', () => {
      const source = `def hello():
    pass`;
      
      // Position on 'hello' (line 1, column 5)
      const symbol = analyzer.getSymbolAtPosition(source, 1, 5);
      expect(symbol).toBe('hello');
    });

    it('should get partial word at boundary position', () => {
      const source = `def hello():
    pass`;
      
      // Position before 'hello' on 'def'
      const symbol = analyzer.getSymbolAtPosition(source, 1, 3);
      expect(symbol).toBe('def');
    });

    it('should handle middle of word', () => {
      const source = `variable_name = 10`;
      
      const symbol = analyzer.getSymbolAtPosition(source, 1, 8);
      expect(symbol).toBe('variable_name');
    });
  });

  describe('getImportPath', () => {
    it('should find import path for from imports', () => {
      const source = `from os.path import join`;
      
      const path = analyzer.getImportPath(source, 'join');
      expect(path).toBe('os.path');
    });

    it('should find import path for aliased imports', () => {
      const source = `import numpy as np`;
      
      const path = analyzer.getImportPath(source, 'np');
      expect(path).toBe('numpy');
    });

    it('should return null for local symbols', () => {
      const source = `
def local_func():
    pass
`;
      const path = analyzer.getImportPath(source, 'local_func');
      expect(path).toBeNull();
    });
  });
});
