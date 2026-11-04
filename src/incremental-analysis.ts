import { FileAnalysis, FlowExpression, ReferenceRecord, fileKey, locationKey } from './model';
import { RelationIndex } from './relations';
import { identifier, tokenizeC } from './c-tokens';

interface Facts { uses: Set<string>; macroUses: Set<string>; pasting: Set<string>; runtime: boolean; references: ReferenceRecord[]; globalFallback: Set<string>; fields: Set<string> }
interface Group { inputs: FileAnalysis[]; members: FileAnalysis[] }
interface Component extends Group { results: FileAnalysis[]; analyzeCallbacks: boolean; complete: boolean }

// A component is deliberately conservative: unbound names, compatible struct
// members and macro bodies matter as well as currently resolved call edges.
export class IncrementalAnalysis {
  private facts = new WeakMap<FileAnalysis, Facts>();
  private cached = new Map<string, Component>();

  derive(files: FileAnalysis[], derive: (files: FileAnalysis[]) => FileAnalysis[], analyzeCallbacks = true, dependencyFiles = files): FileAnalysis[] {
    const groups = this.components(files, dependencyFiles, analyzeCallbacks), next = new Map<string, Component>();
    const unchanged = (key: string, group: Group) => {
      const previous = this.cached.get(key);
      return previous?.analyzeCallbacks === analyzeCallbacks && previous.inputs.length === group.inputs.length && group.inputs.every((file, n) => previous.inputs[n] === file);
    };
    const changed = groups.size !== this.cached.size || [...groups].some(([key, group]) => !unchanged(key, group));
    const results = new Map<string, FileAnalysis>(), dirty = new Set<FileAnalysis>();
    for (const [key, group] of groups) {
      const previous = this.cached.get(key);
      if (unchanged(key, group) && (previous!.complete || changed)) {
        next.set(key, previous!);
        previous!.results.forEach(file => results.set(fileKey(file), file));
      } else group.inputs.forEach(file => dirty.add(file));
    }
    // Keep dirty components in one batch so project work/convergence limits
    // are not multiplied by the number of components.
    if (dirty.size || !files.length) {
      const fresh = derive(files.filter(file => dirty.has(file)));
      const analyzed = new Map(fresh.map(file => [fileKey(file), file]));
      for (const [key, group] of groups) if (!next.has(key)) {
        const output = group.members.map(file => analyzed.get(fileKey(file))!);
        output.forEach(file => results.set(fileKey(file), file));
        next.set(key, { ...group, results: output, analyzeCallbacks, complete: !this.limited(group.inputs.map(file => analyzed.get(fileKey(file))!)) });
      }
    }
    this.cached = next;
    return files.map(file => results.get(fileKey(file))!);
  }

  // Only call after the disk cache has validated the complete source/settings
  // snapshot. Raw IR identities become the inputs for the first subsequent edit.
  seed(rawFiles: FileAnalysis[], derivedFiles: FileAnalysis[], analyzeCallbacks = true): void {
    this.clear();
    if (rawFiles.length !== derivedFiles.length || rawFiles.some((file, n) => fileKey(file) !== fileKey(derivedFiles[n]))) return;
    const results = new Map(derivedFiles.map(file => [fileKey(file), file]));
    for (const [key, group] of this.components(rawFiles, derivedFiles, analyzeCallbacks)) {
      this.cached.set(key, { ...group, results: group.members.map(file => results.get(fileKey(file))!), analyzeCallbacks,
        complete: !this.limited(group.inputs.map(file => results.get(fileKey(file))!)) });
    }
  }

  clear(): void { this.cached.clear(); this.facts = new WeakMap(); }

  private limited(files: FileAnalysis[]): boolean {
    return files.some(file => file.callbackDiagnostics?.some(diagnostic => ['memory', 'time', 'work', 'cancelled'].includes(diagnostic.kind)) ||
      file.issues.some(issue => /memory budget|analysis (?:time )?budget|work limit|analysis cancelled/i.test(issue)));
  }

  private dependencies(file: FileAnalysis): Facts {
    const cached = this.facts.get(file); if (cached) return cached;
    const tokens = (text: string) => tokenizeC(text, () => ({ uri: '', start: 0, end: 0, line: 0, column: 0, endLine: 0, endColumn: 0 }));
    const uses = new Set(tokens(file.context?.prepared.maskedText ?? file.text).filter(token => identifier.test(token.text)).map(token => token.text));
    file.references.forEach(ref => uses.add(ref.name));
    const references = file.references.filter(ref => ref.kind !== 'declaration'), known = new Set(references.map(ref => `${ref.name}:${ref.location.start}`));
    const fields = new Set(file.symbols.filter(symbol => symbol.memberOf).map(symbol => symbol.name));
    references.forEach(ref => { if (ref.member) fields.add(ref.member.name); });
    const pending: unknown[] = [file.programs, file.initializers, file.registrationPrograms, file.registrationInitializers, file.argumentPrograms], seen = new Set<object>(), globalFallback = new Set<string>();
    while (pending.length) {
      const value = pending.pop(); if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      const expression = value as FlowExpression;
      if (expression.kind === 'member') fields.add(expression.field);
      if (expression.kind === 'initializer') for (const entry of expression.entries) for (const part of entry.path) if (typeof part === 'string') fields.add(part);
      if (expression.kind === 'name' && (!expression.localId || expression.globalFallback)) {
        uses.add(expression.name);
        if (expression.globalFallback) globalFallback.add(expression.name);
        const key = `${expression.name}:${expression.location.start}`;
        if (!known.has(key)) { known.add(key); references.push({ id: '', name: expression.name, location: expression.location, kind: 'reference', conditions: [] }); }
      }
      for (const [key, child] of Object.entries(value)) if (key !== 'location' && child && typeof child === 'object') pending.push(child);
    }
    const macroUses = new Set<string>(), pasting = new Set<string>();
    for (const event of file.preprocessor ?? []) {
      if (event.kind !== 'define') continue;
      const body = tokens(event.macro.body), parameters = new Set([...(event.macro.parameters ?? []), event.macro.variadic]);
      for (const token of body) if (identifier.test(token.text) && !parameters.has(token.text)) macroUses.add(token.text);
      if (body.some(token => token.text === '##')) pasting.add(event.macro.name);
    }
    const runtime = !!file.functions?.length || !!file.programs?.length || !!file.initializers?.length ||
      file.symbols.some(symbol => symbol.kind === 'variable' && symbol.definition && symbol.storage !== 'local' && !symbol.memberOf);
    const facts = { uses, macroUses, pasting, runtime, references, globalFallback, fields };
    this.facts.set(file, facts); return facts;
  }

