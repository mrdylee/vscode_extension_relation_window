export type Kind = 'function' | 'variable' | 'type' | 'macro' | 'unknown';
export type RelationMode = 'references' | 'callers' | 'callees';
export type CallKind = 'direct' | 'macro' | 'indirect' | 'unresolved' | 'expanded' | 'inferred';
export type Access = 'read' | 'write' | 'readwrite' | 'address';
export type AccessFilter = 'all' | Access;
export interface CType {
  name: string; tag?: 'struct' | 'union' | 'enum'; id?: string;
  layers: ('pointer' | 'array' | 'function')[];
}
export type TypedExpression =
  | { kind: 'identifier'; name: string; location: Location }
  | { kind: 'member'; object: TypedExpression; name: string; arrow: boolean }
  | { kind: 'index' | 'dereference' | 'address'; object: TypedExpression };
export interface Location {
  uri: string; start: number; end: number; line: number; column: number;
  endLine: number; endColumn: number;
}
export interface SymbolRecord {
  id: string; name: string; kind: Kind; location: Location; extent: Location;
  definition: boolean; storage: 'static' | 'global' | 'local';
  scope?: { start: number; end: number }; conditions: string[]; pointer: boolean;
  type?: CType; aggregate?: CType['tag']; memberOf?: string; containerName?: string;
}
export interface ReferenceRecord {
  id: string; name: string; kind: 'call' | 'reference' | 'declaration';
  location: Location; ownerId?: string; functionId?: string; targetId?: string; access?: Access; conditions: string[]; indirect?: boolean;
  member?: Extract<TypedExpression, { kind: 'member' }>;
  expansion?: { chain: { name: string; location: Location }[]; text: string };
  callKind?: CallKind;
  macroIds?: string[];
}
export interface MacroDefinition {
  name: string; parameters?: string[]; variadic?: string; body: string;
  location: Location; conditions: string[];
}
export type PreprocessorEvent =
  | { kind: 'define'; location: Location; conditions: string[]; macro: MacroDefinition }
  | { kind: 'undef'; location: Location; conditions: string[]; name: string }
  | { kind: 'include'; location: Location; conditions: string[]; path: string; system: boolean };
export interface FunctionBody { id: string; location: Location; body: Location }
export interface FileAnalysis {
  uri: string; text: string; symbols: SymbolRecord[]; references: ReferenceRecord[];
  includes: string[]; issues: string[]; systemIncludes?: string[];
  preprocessor?: PreprocessorEvent[]; functions?: FunctionBody[];
  inactive?: { start: number; end: number }[];
  directives?: { start: number; end: number }[];
  guard?: { name: string; condition: string };
  projectScoped?: boolean;
}
export interface RelationSite extends ReferenceRecord { ambiguous: boolean; candidates: string[] }
export interface RelationGroup {
  key: string; symbol?: SymbolRecord; name: string; kind: Kind; sites: RelationSite[]; callKind?: CallKind;
}
export interface GraphNode {
  key: string; symbolId?: string; name: string; kind: Kind; location: Location;
  definition?: boolean;
  callKind?: CallKind;
  containerName?: string;
  conditions: string[]; sites: RelationSite[]; children: GraphNode[];
  cycle: boolean; expanded: boolean; ambiguous: boolean;
}
export interface GraphData { root: GraphNode; truncated: boolean }
