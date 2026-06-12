import type { Node, Tree } from 'web-tree-sitter';

/** 0-based tree-sitter position. */
export interface Point {
  row: number;
  column: number;
}

export type BindingKind = 'function' | 'class' | 'parameter' | 'variable' | 'import';

export interface Binding {
  name: string;
  kind: BindingKind;
  /** Position of the *name* node (0-based, tree-sitter convention). */
  start: Point;
  end: Point;
  /** Import bindings: dotted module path as written (may have leading dots). */
  importPath?: string;
  /** From-import bindings: the original name in the target module. */
  importedName?: string;
}

export type ScopeKind = 'module' | 'function' | 'class' | 'lambda' | 'comprehension';

export interface Scope {
  kind: ScopeKind;
  /** The AST node that opens this scope. */
  node: Node;
  parent: Scope | null;
  children: Scope[];
  bindings: Map<string, Binding[]>;
  /** Names declared `global` in this scope. */
  globals: Set<string>;
  /** Names declared `nonlocal` in this scope. */
  nonlocals: Set<string>;
}

/** Build the full scope tree with all name bindings for a parsed module. */
export function buildScopeTree(tree: Tree): Scope {
  const root: Scope = makeScope('module', tree.rootNode, null);
  for (const child of tree.rootNode.namedChildren) {
    if (child) visit(child, root);
  }
  return root;
}

function makeScope(kind: ScopeKind, node: Node, parent: Scope | null): Scope {
  const scope: Scope = {
    kind,
    node,
    parent,
    children: [],
    bindings: new Map(),
    globals: new Set(),
    nonlocals: new Set()
  };
  parent?.children.push(scope);
  return scope;
}

function addBinding(scope: Scope, binding: Binding): void {
  const list = scope.bindings.get(binding.name);
  if (list) {
    list.push(binding);
  } else {
    scope.bindings.set(binding.name, [binding]);
  }
}

function bindingFromNameNode(nameNode: Node, kind: BindingKind, extra?: Partial<Binding>): Binding {
  return {
    name: nameNode.text,
    kind,
    start: nameNode.startPosition,
    end: nameNode.endPosition,
    ...extra
  };
}

