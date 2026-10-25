import { AccessFilter, CallbackTargets, CalleeSort, FileAnalysis, GraphData, GraphNode, ReferenceRecord, RelationGroup, RelationMode, SymbolRecord, fileKey, locationKey } from './model';
import { MemberResolver } from './member-resolver';

const callsiteKey = (ref: ReferenceRecord) => `${locationKey(ref.location)}:${ref.location.start}:${ref.location.end}`;
const callbackTargetKey = (ref: ReferenceRecord) => `${callsiteKey(ref)}:${ref.targetId}`;

// Keep each file's contribution separate so edits never rebuild unrelated files.
class FileBuckets<T extends { name: string }> {
  private names = new Map<string, Map<string, T[]>>();
  private cache = new Map<string, T[]>();
  clear() { this.names.clear(); this.cache.clear(); }
  add(uri: string, records: T[]) {
    for (const record of records) {
      let files = this.names.get(record.name);
      if (!files) this.names.set(record.name, files = new Map());
      let bucket = files.get(uri);
      if (!bucket) files.set(uri, bucket = []);
      bucket.push(record);
      this.cache.delete(record.name);
    }
  }
  remove(uri: string, records: T[]) {
    for (const name of new Set(records.map(record => record.name))) {
      const files = this.names.get(name);
      files?.delete(uri);
      if (!files?.size) this.names.delete(name);
      this.cache.delete(name);
    }
  }
  get(name: string, order: Map<string, number>): T[] {
    let records = this.cache.get(name);
    if (!records) {
      records = [...(this.names.get(name) ?? [])]
        .sort(([a], [b]) => order.get(a)! - order.get(b)!).flatMap(([, values]) => values);
      this.cache.set(name, records);
    }
    return records;
  }
  inFile(name: string, uri: string): T[] { return this.names.get(name)?.get(uri) ?? []; }
}

