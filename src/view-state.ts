import { CallbackDiagnostic, AccessFilter, CallbackTargets, CalleeSort, GraphData, Location, RelationMode, SymbolRecord } from './model';
import { SyntaxToken } from './syntax';
import { Diagnostics } from './diagnostics';
export interface Preview { location: Location; text: string; tokens: SyntaxToken[][]; firstLine: number; path: string; label: string }
export interface ViewState {
  graph?: GraphData; context?: Preview; candidates: SymbolRecord[];
  callback?: CallbackTargets;
  callbackDiagnostics?: CallbackDiagnostic[];
  status: string; fileCount: number; issues: string[];
  mode: RelationMode; accessFilter: AccessFilter; depth: number; locked: boolean; skipInactive: boolean;
  calleeSort: CalleeSort; contextLayout: 'combined' | 'combined-full-width' | 'separate';
  callGraphDirection: 'callers-left' | 'callees-left';
  includeFunctionArguments: boolean; analyzeCallbacks: boolean;
  diagnostics?: Diagnostics;
}
