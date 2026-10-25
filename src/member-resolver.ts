import { CType, Location, SymbolRecord, TypedExpression, locationKey } from './model';

interface ResolvedType { id: string; name?: string; tag?: CType['tag']; layers: CType['layers']; conditions: string[]; scalar?: boolean }
type TypeContext = Pick<SymbolRecord, 'location' | 'scope'>;
interface Lookup {
  symbols(name: string): SymbolRecord[];
  symbol(id: string): SymbolRecord | undefined;
  fields(id: string, name?: string): SymbolRecord[];
  anonymous(id: string): SymbolRecord[];
  visibleFiles(uri: string): Set<string>;
  identifier(name: string, location: Location): SymbolRecord[];
}

// This binds declared types, not runtime pointer values or compiler-preprocessed C.
export class MemberResolver {
  constructor(private lookup: Lookup) {}

  private namedTypes(type: CType, declaration: TypeContext, unitUri: string): SymbolRecord[] {
    const at = declaration.location;
    const all = this.lookup.symbols(type.name).filter(s => s.kind === 'type' && s.aggregate === type.tag && !s.memberOf);
    const scoped = all.filter(s => locationKey(s.location) === locationKey(at) && s.scope && s.scope.start <= at.start && s.scope.end > at.start);
    const locals = scoped.filter(s => s.location.start <= at.start);
    const selected: SymbolRecord[] = [];
    const widths = [...new Set(locals.map(s => s.scope!.end - s.scope!.start))].sort((a, b) => a - b);
    for (const width of widths) {
      // A visible forward tag can be completed later within the same scope.
      const level = (type.tag ? scoped : locals).filter(s => s.scope!.end - s.scope!.start === width);
      selected.push(...level);
      if (level.some(s => s.conditions.length === 0)) return selected;
    }
    const sameFile = all.filter(s => !s.scope && locationKey(s.location) === locationKey(at) && (type.tag || s.location.start <= at.start));
    // A header's opaque tag can be completed by the consuming C file. Only
    // global tags participate here; local typedef shadows keep declaration scope.
    const visible = this.lookup.visibleFiles(type.tag ? unitUri : locationKey(at));
    const outer = all.filter(s => !s.scope && visible.has(locationKey(s.location)) && (locationKey(s.location) !== locationKey(at) || type.tag || s.location.start <= at.start));
    if (type.tag && !locals.length) {
      // `struct T *p` introduces a local tag only if no outer T is visible.
      // A later definition in that same block completes it, not a later global T.
      const earlier = outer.filter(s => locationKey(s.location) !== locationKey(at) || s.location.start <= at.start);
      const later = scoped.filter(s => s.definition && s.location.start > at.start &&
        s.scope!.start === declaration.scope?.start && s.scope!.end === declaration.scope?.end);
      if (later.length && !earlier.some(s => s.conditions.length === 0)) {
        return [...later, ...earlier];
      }
    }
    if (sameFile.some(s => s.conditions.length === 0 && (!type.tag || s.definition))) return [...selected, ...sameFile];
    return [...selected, ...outer];
  }

