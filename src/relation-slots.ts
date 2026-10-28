import type { AccessFilter, CalleeSort, RelationMode, SymbolRecord } from './model';

export interface SavedSymbol {
  id: string; uri: string; name: string; kind: 'function' | 'variable'; start: number;
  definition: boolean; storage: SymbolRecord['storage']; sourceDigest: string;
  containerName?: string; ownerName?: string; sourceUnitUri?: string;
}
export interface SlotViewOptions {
  mode: RelationMode; depth: number; accessFilter: AccessFilter; calleeSort: CalleeSort;
  callGraphDirection: 'callers-left' | 'callees-left'; includeFunctionArguments: boolean;
}
export interface SavedBranch {
  parent: number | null; symbol: SavedSymbol; direction: 'references' | 'callers' | 'callees'; levels?: number;
}
export interface SavedSlot { target: SavedSymbol; options: SlotViewOptions; branches: SavedBranch[]; locked: boolean }
export interface SlotSummary { slot: number; name?: string; kind?: 'function' | 'variable'; locked: boolean }

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 8192;
const level = (value: unknown, min: number) => Number.isInteger(value) && Number(value) >= min && Number(value) <= 8;
function symbol(value: unknown): value is SavedSymbol {
  return object(value) && ['id', 'uri', 'name', 'sourceDigest'].every(key => text(value[key])) &&
    ['function', 'variable'].includes(value.kind as string) && ['static', 'global', 'local'].includes(value.storage as string) &&
    Number.isInteger(value.start) && Number(value.start) >= 0 && typeof value.definition === 'boolean' &&
    ['containerName', 'ownerName', 'sourceUnitUri'].every(key => value[key] === undefined || text(value[key]));
}
function slot(value: unknown): value is SavedSlot {
  if (!object(value) || !symbol(value.target) || typeof value.locked !== 'boolean' || !object(value.options)) return false;
  const o = value.options, target = value.target;
  return ['references', 'callers', 'callees', 'both'].includes(o.mode as string) && level(o.depth, 1) &&
    ['all', 'read', 'write', 'readwrite', 'address'].includes(o.accessFilter as string) &&
    ['name', 'source'].includes(o.calleeSort as string) && ['callers-left', 'callees-left'].includes(o.callGraphDirection as string) &&
    typeof o.includeFunctionArguments === 'boolean' && Array.isArray(value.branches) && value.branches.length > 0 && value.branches.length <= 300 &&
    value.branches.every((b: unknown, i: number) => object(b) && symbol(b.symbol) &&
      (i === 0 ? b.parent === null && b.symbol.id === target.id : Number.isInteger(b.parent) && Number(b.parent) >= 0 && Number(b.parent) < i) &&
      ['references', 'callers', 'callees'].includes(b.direction as string) && (b.levels === undefined || level(b.levels, 0)));
}
export function readSlots(value: unknown): (SavedSlot | null)[] {
  return Array.from({ length: 5 }, (_, i) => {
    const entry: unknown = Array.isArray(value) ? value[i] : undefined;
    return slot(entry) ? { target: { ...entry.target }, options: { ...entry.options }, locked: entry.locked,
      branches: entry.branches.map(branch => ({ ...branch, symbol: { ...branch.symbol } })) } : null;
  });
}
export function matchSavedSymbol(saved: SavedSymbol, current: SavedSymbol[]): SavedSymbol | undefined {
  const matches = current.filter(candidate => candidate.uri === saved.uri && candidate.name === saved.name &&
    candidate.kind === saved.kind && candidate.definition === saved.definition && candidate.storage === saved.storage &&
    candidate.containerName === saved.containerName && candidate.ownerName === saved.ownerName && candidate.sourceUnitUri === saved.sourceUnitUri);
  const exact = matches.filter(candidate => candidate.id === saved.id && candidate.start === saved.start && candidate.sourceDigest === saved.sourceDigest);
  return exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : undefined;
}