function visit(node: Node, scope: Scope): void {
  switch (node.type) {
    case 'function_definition': {
      const nameNode = node.childForFieldName('name');
      if (nameNode) addBinding(scope, bindingFromNameNode(nameNode, 'function'));
      const fnScope = makeScope('function', node, scope);
      const params = node.childForFieldName('parameters');
      if (params) bindParameters(params, fnScope);
      // Default values and annotations evaluate in the *enclosing* scope,
      // but for navigation purposes visiting them in the function scope is
      // harmless (they contain references, not bindings).
      const body = node.childForFieldName('body');
      if (body) visitChildren(body, fnScope);
      return;
    }

    case 'class_definition': {
      const nameNode = node.childForFieldName('name');
      if (nameNode) addBinding(scope, bindingFromNameNode(nameNode, 'class'));
      const classScope = makeScope('class', node, scope);
      const body = node.childForFieldName('body');
      if (body) visitChildren(body, classScope);
      return;
    }

    case 'lambda': {
      const lambdaScope = makeScope('lambda', node, scope);
      const params = node.childForFieldName('parameters');
      if (params) bindParameters(params, lambdaScope);
      const body = node.childForFieldName('body');
      if (body) visit(body, lambdaScope);
      return;
    }

    case 'list_comprehension':
    case 'set_comprehension':
    case 'dictionary_comprehension':
    case 'generator_expression': {
      const compScope = makeScope('comprehension', node, scope);
      visitChildren(node, compScope);
      return;
    }

    case 'assignment':
    case 'augmented_assignment': {
      const left = node.childForFieldName('left');
      if (left) bindTargetPattern(left, scope, 'variable');
      const right = node.childForFieldName('right');
      if (right) visit(right, scope);
      return;
    }

    case 'named_expression': {
      // Walrus operator binds in the nearest enclosing non-comprehension scope.
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        let target = scope;
        while (target.kind === 'comprehension' && target.parent) {
          target = target.parent;
        }
        addBinding(target, bindingFromNameNode(nameNode, 'variable'));
      }
      const value = node.childForFieldName('value');
      if (value) visit(value, scope);
      return;
    }

    case 'for_statement':
    case 'for_in_clause': {
      const left = node.childForFieldName('left');
      if (left) bindTargetPattern(left, scope, 'variable');
      for (const child of node.namedChildren) {
        if (child && child !== left) visit(child, scope);
      }
      return;
    }

    case 'as_pattern': {
      // Covers `with x as y` and `except E as y`. Import aliases are handled
      // by the import cases and never reach here.
      const alias = node.childForFieldName('alias');
      const aliasIdent = alias?.type === 'identifier' ? alias : alias?.namedChildren[0];
      if (aliasIdent?.type === 'identifier') {
        addBinding(scope, bindingFromNameNode(aliasIdent, 'variable'));
      }
      const valueChild = node.namedChildren[0];
      if (valueChild && valueChild !== alias) visit(valueChild, scope);
      return;
    }

    case 'import_statement': {
      // `import a.b.c [as d]` — binds `a` (or the alias).
      for (const child of node.namedChildren) {
        if (!child) continue;
        if (child.type === 'aliased_import') {
          const aliasNode = child.childForFieldName('alias');
          const moduleNode = child.childForFieldName('name');
          if (aliasNode && moduleNode) {
            addBinding(
              scope,
              bindingFromNameNode(aliasNode, 'import', { importPath: moduleNode.text })
            );
          }
        } else if (child.type === 'dotted_name') {
          const first = child.namedChildren[0];
          if (first?.type === 'identifier') {
            addBinding(scope, bindingFromNameNode(first, 'import', { importPath: child.text }));
          }
        }
      }
      return;
    }

    case 'import_from_statement': {
      const moduleNode = node.childForFieldName('module_name');
      const importPath = moduleNode?.text ?? '';
      for (const child of node.namedChildren) {
        if (!child || child === moduleNode) continue;
        if (child.type === 'aliased_import') {
          const aliasNode = child.childForFieldName('alias');
          const nameNode = child.childForFieldName('name');
          if (aliasNode && nameNode) {
            addBinding(
              scope,
              bindingFromNameNode(aliasNode, 'import', {
                importPath,
                importedName: nameNode.text
              })
            );
          }
        } else if (child.type === 'dotted_name' || child.type === 'identifier') {
          const nameIdent = child.type === 'identifier' ? child : child.namedChildren[0];
          if (nameIdent?.type === 'identifier') {
            addBinding(
              scope,
              bindingFromNameNode(nameIdent, 'import', {
                importPath,
                importedName: child.text
              })
            );
          }
        }
        // wildcard_import is intentionally skipped — nothing nameable to bind.
      }
      return;
    }

    case 'global_statement': {
      for (const child of node.namedChildren) {
        if (child?.type === 'identifier') scope.globals.add(child.text);
      }
      return;
    }

    case 'nonlocal_statement': {
      for (const child of node.namedChildren) {
        if (child?.type === 'identifier') scope.nonlocals.add(child.text);
      }
      return;
    }

    default:
      visitChildren(node, scope);
  }
}

function visitChildren(node: Node, scope: Scope): void {
  for (const child of node.namedChildren) {
    if (child) visit(child, scope);
  }
}

/** Bind all identifiers in an assignment/for target pattern. */
function bindTargetPattern(node: Node, scope: Scope, kind: BindingKind): void {
  switch (node.type) {
    case 'identifier':
      addBinding(scope, bindingFromNameNode(node, kind));
      return;
    case 'pattern_list':
    case 'tuple_pattern':
    case 'list_pattern':
      for (const child of node.namedChildren) {
        if (child) bindTargetPattern(child, scope, kind);
      }
      return;
    case 'list_splat_pattern': {
      const inner = node.namedChildren[0];
      if (inner) bindTargetPattern(inner, scope, kind);
      return;
    }
    // attribute (obj.x = …) and subscript (obj[i] = …) targets don't bind names.
    default:
      return;
  }
}

