export type Kind = 'function' | 'variable' | 'type' | 'macro' | 'unknown';
export type RelationMode = 'references' | 'callers' | 'callees' | 'both';
export type CalleeSort = 'name' | 'source';
export type CallKind = 'direct' | 'macro' | 'indirect' | 'unresolved' | 'expanded' | 'inferred' | 'ai-candidate' | 'registered';
export type Access = 'read' | 'write' | 'readwrite' | 'address';
export type AccessFilter = 'all' | Access;
export interface CType {
  name: string; tag?: 'struct' | 'union' | 'enum'; id?: string;
  layers: ('pointer' | 'array' | 'function')[];
}
export type TypedExpression =
  | { kind: 'identifier'; name: string; location: Location }
  | { kind: 'type'; type: CType; location: Location; scope?: { start: number; end: number } }
  | { kind: 'member'; object: TypedExpression; name: string; arrow: boolean }
  | { kind: 'position'; object: TypedExpression; index: number }
  | { kind: 'call'; object: TypedExpression }
  | { kind: 'index'; object: TypedExpression; initializer?: boolean }
  | { kind: 'dereference' | 'address'; object: TypedExpression };
export interface Location {
  uri: string; start: number; end: number; line: number; column: number;
  endLine: number; endColumn: number;
}
export interface SymbolRecord {
  id: string; name: string; kind: Kind; location: Location; extent: Location;
  definition: boolean; storage: 'static' | 'global' | 'local';
  scope?: { start: number; end: number }; conditions: string[]; pointer: boolean;
  type?: CType; aggregate?: CType['tag']; memberOf?: string; containerName?: string;
  anonymousMemberOf?: string;
}
export interface ReferenceRecord {
  id: string; name: string; kind: 'call' | 'reference' | 'declaration';
  location: Location; ownerId?: string; functionId?: string; targetId?: string; access?: Access; conditions: string[]; indirect?: boolean;
  member?: Extract<TypedExpression, { kind: 'member' }>;
  expansion?: { chain: { name: string; location: Location }[]; text: string };
  callKind?: CallKind;
  macroIds?: string[];
  flowKey?: string;
  inference?: { expression: string; evidence: { location: Location; reason: string }[]; incomplete: boolean; reasons: string[] };
  argument?: { callee: string; position: number; location: Location; inferred?: boolean };
  unresolvedKind?: Kind;
}
export interface CallbackTargets {
  location: Location; expression: string; targets: SymbolRecord[];
  incomplete: boolean; reasons: string[];
}
export type FlowExpression = { location: Location } & (
  | { kind: 'name'; name: string; localId?: string; alternatives?: string[]; globalFallback?: boolean }
  | { kind: 'number'; value: string }
  | { kind: 'member'; object: FlowExpression; field: string; arrow: boolean }
  | { kind: 'index'; object: FlowExpression; index: FlowExpression }
  | { kind: 'address' | 'dereference' | 'cast'; object: FlowExpression }
  | { kind: 'choice' | 'sequence'; values: FlowExpression[] }
  | { kind: 'assign'; left: FlowExpression; right: FlowExpression; operator: string }
  | { kind: 'call'; callee: FlowExpression; args: FlowExpression[]; key: string }
  | { kind: 'initializer'; entries: { path: (string | number)[]; value: FlowExpression }[] }
  | { kind: 'unknown'; children?: FlowExpression[] });
export type FlowStatement =
  | { kind: 'expression' | 'return'; value: FlowExpression }
  | { kind: 'branch'; condition: FlowExpression; then: FlowStatement[]; otherwise: FlowStatement[] }
  | { kind: 'loop'; condition: FlowExpression; body: FlowStatement[] };
export interface FlowLocal { id: string; name: string; type?: CType; location: Location; scope: { start: number; end: number }; parameter?: number; conditions?: string[]; persistent?: boolean }
export interface FlowProgram { id: string; locals: FlowLocal[]; params: string[]; body: FlowStatement[] }
export interface GlobalInitializer { id: string; value: FlowExpression; location: Location }
export interface MacroDefinition {
  name: string; parameters?: string[]; variadic?: string; body: string;
  location: Location; conditions: string[];
}
export type PreprocessorEvent =
  | { kind: 'define'; location: Location; conditions: string[]; macro: MacroDefinition }
  | { kind: 'undef'; location: Location; conditions: string[]; name: string }
  | { kind: 'include'; location: Location; conditions: string[]; path: string; system: boolean };
export interface FunctionBody { id: string; location: Location; body: Location }
export interface CallbackDiagnostic {
  kind: 'memory' | 'time' | 'work' | 'mutation' | 'loop' | 'array' | 'propagation';
  stage: 'setup' | 'initializers' | 'propagation';
  message: string; location?: Location; symbol?: string;
  elapsedMs: number; scopeElapsedMs: number;
  evaluations: number; scopeEvaluations: number; slots?: number;
}
export interface FileAnalysis {
  uri: string; text: string; symbols: SymbolRecord[]; references: ReferenceRecord[];
  includes: string[]; issues: string[]; systemIncludes?: string[];
  preprocessor?: PreprocessorEvent[]; functions?: FunctionBody[];
  inactive?: { start: number; end: number }[];
  directives?: { start: number; end: number }[];
  guard?: { name: string; condition: string };
  projectScoped?: boolean;
  expandMacros?: boolean;
  programs?: FlowProgram[]; initializers?: GlobalInitializer[];
  argumentPrograms?: FlowProgram[];
  functionArguments?: ReferenceRecord[];
  callbackRegistrations?: ReferenceRecord[];
  callbackDiagnostics?: CallbackDiagnostic[];
  statementConditions?: { start: number; conditions: string[] }[];
}
export interface RelationSite extends ReferenceRecord { ambiguous: boolean; candidates: string[] }
export interface RelationGroup {
  key: string; symbol?: SymbolRecord; name: string; kind: Kind; sites: RelationSite[]; callKind?: CallKind;
}
export interface GraphNode {
  key: string; symbolId?: string; name: string; kind: Kind; location: Location;
  definition?: boolean;
  callKind?: CallKind;
  direction?: 'callers' | 'callees';
  containerName?: string;
  conditions: string[]; sites: Omit<RelationSite, 'candidates'>[]; children: GraphNode[];
  cycle: boolean; expanded: boolean; ambiguous: boolean;
}
export interface GraphData { root: GraphNode; callers?: GraphNode[]; truncated: boolean }
