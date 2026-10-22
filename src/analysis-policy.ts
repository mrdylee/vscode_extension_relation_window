import { Minimatch } from 'minimatch';
import { FileAnalysisPolicy } from './model';

export interface LegacyAnalysisPolicy { macroFolders: readonly string[]; analyzeCallbacks: boolean }
export function resolveAnalysisPolicy(relativePath: string, detailedFolders: readonly string[] | undefined,
  legacy?: LegacyAnalysisPolicy, nocase = false): FileAnalysisPolicy {
  const matches = (patterns: readonly string[]) => patterns.some(pattern => new Minimatch(pattern,
    { dot: true, nonegate: true, nocomment: true, noext: true, nocase }).match(relativePath.replace(/\\/g, '/')));
  if (detailedFolders !== undefined) {
    const enabled = matches(detailedFolders);
    return { expandMacros: enabled, propagateCallbacks: enabled };
  }
  return { expandMacros: legacy ? matches(legacy.macroFolders) : false, propagateCallbacks: legacy?.analyzeCallbacks ?? false };
}
