import { AccessFilter, GraphData, Location, SymbolRecord } from './model';
import { SyntaxToken } from './syntax';
export interface Preview { location: Location; text: string; tokens: SyntaxToken[][]; firstLine: number; path: string; label: string }
export interface ViewState {
  graph?: GraphData; context?: Preview; candidates: SymbolRecord[];
  status: string; fileCount: number; issues: string[];
  mode: 'references' | 'callers'; accessFilter: AccessFilter; depth: number; locked: boolean; skipInactive: boolean;
}
