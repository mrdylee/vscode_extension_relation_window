export type Kind = 'function' | 'variable' | 'type' | 'macro' | 'unknown';
export type Access = 'read' | 'write' | 'readwrite' | 'address';
export type AccessFilter = 'all' | Access;
export interface Location {
  uri: string; start: number; end: number; line: number; column: number;
  endLine: number; endColumn: number;
}
export interface SymbolRecord {
  id: string; name: string; kind: Kind; location: Location; extent: Location;
  definition: boolean; storage: 'static' | 'global' | 'local';
  scope?: { start: number; end: number }; conditions: string[]; pointer: boolean;
}
export interface ReferenceRecord {
  id: string; name: string; kind: 'call' | 'reference' | 'declaration';
  location: Location; ownerId?: string; functionId?: string; targetId?: string; access?: Access; conditions: string[];
}
export interface FileAnalysis {
  uri: string; text: string; symbols: SymbolRecord[]; references: ReferenceRecord[];
  includes: string[]; issues: string[];
}
export interface RelationSite extends ReferenceRecord { ambiguous: boolean; candidates: string[] }
export interface RelationGroup {
  key: string; symbol?: SymbolRecord; name: string; kind: Kind; sites: RelationSite[];
}
export interface GraphNode {
  key: string; symbolId?: string; name: string; kind: Kind; location: Location;
  conditions: string[]; sites: RelationSite[]; children: GraphNode[];
  cycle: boolean; expanded: boolean; ambiguous: boolean;
}
export interface GraphData { root: GraphNode; truncated: boolean }