  private normalize(type: CType | undefined, declaration: TypeContext, unitUri: string, seen = new Set<string>(), depth = 0): ResolvedType[] {
    if (!type || depth >= 32) return [];
    const targets = type.id ? [this.lookup.symbol(type.id)].filter((s): s is SymbolRecord => !!s) : this.namedTypes(type, declaration, unitUri);
    if (!targets.length) return [{ id: '', name: type.name, tag: type.tag, layers: type.layers, conditions: [],
      scalar: type.tag === 'enum' || (!type.tag && (/^(?:(?:signed|unsigned|short|long)\s+)*(?:char|int|float|double|_Bool|bool|signed|unsigned|short|long)$/.test(type.name) ||
        /^(?:u?int(?:(?:_least|_fast)?(?:8|16|32|64)|ptr|max)_t|size_t|ssize_t|ptrdiff_t|wchar_t|wint_t|char16_t|char32_t)$/.test(type.name))) }];
    const result: ResolvedType[] = [];
    for (const symbol of targets.slice(0, 64)) {
      if (seen.has(symbol.id)) continue;
      if (symbol.aggregate) {
        // A forward declaration has no fields, but still preserves pointer and
        // function-return layers needed to follow an explicitly initialized object.
        result.push({ id: symbol.id, name: symbol.name, tag: symbol.aggregate, layers: type.layers, conditions: symbol.conditions, scalar: symbol.aggregate === 'enum' });
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
    if (expression.kind === 'type') return this.normalize(expression.type, expression, unitUri);
    if (expression.kind === 'identifier') {
      return this.lookup.identifier(expression.name, expression.location).flatMap(s =>
        this.normalize(s.type, s, unitUri).map(t => ({ ...t, conditions: [...s.conditions, ...t.conditions] }))).slice(0, 64);
    }
    if (expression.kind === 'member') {
      return this.members(expression, depth + 1, unitUri).flatMap(s =>
        this.normalize(s.type, s, unitUri).map(t => ({ ...t, conditions: [...s.conditions, ...t.conditions] }))).slice(0, 64);
    }
    const types = this.expressionTypes(expression.object, depth + 1, unitUri);
    if (expression.kind === 'call') return types.flatMap(type => {
      const count = type.layers[0] === 'function' ? 1 : type.layers[0] === 'pointer' && type.layers[1] === 'function' ? 2 : 0;
      return count ? [{ ...type, layers: type.layers.slice(count) }] : [];
    });
    if (expression.kind === 'position') return types.flatMap(type => {
      if (type.layers[0] === 'array') return [{ ...type, layers: type.layers.slice(1) }];
      if (type.layers.length) return [];
      if (this.lookup.symbol(type.id)?.aggregate === 'union' && expression.index !== 0) return [];
      const fields = [...this.lookup.fields(type.id), ...this.lookup.anonymous(type.id)].sort((a, b) => a.location.start - b.location.start);
      if (fields.some(field => field.conditions.some(condition => !type.conditions.includes(condition)))) return [];
      const field = fields[expression.index];
      const declared = field?.anonymousMemberOf ? { name: field.name, id: field.id, layers: [] } : field?.type;
      return field ? this.normalize(declared, field, unitUri).map(value => ({ ...value, conditions: [...type.conditions, ...field.conditions, ...value.conditions] })) : [];
    }).slice(0, 64);
    if (expression.kind === 'address') return types.map(t => ({ ...t, layers: ['pointer', ...t.layers] }));
    return types.filter(t => t.layers[0] === 'array' || (t.layers[0] === 'pointer' && !(expression.kind === 'index' && expression.initializer)))
      .map(t => ({ ...t, layers: t.layers.slice(1) }));
  }

  private promotedFields(id: string, name: string, depth: number): SymbolRecord[] {
    if (depth >= 32) return [];
    const fields = [...this.lookup.fields(id, name)];
    for (const member of this.lookup.anonymous(id)) {
      fields.push(...this.promotedFields(member.id, name, depth + 1).map(field =>
        ({ ...field, conditions: [...member.conditions, ...field.conditions] })));
      if (fields.length >= 64) break;
    }
    return fields.slice(0, 64);
  }

  members(expression: Extract<TypedExpression, { kind: 'member' }>, depth = 0, unitUri?: string): SymbolRecord[] {
    if (depth >= 32) return [];
    let base: TypedExpression = expression;
    while (base.kind !== 'identifier' && base.kind !== 'type') base = base.object;
    unitUri ??= locationKey(base.location);
    const result = new Map<string, SymbolRecord>();
    for (const type of this.expressionTypes(expression.object, depth + 1, unitUri)) {
      const valid = expression.arrow
        ? type.layers.length === 1 && (type.layers[0] === 'pointer' || type.layers[0] === 'array')
        : type.layers.length === 0;
      if (!valid) continue;
      for (const field of this.promotedFields(type.id, expression.name, depth + 1)) {
        result.set(field.id, { ...field, conditions: [...new Set([...field.conditions, ...type.conditions])] });
      }
    }
    return [...result.values()].slice(0, 64);
  }
  layout(symbol: SymbolRecord) {
    const seen = new Set<string>();
    return this.normalize(symbol.type, symbol, locationKey(symbol.location)).filter(type => {
      const key = type.id + '/' + type.layers.join(',') + '/' + type.scalar;
      if (seen.has(key)) return false; seen.add(key); return true;
    }).map(type => ({ ...type, fields: this.lookup.fields(type.id) }));
  }
}