/** Bind function/lambda parameters into the function's scope. */
function bindParameters(params: Node, scope: Scope): void {
  for (const param of params.namedChildren) {
    if (!param) continue;
    switch (param.type) {
      case 'identifier':
        addBinding(scope, bindingFromNameNode(param, 'parameter'));
        break;
      case 'default_parameter':
      case 'typed_default_parameter': {
        const nameNode = param.childForFieldName('name');
        if (nameNode?.type === 'identifier') {
          addBinding(scope, bindingFromNameNode(nameNode, 'parameter'));
        }
        break;
      }
      case 'typed_parameter': {
        const inner = param.namedChildren[0];
        if (inner?.type === 'identifier') {
          addBinding(scope, bindingFromNameNode(inner, 'parameter'));
        }
        break;
      }
      case 'list_splat_pattern':
      case 'dictionary_splat_pattern': {
        const inner = param.namedChildren[0];
        if (inner?.type === 'identifier') {
          addBinding(scope, bindingFromNameNode(inner, 'parameter'));
        }
        break;
      }
      // keyword_separator (*) and positional_separator (/) bind nothing.
    }
  }
}

/** Innermost scope whose node contains the given position. */
export function scopeAt(root: Scope, position: Point): Scope {
  let current = root;
  let descended = true;
  while (descended) {
    descended = false;
    for (const child of current.children) {
      if (nodeContains(child.node, position)) {
        current = child;
        descended = true;
        break;
      }
    }
  }
  return current;
}

function nodeContains(node: Node, position: Point): boolean {
  const { startPosition: s, endPosition: e } = node;
  if (position.row < s.row || position.row > e.row) return false;
  if (position.row === s.row && position.column < s.column) return false;
  if (position.row === e.row && position.column >= e.column) return false;
  return true;
}

function comparePoints(a: Point, b: Point): number {
  return a.row !== b.row ? a.row - b.row : a.column - b.column;
}

/**
 * Resolve a name reference following Python scoping rules:
 * - walk from the innermost scope outward;
 * - `global` jumps straight to module scope; `nonlocal` skips to enclosing
 *   function scopes only;
 * - class scopes are invisible to code nested inside them (methods don't see
 *   class-level names), except when the reference sits directly in the class body;
 * - within a scope, prefer the last binding before the reference, falling back
 *   to the first binding (forward references to module-level functions).
 */
export function resolveName(startScope: Scope, name: string, reference: Point): Binding | null {
  let scope: Scope | null = startScope;
  let isStartScope = true;

  while (scope) {
    if (scope.globals.has(name)) {
      let moduleScope: Scope = scope;
      while (moduleScope.parent) moduleScope = moduleScope.parent;
      return pickBinding(moduleScope.bindings.get(name), reference);
    }

    if (scope.nonlocals.has(name)) {
      let enclosing = scope.parent;
      while (enclosing) {
        if (enclosing.kind === 'function' || enclosing.kind === 'lambda') {
          const found = pickBinding(enclosing.bindings.get(name), reference);
          if (found) return found;
        }
        if (enclosing.kind === 'module') break;
        enclosing = enclosing.parent;
      }
      return null;
    }

    const skipClassScope = scope.kind === 'class' && !isStartScope;
    if (!skipClassScope) {
      const found = pickBinding(scope.bindings.get(name), reference);
      if (found) return found;
    }

    scope = scope.parent;
    isStartScope = false;
  }
  return null;
}

function pickBinding(bindings: Binding[] | undefined, reference: Point): Binding | null {
  if (!bindings || bindings.length === 0) return null;
  let best: Binding | null = null;
  for (const binding of bindings) {
    if (comparePoints(binding.start, reference) <= 0) {
      best = binding; // bindings are added in document order; keep the last one before the reference
    }
  }
  return best ?? bindings[0];
}

/** Look up a module-level (exported) binding by name. */
export function findModuleBinding(root: Scope, name: string): Binding | null {
  const bindings = root.bindings.get(name);
  if (!bindings || bindings.length === 0) return null;
  // Prefer real definitions over import re-bindings.
  return bindings.find(b => b.kind !== 'import') ?? bindings[0];
}
