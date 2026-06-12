export { DefinitionProvider, createDefinitionProvider } from './DefinitionProvider';
export { TsWorkerStrategy, configureTypeScriptDefaults } from './tsWorker';
export { PythonAnalyzer } from './analyzers/python/PythonAnalyzer';
export { createPythonParser, initPythonLanguage } from './analyzers/python/parser';
export { WorkspaceIndex } from './workspace/WorkspaceIndex';
export {
  resolvePythonImport,
  resolveTsImport,
  commonRoot,
  uriDirname,
  uriJoin
} from './workspace/moduleResolver';

export type { PythonParserOptions } from './analyzers/python/parser';
export type { WorkspaceIndexOptions } from './workspace/WorkspaceIndex';
export type { TsWorkerStrategyOptions } from './tsWorker';
export type {
  DefinitionLocation,
  DefinitionProviderOptions,
  FallbackNavigationHook,
  LanguageAnalyzer,
  LoadFileHook,
  PythonOptions,
  ResolveModuleUriHook,
  TypeScriptOptions,
  WorkspaceAccess,
  WorkspaceDocument
} from './types';
export type {
  DefinitionInfoLike,
  DisposableLike,
  LanguageServiceDefaultsLike,
  MonacoLike,
  PositionLike,
  TextModelLike,
  TypeScriptNamespaceLike,
  TypeScriptWorkerLike,
  UriLike
} from './monacoEnv';
