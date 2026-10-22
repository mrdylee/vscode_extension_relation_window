import { CallbackDiagnostic, AccessFilter, CallbackTargets, CalleeSort, GraphData, GraphNode, Location, RelationMode, SymbolRecord } from './model';
import { SyntaxToken } from './syntax';
import { Diagnostics } from './diagnostics';

export function nodePreviewId(node: GraphNode): string | undefined {
  if (['ai-candidate','user-confirmed'].includes(node.callKind??'') && node.symbolId) return node.symbolId;
  return node.callKind || node.direction || node.sites.some(site => site.argument || site.callKind === 'registered') || node.sites[0]?.access
    ? node.sites[0]?.id : node.symbolId ?? node.sites[0]?.id;
}
export function canExpandNode(node: GraphNode): boolean {
  return !!node.symbolId && !node.cycle && (!node.callKind || ['direct', 'expanded', 'inferred', 'ai-candidate', 'user-confirmed'].includes(node.callKind));
}
export interface Preview { location: Location; text: string; tokens: SyntaxToken[][]; firstLine: number; path: string; label: string }
export type ContextLayout = 'combined' | 'combined-full-width' | 'combined-keep-left-sidebar' | 'combined-center' | 'combined-keep-right-sidebar' | 'separate';
export interface ViewState {
  graph?: GraphData; context?: Preview; candidates: SymbolRecord[];
  callback?: CallbackTargets;
  callbackDiagnostics?: CallbackDiagnostic[];
  status: string; fileCount: number; issues: string[];
  mode: RelationMode; accessFilter: AccessFilter; depth: number; locked: boolean; skipInactive: boolean;
  calleeSort: CalleeSort; contextLayout: ContextLayout;
  callGraphDirection: 'callers-left' | 'callees-left';
  includeFunctionArguments: boolean; analyzeCallbacks: boolean;
  diagnostics?: Diagnostics;
}
