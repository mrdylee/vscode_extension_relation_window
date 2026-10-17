import { AccessFilter, FileAnalysis, GraphData, GraphNode, ReferenceRecord, RelationGroup, SymbolRecord } from './model';
export class RelationIndex {
  files = new Map<string, FileAnalysis>();
  private byName = new Map<string, SymbolRecord[]>();
  private byId = new Map<string, SymbolRecord>();
  private references = new Map<string, ReferenceRecord[]>();
  clear() { this.files.clear(); this.rebuild(); }
  update(file: FileAnalysis) { this.files.set(file.uri, file); this.rebuild(); }
  remove(uri: string) { this.files.delete(uri); this.rebuild(); }
  private rebuild() {
    this.byName.clear(); this.byId.clear(); this.references.clear();
    for (const file of this.files.values()) {
      for (const symbol of file.symbols) {
        this.byId.set(symbol.id, symbol);
        this.byName.set(symbol.name, [...(this.byName.get(symbol.name) ?? []), symbol]);
      }
      for (const ref of file.references) this.references.set(ref.name, [...(this.references.get(ref.name) ?? []), ref]);
    }
  }
  symbols(): SymbolRecord[] { return [...this.byId.values()]; }
  symbol(id: string) { return this.byId.get(id); }
  private resolve(ref: ReferenceRecord): SymbolRecord[] {
    if (ref.targetId) {
      const target = this.byId.get(ref.targetId);
      return target ? [target] : [];
    }
    const all = this.byName.get(ref.name) ?? [];
    const here = all.filter(s => s.location.uri === ref.location.uri);
    const locals = here.filter(s => s.scope && s.scope.start <= ref.location.start && s.scope.end > ref.location.start && s.location.start <= ref.location.start);
    let localTargets: SymbolRecord[] = [], externDeclarations: SymbolRecord[] = [];
    if (locals.length) {
      const width = Math.min(...locals.map(s => s.scope!.end - s.scope!.start));
      const nearest = locals.filter(s => s.scope!.end - s.scope!.start === width);
      externDeclarations = nearest.filter(s => s.storage === 'global' && !s.definition);
      if (!externDeclarations.length) return nearest;
      // Block extern declarations hide outer locals but refer to linked definitions.
      localTargets = nearest.filter(s => !externDeclarations.includes(s));
    }
    const statics = here.filter(s => s.storage === 'static' && s.definition);
    // A conditional definition may be absent; retain lower-priority candidates.
    if (statics.some(s => s.conditions.length === 0)) return [...localTargets, ...statics];
    const sameFile = here.filter(s => s.storage === 'global' && s.definition && s.kind !== 'type');
    if (sameFile.some(s => s.conditions.length === 0)) return [...localTargets, ...statics, ...sameFile];
    const definitions = all.filter(s => s.storage === 'global' && s.definition && s.kind !== 'type');
    // A header-local static is only a candidate in files that include that header.
    const included = all.filter(s => s.storage === 'static' && /\.h$/i.test(s.location.uri) &&
      this.files.get(ref.location.uri)?.includes.some(p => s.location.uri.endsWith('/' + p)));
    if (definitions.length || included.length) return [...localTargets, ...statics, ...definitions, ...included];
    return [...localTargets, ...externDeclarations, ...statics, ...all.filter(s => (s.kind === 'function' || s.kind === 'variable') && !s.definition && !s.scope &&
      (s.storage !== 'static' || s.location.uri === ref.location.uri))];
  }
  resolveAt(uri: string, offset: number): SymbolRecord[] {
    const file = this.files.get(uri);
    if (!file) return [];
    const contains = (s: { location: { start: number; end: number } }) => s.location.start <= offset && offset < s.location.end;
    const symbol = file.symbols.find(contains);
    if (symbol?.definition) return [symbol];
    const ref = file.references.find(contains);
    return ref ? this.resolve(ref) : symbol ? [symbol] : [];
  }
  relations(id: string, mode: 'references' | 'callers', filter: AccessFilter = 'all'): RelationGroup[] {
    const target = this.byId.get(id);
    if (!target) return [];
    const groups = new Map<string, RelationGroup>();
    for (const ref of this.references.get(target.name) ?? []) {
      const variable = target.kind === 'variable';
      if (variable) {
        if (!ref.access || (filter !== 'all' && ref.access !== filter &&
          !(ref.access === 'readwrite' && (filter === 'read' || filter === 'write')))) continue;
      } else {
        if (mode === 'callers' && (ref.kind !== 'call' || target.kind !== 'function')) continue;
        if (ref.location.start === target.location.start && ref.location.uri === target.location.uri) continue;
      }
      const candidates = this.resolve(ref);
      if (!candidates.some(s => s.id === id)) continue;
      const ownerId = variable ? ref.functionId ?? ref.ownerId : ref.ownerId;
      const owner = ownerId ? this.byId.get(ownerId) : undefined;
      const key = owner?.id ?? ref.id;
      const group = groups.get(key) ?? { key, symbol: owner, name: owner?.name ?? `${ref.name} (${ref.kind})`, kind: owner?.kind ?? target.kind, sites: [] };
      const conditional = candidates.some(s => s.conditions.length > 0);
      const headerStatic = candidates.some(s => s.storage === 'static' && s.location.uri !== ref.location.uri);
      group.sites.push({ ...ref, access: variable ? ref.access : undefined,
        ambiguous: candidates.length > 1 || conditional || headerStatic, candidates: candidates.map(s => s.id) });
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  graph(id: string, mode: 'references' | 'callers', depth: number, expanded: Record<string, number> = {}, filter: AccessFilter = 'all'): GraphData | undefined {
    const rootSymbol = this.byId.get(id);
    if (!rootSymbol) return undefined;
    let count = 0, truncated = false;
    const make = (symbol: SymbolRecord | undefined, group: RelationGroup | undefined, key: string, remaining: number, path: Set<string>): GraphNode => {
      const cycle = !!symbol && path.has(symbol.id);
      const node: GraphNode = { key, symbolId: symbol?.id, name: symbol?.name ?? group!.name,
        kind: symbol?.kind ?? group!.kind, location: symbol?.location ?? group!.sites[0].location,
        conditions: symbol?.conditions ?? [], sites: group?.sites ?? [], children: [], cycle,
        expanded: false, ambiguous: group?.sites.some(s => s.ambiguous) ?? false };
      count++;
      const levels = key in expanded ? expanded[key] : remaining;
      if (symbol && levels > 0 && !cycle) {
        node.expanded = true;
        const nextPath = new Set(path).add(symbol.id);
        for (const child of this.relations(symbol.id, mode, key === 'root' ? filter : 'all')) {
          if (count >= 300) { truncated = true; break; }
          node.children.push(make(child.symbol, child, `${key}/${encodeURIComponent(child.key)}`, levels - 1, nextPath));
        }
      }
      return node;
    };
    return { root: make(rootSymbol, undefined, 'root', Math.max(0, Math.min(8, depth)), new Set()), truncated };
  }
}
