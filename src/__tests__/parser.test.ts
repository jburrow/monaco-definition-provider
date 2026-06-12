import { describe, it, expect, beforeAll } from 'vitest';
import type { Parser } from 'web-tree-sitter';
import { testPythonParser } from './helpers/pythonTestParser';

describe('python tree-sitter parser', () => {
  let parser: Parser;

  beforeAll(async () => {
    parser = await testPythonParser();
  });

  it('parses python source into a tree', () => {
    const tree = parser.parse('def hello():\n    return 1\n');
    expect(tree).not.toBeNull();
    expect(tree!.rootNode.type).toBe('module');
    const fn = tree!.rootNode.namedChildren[0];
    expect(fn?.type).toBe('function_definition');
    expect(fn?.childForFieldName('name')?.text).toBe('hello');
  });

  it('reports 0-based row/column positions', () => {
    const tree = parser.parse('x = 1\ndef f():\n    pass\n');
    const fn = tree!.rootNode.namedChildren[1];
    const name = fn!.childForFieldName('name')!;
    expect(name.startPosition).toEqual({ row: 1, column: 4 });
    expect(name.endPosition).toEqual({ row: 1, column: 5 });
  });

  it('finds the node at a position', () => {
    const tree = parser.parse('value = 42\nprint(value)\n');
    const node = tree!.rootNode.descendantForPosition({ row: 1, column: 7 });
    expect(node?.type).toBe('identifier');
    expect(node?.text).toBe('value');
  });
});
