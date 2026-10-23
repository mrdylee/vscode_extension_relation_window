import { Minimatch } from 'minimatch';
import { FileAnalysisPolicy } from './model';

export interface LegacyAnalysisPolicy { macroFolders: readonly string[]; analyzeCallbacks: boolean }
interface AnalysisConfiguration {
  get<T>(key: string, fallback: T): T;
  inspect?(key: string): { globalValue?: unknown; workspaceValue?: unknown; workspaceFolderValue?: unknown } | undefined;
}
const legacyKeys = new Set(['macroExpansionFolders', 'analyzeCallbacks', 'detailedAnalysisFolders', 'copilotCallbacks', 'copilotInclude', 'copilotExclude']);
export function analysisConfiguration(current: AnalysisConfiguration, previous: AnalysisConfiguration): AnalysisConfiguration {
  const inspect = (key: string) => {
    const entry = current.inspect?.(key); if (!legacyKeys.has(key)) return entry;
    const old = previous.inspect?.(key);
    return { globalValue: entry?.globalValue ?? old?.globalValue, workspaceValue: entry?.workspaceValue ?? old?.workspaceValue,
      workspaceFolderValue: entry?.workspaceFolderValue ?? old?.workspaceFolderValue };
  };
  return { get: <T>(key: string, fallback: T) => {
    if (!legacyKeys.has(key)) return current.get(key, fallback);
    const entry = inspect(key);
    return (entry?.workspaceFolderValue ?? entry?.workspaceValue ?? entry?.globalValue ?? current.get(key, previous.get(key, fallback))) as T;
  }, inspect };
}
export function configured<T>(config: AnalysisConfiguration, key: string): T | undefined {
  const entry = config.inspect?.(key);
  return entry && [entry.globalValue, entry.workspaceValue, entry.workspaceFolderValue].some(value => value !== undefined)
    ? config.get<T | undefined>(key, undefined) : undefined;
}
export function smartAnalysisScope(config: AnalysisConfiguration) {
  const include = configured<string[]>(config, 'smartAnalysis.include');
  return { include: include ?? configured<string[]>(config, 'detailedAnalysisFolders'),
    exclude: config.get<string[]>('smartAnalysis.exclude', []), unified: include !== undefined };
}
export function resolveAnalysisPolicy(relativePath: string, detailedFolders: readonly string[] | undefined,
  legacy?: LegacyAnalysisPolicy, nocase = false, exclude: readonly string[] = [], macro = true): FileAnalysisPolicy {
  const matches = (patterns: readonly string[]) => patterns.some(pattern => new Minimatch(pattern,
    { dot: true, nonegate: true, nocomment: true, noext: true, nocase }).match(relativePath.replace(/\\/g, '/')));
  if (!macro || matches(exclude)) return { expandMacros: false, propagateCallbacks: false };
  if (detailedFolders !== undefined) {
    const enabled = matches(detailedFolders);
    return { expandMacros: enabled, propagateCallbacks: enabled };
  }
  return { expandMacros: legacy ? matches(legacy.macroFolders) : false, propagateCallbacks: legacy?.analyzeCallbacks ?? false };
}
