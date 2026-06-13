# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 2.0.0 — 2026-06-13

First public release. A ground-up rewrite of an earlier, unpublished regex-based
prototype (referred to as "v1" in the migration notes).

### Added

- **Scope-aware Python analysis** via [web-tree-sitter](https://www.npmjs.com/package/web-tree-sitter)
  and the prebuilt `tree-sitter-python` grammar. Resolution follows real Python
  scoping — shadowing, `global`/`nonlocal`, class-scope skipping from methods,
  comprehension scopes, walrus targets, parameters — plus the full import matrix
  (relative, aliased, multi-line, and `module.symbol` attribute access).
- **TypeScript/JavaScript navigation** delegated to Monaco's built-in TypeScript
  language service, augmented with lazy loading of not-yet-open files via the
  `loadFile` hook (the worker is re-queried after the file is loaded for a precise
  location).
- **Lazy multi-file workspace**: `WorkspaceIndex` tracks open models and resolves
  imports against them first, then through the host's `loadFile` hook. New
  `resolveModuleUri` and `fallbackNavigation` hooks cover custom layouts.
- **Dual ESM/CJS build** via tsup with per-condition type definitions; the
  `tree-sitter-python.wasm` grammar is shipped in the package and exposed at
  `monaco-definition-provider/tree-sitter-python.wasm`.
- **Generated API reference** (TypeDoc) and a **live demo** that dogfoods the
  provider on the library's own source, both published to GitHub Pages.
- Integration guide ([docs/INTEGRATION.md](docs/INTEGRATION.md)) and CI running
  lint, tests, build, `publint`, and `arethetypeswrong` on Node 20 and 22.

### Changed (relative to the unpublished v1 prototype)

- `DefinitionProvider` now takes the host's `monaco` namespace as its first
  constructor argument, eliminating the duplicate-monaco bundling hazard and
  making the core testable under Node.
- `onExternalNavigation` is replaced by `loadFile` (return file *content* and get
  exact positions for free) and `fallbackNavigation` (return a location yourself).
- `createDefinitionProvider(languages, options)` →
  `createDefinitionProvider(monaco, languages, options)`.
- Regex analyzers and the synchronous `findDefinitions`/`getSymbolAtPosition`
  interface are replaced by tree-sitter (Python) and the TypeScript language
  service; `LanguageAnalyzer` is now a single async `provideDefinition`.

### Removed

- The `includeBuiltins` option (was declared but never implemented).