export class RelationIndex {
  files = new Map<string, FileAnalysis>();
  private byName = new FileBuckets<SymbolRecord>();
  private byId = new Map<string, SymbolRecord>();
  private references = new FileBuckets<ReferenceRecord>();
  private outgoing = new Map<string, ReferenceRecord[]>();
  private functionArguments = new FileBuckets<ReferenceRecord>();
  private callbackRegistrations = new FileBuckets<ReferenceRecord>();
  private outgoingArguments = new Map<string, ReferenceRecord[]>();
  private members = new Map<string, Map<string, SymbolRecord[]>>();
  private anonymousMembers = new Map<string, SymbolRecord[]>();
  private filesByName = new Map<string, Set<string>>();
  private visibility = new Map<string, Set<string>>();
  private layouts = new Map<string, { type: SymbolRecord['type']; value: ReturnType<MemberResolver['layout']> }>();
  private memberResolver = new MemberResolver({
    symbols: name => this.byName.get(name, this.fileOrder),
    symbol: id => this.byId.get(id),
    fields: (id, name) => name === undefined ? [...(this.members.get(id)?.values() ?? [])].flat() : this.members.get(id)?.get(name) ?? [],
    anonymous: id => this.anonymousMembers.get(id) ?? [],
    visibleFiles: uri => this.visibleFiles(uri),
    identifier: (name, location) => this.resolve({ id: '', name, location, kind: 'reference', conditions: [] })
  });
  private fileOrder = new Map<string, number>();
  private nextOrder = 0;
  private targets = new Map<string, { definitions: SymbolRecord[]; headerStatics: SymbolRecord[]; declarations: SymbolRecord[] }>();
  clear() {
    this.files.clear(); this.byName.clear(); this.byId.clear(); this.references.clear();
    this.fileOrder.clear(); this.nextOrder = 0; this.targets.clear(); this.outgoing.clear();
    this.functionArguments.clear(); this.outgoingArguments.clear();
    this.callbackRegistrations.clear();
    this.members.clear(); this.anonymousMembers.clear(); this.filesByName.clear(); this.visibility.clear();
    this.layouts.clear();
  }
  update(file: FileAnalysis) {
    const previous = this.files.get(fileKey(file));
    if (previous) this.unindex(previous);
    else this.fileOrder.set(fileKey(file), this.nextOrder++);
    this.files.set(fileKey(file), file);
    this.layouts.clear();
    this.visibility.clear();
    const basename = file.uri.split('/').pop()!;
    let paths = this.filesByName.get(basename);
    if (!paths) this.filesByName.set(basename, paths = new Set());
    paths.add(fileKey(file));
    for (const symbol of file.symbols) {
      this.byId.set(symbol.id, symbol); this.targets.delete(symbol.name);
      if (symbol.anonymousMemberOf) {
        const members = this.anonymousMembers.get(symbol.anonymousMemberOf) ?? [];
        members.push(symbol); this.anonymousMembers.set(symbol.anonymousMemberOf, members);
      }
      if (symbol.memberOf) {
        let fields = this.members.get(symbol.memberOf);
        if (!fields) this.members.set(symbol.memberOf, fields = new Map());
        const named = fields.get(symbol.name) ?? [];
        named.push(symbol); fields.set(symbol.name, named);
      }
    }
    this.byName.add(fileKey(file), file.symbols);
    this.references.add(fileKey(file), file.references);
    this.functionArguments.add(fileKey(file), file.functionArguments ?? []);
    this.callbackRegistrations.add(fileKey(file), file.callbackRegistrations ?? []);
    for (const ref of file.functionArguments ?? []) {
      if (!ref.functionId) continue;
      let argumentsFound = this.outgoingArguments.get(ref.functionId);
      if (!argumentsFound) this.outgoingArguments.set(ref.functionId, argumentsFound = []);
      argumentsFound.push(ref);
    }
    for (const ref of [...file.references, ...(file.callbackRegistrations ?? [])]) {
      // The analyzer leaves access unset inside unevaluated sizeof/alignof expressions.
      if (!ref.functionId || (ref.callKind !== 'registered' && (ref.kind !== 'call' || !ref.access))) continue;
      let calls = this.outgoing.get(ref.functionId);
      if (!calls) this.outgoing.set(ref.functionId, calls = []);
      calls.push(ref);
    }
  }
  remove(uri: string) {
    const previous = this.files.get(uri);
    if (!previous) return;
    this.unindex(previous); this.files.delete(uri); this.fileOrder.delete(uri);
  }
  private unindex(file: FileAnalysis) {
    this.layouts.clear();
    this.visibility.clear();
    const basename = file.uri.split('/').pop()!;
    const paths = this.filesByName.get(basename);
    paths?.delete(fileKey(file));
    if (!paths?.size) this.filesByName.delete(basename);
    for (const symbol of file.symbols) { this.byId.delete(symbol.id); this.targets.delete(symbol.name); this.outgoing.delete(symbol.id); this.outgoingArguments.delete(symbol.id); this.members.delete(symbol.id); this.anonymousMembers.delete(symbol.id); }
    this.byName.remove(fileKey(file), file.symbols);
    this.references.remove(fileKey(file), file.references);
    this.functionArguments.remove(fileKey(file), file.functionArguments ?? []);
    this.callbackRegistrations.remove(fileKey(file), file.callbackRegistrations ?? []);
  }
  symbols(): SymbolRecord[] { return [...this.byId.values()]; }
  symbol(id: string) { return this.byId.get(id); }
  linkageUncertain(location: import('./model').Location, target: SymbolRecord) {
    const source=this.files.get(locationKey(location))?.context,other=this.files.get(locationKey(target.location))?.context;
    return !!source&&!!other&&source.unitId!==other.unitId;
  }
  resolveReference(ref: ReferenceRecord) { return this.resolve(ref); }
  layout(symbol: SymbolRecord) {
    const previous = this.layouts.get(symbol.id);
    if (previous && previous.type === symbol.type) return previous.value;
    const value = this.memberResolver.layout(symbol);
    this.layouts.set(symbol.id, { type: symbol.type, value }); return value;
  }
  private visibleFiles(uri: string): Set<string> {
    const cached = this.visibility.get(uri);
    if (cached) return cached;
    const visible = new Set([uri]), queue = [uri];
    for (let i = 0; i < queue.length; i++) {
      const context = this.files.get(queue[i])?.context;
      if (context) { for (const include of context.prepared.resolvedIncludes) if (include.key && !visible.has(include.key)) { visible.add(include.key); queue.push(include.key); } continue; }
      for (const include of this.files.get(queue[i])?.includes ?? []) {
        const relative = new URL(include, queue[i]).href;
        const quoted = !this.files.get(queue[i])?.systemIncludes?.includes(include);
        const matches = quoted && this.files.has(relative) ? [relative] : [...(this.filesByName.get(encodeURIComponent(include.split('/').pop()!)) ?? [])]
          .filter(candidate => decodeURIComponent(candidate).endsWith('/' + include));
        for (const candidate of matches) if (!visible.has(candidate)) { visible.add(candidate); queue.push(candidate); }
      }
    }
    this.visibility.set(uri, visible);
    return visible;
  }
  private targetsFor(name: string) {
    let targets = this.targets.get(name);
    if (!targets) {
      const all = this.byName.get(name, this.fileOrder).filter(s => !s.memberOf);
      targets = {
        definitions: all.filter(s => s.storage === 'global' && s.definition && s.kind !== 'type'),
        headerStatics: all.filter(s => s.storage === 'static' && /\.h$/i.test(s.location.uri)),
        declarations: all.filter(s => (s.kind === 'function' || s.kind === 'variable') && !s.definition && !s.scope)
      };
      this.targets.set(name, targets);
    }
    return targets;
  }
  private resolve(ref: ReferenceRecord): SymbolRecord[] {
    if (ref.indirect) return [];
    if (ref.member) return this.memberResolver.members(ref.member);
    if (ref.targetId) {
      const target = this.byId.get(ref.targetId);
      return target ? [target] : [];
    }
    if (ref.macroIds?.length) return [...ref.macroIds.map(id => this.byId.get(id)).filter((symbol): symbol is SymbolRecord => !!symbol),
      ...(ref.macroUncertain ? this.resolve({ ...ref, macroIds: [], macroUncertain: false }) : [])];
    const macroIds = ref.macroIds ?? (this.files.get(locationKey(ref.location))?.projectScoped ? [] : undefined);
    const active = (symbol: SymbolRecord) => symbol.kind !== 'macro' || !macroIds || macroIds.includes(symbol.id);
    const here = this.byName.inFile(ref.name, locationKey(ref.location)).filter(s => !s.memberOf && s.kind !== 'type' && active(s));
    const locals = here.filter(s => s.scope && s.scope.start <= ref.location.start && s.scope.end > ref.location.start && s.location.start <= ref.location.start);
    let localTargets: SymbolRecord[] = [], externDeclarations: SymbolRecord[] = [];
    const widths = [...new Set(locals.map(s => s.scope!.end - s.scope!.start))].sort((a, b) => a - b);
    for (const width of widths) {
      const nearest = locals.filter(s => s.scope!.end - s.scope!.start === width);
      const externs = nearest.filter(s => !s.definition && (s.storage === 'global' || s.kind === 'function'));
      externDeclarations.push(...externs);
      localTargets.push(...nearest.filter(s => !externs.includes(s)));
      // Conditional shadows may be absent, so keep searching enclosing scopes.
      if (nearest.some(s => s.conditions.length === 0)) {
        if (!externDeclarations.length) return localTargets;
        // Block extern declarations also need the linked file/global candidates.
        break;
      }
    }
    const statics = here.filter(s => s.storage === 'static' && s.definition);
    // A conditional definition may be absent; retain lower-priority candidates.
    if (statics.some(s => s.conditions.length === 0)) return [...localTargets, ...statics];
    const sameFile = here.filter(s => s.storage === 'global' && s.definition && s.kind !== 'type');
    if (sameFile.some(s => s.conditions.length === 0)) return [...localTargets, ...statics, ...sameFile];
    const targets = this.targetsFor(ref.name);
    const definitions = targets.definitions.filter(active), { headerStatics, declarations } = targets;
    // A header-local static is only a candidate in files that include that header.
    const included = headerStatics.filter(s => this.visibleFiles(locationKey(ref.location)).has(locationKey(s.location)));
    if (definitions.length || included.length) return [...localTargets, ...statics, ...definitions, ...included];
    return [...localTargets, ...externDeclarations, ...statics, ...declarations.filter(s =>
      (s.storage !== 'static' || s.location.uri === ref.location.uri))];
  }
  fileAt(uri: string, context?: string) { return this.files.get(context ?? uri) ?? [...this.files.values()].find(file => file.uri === uri && (!context || file.context?.unitId === context)); }
  contextsAt(uri: string) { return [...this.files.values()].filter(file => file.uri === uri); }
  resolveAt(uri: string, offset: number): SymbolRecord[] {
    if (!this.files.has(uri)) return this.contextsAt(uri).flatMap(file => this.resolveAt(fileKey(file), offset));
    const file = this.files.get(uri);
    if (!file) return [];
    const contains = (s: { location: { start: number; end: number } }) => s.location.start <= offset && offset < s.location.end;
    const symbol = file.symbols.find(contains);
    if (symbol?.definition) return [symbol];
    const ref = file.references.find(ref => !ref.indirect && !['inferred', 'ai-candidate', 'user-confirmed', 'registered'].includes(ref.callKind ?? '') && contains(ref));
    return ref ? this.resolve(ref) : symbol ? [symbol] : [];
  }
  callbackAt(uri: string, offset: number): CallbackTargets | undefined {
    if (!this.files.has(uri)) {
      const choices = this.contextsAt(uri).flatMap(file => {const value = this.callbackAt(fileKey(file), offset); return value ? [value] : [];});
      if (!choices.length) return;
      return {...choices[0], targets:[...new Map(choices.flatMap(value => value.targets).map(target => [target.id,target])).values()], incomplete:choices.some(value => value.incomplete), reasons:[...new Set(choices.flatMap(value => value.reasons))]};
    }
    const file = this.files.get(uri);
    if (!file) return;
    const calls = file.references.filter(ref => ref.kind === 'call' && ref.access && !ref.expansion &&
      ref.location.start <= offset && offset < ref.location.end &&
      (['inferred', 'ai-candidate', 'user-confirmed', 'registered'].includes(ref.callKind ?? '') || ref.indirect || this.resolve(ref).some(s => s.kind === 'variable')));
    const first = calls.sort((a, b) => (a.location.end - a.location.start) - (b.location.end - b.location.start))[0];
    if (!first) return;
    // In factory()(), selecting factory belongs to the inner direct call.
    if (file.references.some(ref => ref.kind !== 'declaration' && !ref.indirect && !['inferred', 'ai-candidate', 'user-confirmed', 'registered'].includes(ref.callKind ?? '') &&
      ref.location.start <= offset && offset < ref.location.end &&
      ref.location.end - ref.location.start <= first.location.end - first.location.start &&
      this.resolve(ref).some(symbol => symbol.kind === 'function'))) return;
    const text = file.text.slice(first.location.start, first.location.end);
    // Trace the callee token, while objects and array indices keep normal navigation.
    let brackets = 0, token: { start: number; end: number } | undefined;
    for (const match of text.matchAll(/[A-Za-z_]\w*|\[|\]/g)) {
      if (match[0] === '[') brackets++;
      else if (match[0] === ']') brackets--;
      else if (!brackets) token = { start: first.location.start + match.index, end: first.location.start + match.index + match[0].length };
    }
    if (!token || offset < token.start || offset >= token.end) return;
    const sites = calls.filter(ref => ref.location.start === first.location.start && ref.location.end === first.location.end);
    const targets = new Map<string, SymbolRecord>();
    for (const site of sites) {
      const symbols = site.targetId ? [this.byId.get(site.targetId)] : this.resolve(site);
      for (const symbol of symbols) if (symbol?.kind === 'function') targets.set(symbol.id, symbol);
    }
    return { location: first.location, expression: first.inference?.expression ?? text,
      targets: [...targets.values()], incomplete: !targets.size || sites.some(ref => ref.callKind !== 'inferred' || ref.inference?.incomplete),
      reasons: [...new Set(sites.flatMap(ref => ref.inference?.reasons ?? []))] };
  }
  private aiReplacements(references: ReferenceRecord[]) {
    const sites = new Set<string>(), targets = new Set<string>();
    for (const ref of references) if (['ai-candidate','user-confirmed'].includes(ref.callKind??'') && this.byId.get(ref.targetId ?? '')?.kind === 'function') {
      sites.add(callsiteKey(ref)); targets.add(callbackTargetKey(ref));
    }
    return { sites, targets };
  }
  private callees(target: SymbolRecord, sort: CalleeSort, includeFunctionArguments: boolean): RelationGroup[] {
    if (target.kind !== 'function') return [];
    const groups = new Map<string, RelationGroup>();
    const calls = [...(this.outgoing.get(target.id) ?? []), ...(includeFunctionArguments ? this.outgoingArguments.get(target.id) ?? [] : [])]
      .sort((a, b) => a.location.start - b.location.start);
    const ai = this.aiReplacements(calls);
    for (const ref of calls) {
      if (!ref.argument && ref.kind === 'call' && (ref.callKind === 'inferred' || ref.callKind === 'registered') && ai.targets.has(callbackTargetKey(ref))) continue;
      const candidates = this.resolve(ref);
      // Replace only this invocation's unresolved/indirect presentation. Keep raw
      // references for cursor tracing, variable uses, AI context and hint removal.
      const replaced = !ref.argument && ref.kind === 'call' && ai.sites.has(callsiteKey(ref));
      if (replaced && !candidates.length) continue;
      const candidateIds = candidates.map(s => s.id);
      const linkage=candidates.some(symbol=>this.linkageUncertain(ref.location,symbol));
      const site=linkage?{...ref,inference:{expression:ref.inference?.expression??ref.name,evidence:ref.inference?.evidence??[],incomplete:true,reasons:[...new Set([...(ref.inference?.reasons??[]),'Build link membership is not verified across translation units'])]}}:ref;
      const ambiguous = linkage || ref.callKind === 'inferred' || !!ref.argument?.inferred || !!ref.inference?.incomplete || !!ref.macroUncertain || candidates.length > 1 || candidates.some(s => s.conditions.length > 0) || ref.conditions.length > 0;
      if (candidates.length > 1 && candidates.every(symbol => symbol.kind === 'macro')) {
        const key = `macro:${ref.name}:${[...candidateIds].sort().join('|')}`;
        const group = groups.get(key) ?? { key, name: ref.name, kind: 'macro' as const, callKind: 'macro' as const, sites: [], definitionCandidates: candidates };
        group.sites.push({ ...site, access: undefined, candidates: candidateIds, ambiguous }); groups.set(key, group); continue;
      }
      for (const symbol of candidates.length ? candidates : [undefined]) {
        if (replaced && symbol?.kind === 'variable') continue;
        const callKind = ref.argument ? undefined : ref.indirect || symbol?.kind === 'variable' ? 'indirect'
          : symbol?.kind === 'function' ? ref.callKind ?? 'direct' : symbol?.kind === 'macro' ? 'macro' : 'unresolved';
        const key = symbol?.id ?? `${callKind}:${ref.name}`;
        const group: RelationGroup = groups.get(key) ?? { key, symbol, name: symbol?.name ?? ref.name,
          kind: symbol?.kind ?? ref.unresolvedKind ?? 'unknown', sites: [], callKind };
        group.callKind ??= callKind;
        if (group.callKind === 'registered' && ref.kind === 'call') group.callKind = callKind;
        group.sites.push({ ...site, access: undefined, candidates: candidateIds, ambiguous });
        groups.set(key, group);
      }
    }
    const result = [...groups.values()];
    return sort === 'source' ? result : result.sort((a, b) => a.name.localeCompare(b.name));
  }
  relations(id: string, mode: RelationMode, filter: AccessFilter = 'all', sort: CalleeSort = 'name', includeFunctionArguments = false): RelationGroup[] {
    const target = this.byId.get(id);
    if (!target) return [];
    if (mode === 'callees' && target.kind !== 'variable') return this.callees(target, sort, includeFunctionArguments);
    const groups = new Map<string, RelationGroup>();
    const argumentsFound = includeFunctionArguments && target.kind === 'function' && (mode === 'callers' || mode === 'both')
      ? this.functionArguments.get(target.name, this.fileOrder) : [];
    const references = [...this.references.get(target.name, this.fileOrder),
      ...(target.kind === 'function' && (mode === 'callers' || mode === 'both') ? this.callbackRegistrations.get(target.name, this.fileOrder) : [])];
    const ai = target.kind === 'function' ? this.aiReplacements(references).targets : undefined;
    for (const ref of argumentsFound.length ? [...references, ...argumentsFound] : references) {
      if (!ref.argument && ref.kind === 'call' && (ref.callKind === 'inferred' || ref.callKind === 'registered') && ai?.has(callbackTargetKey(ref))) continue;
      const variable = target.kind === 'variable';
      if (variable) {
        if (!ref.access || (filter !== 'all' && ref.access !== filter &&
          !(ref.access === 'readwrite' && (filter === 'read' || filter === 'write')))) continue;
      } else {
        if ((mode === 'callers' || mode === 'both') && (((ref.kind !== 'call' || !ref.access) && !ref.argument && ref.callKind !== 'registered') || target.kind !== 'function')) continue;
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
      const linkage=this.linkageUncertain(ref.location,target);
      const site=linkage?{...ref,inference:{expression:ref.inference?.expression??ref.name,evidence:ref.inference?.evidence??[],incomplete:true,reasons:[...new Set([...(ref.inference?.reasons??[]),'Build link membership is not verified across translation units'])]}}:ref;
      group.sites.push({ ...site, access: variable ? ref.access : undefined,
          ambiguous: linkage || ref.callKind === 'inferred' || !!ref.argument?.inferred || !!ref.inference?.incomplete || !!ref.macroUncertain || (!!ref.argument && ref.conditions.length > 0) || candidates.length > 1 || conditional || headerStatic, candidates: candidates.map(s => s.id) });
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  graph(id: string, mode: RelationMode, depth: number, expanded: Record<string, number> = {}, filter: AccessFilter = 'all', sort: CalleeSort = 'name', includeFunctionArguments = false): GraphData | undefined {
    const rootSymbol = this.byId.get(id);
    if (!rootSymbol) return undefined;
    if (rootSymbol.kind === 'variable' && (mode === 'callees' || mode === 'both')) mode = 'callers';
    const both = mode === 'both';
    let count = 0, truncated = false;
    const make = (symbol: SymbolRecord | undefined, group: RelationGroup | undefined, key: string, remaining: number, path: Set<string>, direction: Exclude<RelationMode, 'both'>, limit: number): GraphNode => {
      const cycle = !!symbol && path.has(symbol.id);
      const node: GraphNode = { key, symbolId: symbol?.id, name: symbol?.memberOf ? `${symbol.containerName}.${symbol.name}` : symbol?.name ?? group!.name,
        kind: symbol?.kind ?? group!.kind, location: symbol?.location ?? group!.sites[0].location,
        definition: symbol?.definition ?? (group?.sites.every(site => site.kind === 'declaration') ? false : undefined),
        callKind: group?.callKind,
        direction: both && key !== 'root' ? direction as 'callers' | 'callees' : undefined,
        containerName: symbol?.containerName,
        definitionCandidates: group?.definitionCandidates?.map(({ id, location, conditions }) => ({ id, location, conditions })),
        // Candidate IDs are resolver metadata; the view only needs ambiguity and actual sites.
        conditions: symbol?.conditions ?? [], sites: group?.sites.map(({ candidates, ...site }) => site) ?? [], children: [], cycle,
        expanded: false, ambiguous: group?.sites.some(s => s.ambiguous) ?? false };
      count++;
      const levels = key in expanded ? expanded[key] : remaining;
      if (symbol && levels > 0 && !cycle && (direction !== 'callees' || symbol.kind === 'function')) {
        node.expanded = true;
        const nextPath = new Set(path).add(symbol.id);
        for (const child of this.relations(symbol.id, direction, key === 'root' ? filter : 'all', sort, includeFunctionArguments)) {
          if (count >= limit) { truncated = true; break; }
          const childKey = both && key === 'root' ? `${direction}:${child.key}` : child.key;
          node.children.push(make(child.symbol, child, `${key}/${encodeURIComponent(childKey)}`, levels - 1, nextPath, direction, limit));
        }
      }
      return node;
    };
    const levels = Math.max(0, Math.min(8, depth));
    const root = make(rootSymbol, undefined, 'root', levels, new Set(), mode === 'both' ? 'callees' : mode, both ? 151 : 300);
    const callers: GraphNode[] | undefined = both ? [] : undefined;
    if (callers && (expanded.root ?? levels) > 0) {
      for (const child of this.relations(id, 'callers', 'all', 'name', includeFunctionArguments)) {
        if (count >= 300) { truncated = true; break; }
        callers.push(make(child.symbol, child, `root/${encodeURIComponent('callers:' + child.key)}`,
          (expanded.root ?? levels) - 1, new Set([id]), 'callers', 300));
      }
    }
    return { root, callers, truncated };
  }
}
