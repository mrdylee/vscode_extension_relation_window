import { CType, Location, SymbolRecord, TypedExpression } from './model';

interface ResolvedType { id: string; layers: CType['layers']; conditions: string[]; scalar?: boolean }
interface Lookup {
  symbols(name: string): SymbolRecord[];
  symbol(id: string): SymbolRecord | undefined;
  fields(id: string, name?: string): SymbolRecord[];
  visibleFiles(uri: string): Set<string>;
  identifier(name: string, location: Location): SymbolRecord[];
}

// This binds declared types, not runtime pointer values or compiler-preprocessed C.
export class MemberResolver {
  constructor(private lookup: Lookup) {}

  private namedTypes(type: CType, declaration: SymbolRecord, unitUri: string): SymbolRecord[] {
    const at = declaration.location;
    const all = this.lookup.symbols(type.name).filter(s => s.kind === 'type' && s.aggregate === type.tag && !s.memberOf);
    const scoped = all.filter(s => s.location.uri === at.uri && s.scope && s.scope.start <= at.start && s.scope.end > at.start);
    const locals = scoped.filter(s => s.location.start <= at.start);
    const selected: SymbolRecord[] = [];
    const widths = [...new Set(locals.map(s => s.scope!.end - s.scope!.start))].sort((a, b) => a - b);
    for (const width of widths) {
      // A visible forward tag can be completed later within the same scope.
      const level = (type.tag ? scoped : locals).filter(s => s.scope!.end - s.scope!.start === width);
      selected.push(...level);
      if (level.some(s => s.conditions.length === 0)) return selected;
    }
    const sameFile = all.filter(s => !s.scope && s.location.uri === at.uri && (type.tag || s.location.start <= at.start));
    // A header's opaque tag can be completed by the consuming C file. Only
    // global tags participate here; local typedef shadows keep declaration scope.
    const visible = this.lookup.visibleFiles(type.tag ? unitUri : at.uri);
    const outer = all.filter(s => !s.scope && visible.has(s.location.uri) && (s.location.uri !== at.uri || type.tag || s.location.start <= at.start));
    if (type.tag && !locals.length) {
      // `struct T *p` introduces a local tag only if no outer T is visible.
      // A later definition in that same block completes it, not a later global T.
      const earlier = outer.filter(s => s.location.uri !== at.uri || s.location.start <= at.start);
      const later = scoped.filter(s => s.definition && s.location.start > at.start &&
        s.scope!.start === declaration.scope?.start && s.scope!.end === declaration.scope?.end);
      if (later.length && !earlier.some(s => s.conditions.length === 0)) {
        return [...later, ...earlier];
      }
    }
    if (sameFile.some(s => s.conditions.length === 0 && (!type.tag || s.definition))) return [...selected, ...sameFile];
    return [...selected, ...outer];
  }

  private normalize(type: CType | undefined, declaration: SymbolRecord, unitUri: string, seen = new Set<string>(), depth = 0): ResolvedType[] {
    if (!type || depth >= 32) return [];
    const targets = type.id ? [this.lookup.symbol(type.id)].filter((s): s is SymbolRecord => !!s) : this.namedTypes(type, declaration, unitUri);
    if (!targets.length) return [{ id: '', layers: type.layers, conditions: [], scalar: /^(?:(?:signed|unsigned|short|long)\s+)*(?:void|char|int|float|double|_Bool|bool|signed|unsigned|short|long)$/.test(type.name) }];
    const result: ResolvedType[] = [];
    for (const symbol of targets.slice(0, 64)) {
      if (seen.has(symbol.id)) continue;
      if (symbol.aggregate) {
        if (symbol.definition) result.push({ id: symbol.id, layers: type.layers, conditions: symbol.conditions });
      } else {
        for (const base of this.normalize(symbol.type, symbol, unitUri, new Set(seen).add(symbol.id), depth + 1)) {
          result.push({ ...base, layers: [...type.layers, ...base.layers], conditions: [...symbol.conditions, ...base.conditions] });
        }
      }
      if (result.length >= 64) break;
    }
    return result.slice(0, 64);
  }

  private expressionTypes(expression: TypedExpression, depth: number, unitUri: string): ResolvedType[] {
    if (depth >= 32) return [];
    if (expression.kind === 'identifier') {
      return this.lookup.identifier(expression.name, expression.location).flatMap(s =>
        this.normalize(s.type, s, unitUri).map(t => ({ ...t, conditions: [...s.conditions, ...t.conditions] }))).slice(0, 64);
    }
    if (expression.kind === 'member') {
      return this.members(expression, depth + 1, unitUri).flatMap(s =>
        this.normalize(s.type, s, unitUri).map(t => ({ ...t, conditions: [...s.conditions, ...t.conditions] }))).slice(0, 64);
    }
    const types = this.expressionTypes(expression.object, depth + 1, unitUri);
    if (expression.kind === 'address') return types.map(t => ({ ...t, layers: ['pointer', ...t.layers] }));
    return types.filter(t => t.layers[0] === 'pointer' || t.layers[0] === 'array').map(t => ({ ...t, layers: t.layers.slice(1) }));
  }

  members(expression: Extract<TypedExpression, { kind: 'member' }>, depth = 0, unitUri?: string): SymbolRecord[] {
    if (depth >= 32) return [];
    let base: TypedExpression = expression;
    while (base.kind !== 'identifier') base = base.object;
    unitUri ??= base.location.uri;
    const result = new Map<string, SymbolRecord>();
    for (const type of this.expressionTypes(expression.object, depth + 1, unitUri)) {
      const valid = expression.arrow
        ? type.layers.length === 1 && (type.layers[0] === 'pointer' || type.layers[0] === 'array')
        : type.layers.length === 0;
      if (!valid) continue;
      for (const field of this.lookup.fields(type.id, expression.name)) {
        result.set(field.id, { ...field, conditions: [...new Set([...field.conditions, ...type.conditions])] });
      }
    }
    return [...result.values()].slice(0, 64);
  }
  layout(symbol: SymbolRecord) {
    const seen = new Set<string>();
    return this.normalize(symbol.type, symbol, symbol.location.uri).filter(type => {
      const key = type.id + '/' + type.layers.join(',') + '/' + type.scalar;
      if (seen.has(key)) return false; seen.add(key); return true;
    }).map(type => ({ ...type, fields: this.lookup.fields(type.id) }));
  }
}