  private components(files: FileAnalysis[], dependencyFiles: FileAnalysis[], analyzeCallbacks: boolean): Map<string, Group> {
    const facts = dependencyFiles.map(file => this.dependencies(file));
    const parents = files.map((_, i) => i);
    const root = (i: number): number => {
      while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; }
      return i;
    };
    const join = (a: number, b: number) => { parents[root(a)] = root(b); };
    const context = files.map(() => new Set<number>()), contextual = new Map<string, number[]>(), values = new Map<string, number[]>();
    const uris = new Map<string, number>(), names = new Map<string, number[]>(), index = new RelationIndex();
    dependencyFiles.forEach(file => index.update(file));
    files.forEach((file, i) => {
      uris.set(fileKey(file), i);
      const name = file.uri.split('/').pop()!, matches = names.get(name) ?? [];
      matches.push(i); names.set(name, matches);
      for (const symbol of dependencyFiles[i].symbols) {
        if (symbol.storage === 'local' || symbol.memberOf) continue;
        const providers = symbol.kind === 'type' || symbol.kind === 'macro' ? contextual : values;
        const owners = providers.get(symbol.name) ?? []; owners.push(i); providers.set(symbol.name, owners);
      }
    });
    const fieldOwners = new Map<string, number[]>(), unknownFields = new Set<string>();
    facts.forEach((fact, i) => { if (fact.runtime) for (const name of fact.fields) { const owners = fieldOwners.get(name) ?? []; owners.push(i); fieldOwners.set(name, owners); } });
    dependencyFiles.forEach((file, i) => {
      for (const name of facts[i].uses) {
        const owners = contextual.get(name) ?? [];
        const headers = owners.filter(owner => /\.h$/i.test(files[owner].uri));
        const visible = file.context ? owners.filter(owner => file.context!.unitId === files[owner].context?.unitId)
          : owners.includes(i) ? [i] : headers.length ? headers : owners;
        for (const owner of visible) context[i].add(owner);
      }
      for (const ref of facts[i].references) {
        const targets = index.resolveReference(ref);
        for (const symbol of targets) {
          const owner = uris.get(locationKey(symbol.location)); if (owner === undefined || symbol.storage === 'local') continue;
          if (facts[i].runtime && !symbol.memberOf && (symbol.kind === 'variable' || symbol.kind === 'function' && symbol.definition)) join(i, owner);
          else context[i].add(owner);
        }
        if (facts[i].runtime && ref.member) {
          // Unknown aggregate declarations still share sparse field effects.
          if (!targets.some(symbol => symbol.memberOf)) unknownFields.add(ref.member.name);
        }
      }
      if (facts[i].runtime) for (const name of facts[i].globalFallback) for (const owner of values.get(name) ?? []) join(i, owner);
      if (analyzeCallbacks && dependencyFiles === files) for (const name of facts[i].macroUses) for (const owner of values.get(name) ?? []) context[i].add(owner);
      if (file.context) { for (const include of file.context.prepared.resolvedIncludes) { const target = include.key ? uris.get(include.key) : undefined; if (target !== undefined) context[i].add(target); } return; }
      for (const include of file.includes) {
        const relative = uris.get(new URL(include, file.uri).href);
        if (!file.systemIncludes?.includes(include) && relative !== undefined) { context[i].add(relative); continue; }
        for (const candidate of names.get(encodeURIComponent(include.split('/').pop()!)) ?? []) {
          if (decodeURIComponent(files[candidate].uri).endsWith('/' + include)) context[i].add(candidate);
        }
      }
    });
    for (const name of unknownFields) { const owners = fieldOwners.get(name)!; owners.forEach(owner => join(owners[0], owner)); }
    const opaque = dependencyFiles === files || dependencyFiles.some(file => file.issues.some(issue => /^Macro.*(limit|cancelled|unavailable|opaque|budget)/i.test(issue)));
    if (opaque && analyzeCallbacks && facts.some(fact => [...fact.pasting].some(name => facts.some(other => other.runtime && other.uses.has(name)))))
      files.forEach((_, i) => join(0, i));
    const groups = new Map<number, number[]>();
    files.forEach((_, i) => { const key = root(i), group = groups.get(key) ?? []; group.push(i); groups.set(key, group); });
    return new Map([...groups.values()].map(members => {
      const needed = new Set(members), pending = [...members];
      for (let n = 0; n < pending.length; n++) for (const dependency of context[pending[n]]) if (!needed.has(dependency)) { needed.add(dependency); pending.push(dependency); }
      const output = members.map(i => files[i]);
      return [JSON.stringify(output.map(fileKey)), { members: output, inputs: files.filter((_, i) => needed.has(i)) }];
    }));
  }
}
