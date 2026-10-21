import { FileAnalysis } from './model';

interface Facts { uses: Set<string>; provides: Set<string>; paste: boolean }
interface Component { inputs: FileAnalysis[]; results: FileAnalysis[]; analyzeCallbacks: boolean }

// A component is deliberately conservative: unbound names, compatible struct
// members and macro bodies matter as well as currently resolved call edges.
export class IncrementalAnalysis {
  private facts = new WeakMap<FileAnalysis, Facts>();
  private cached = new Map<string, Component>();

  derive(files: FileAnalysis[], derive: (files: FileAnalysis[]) => FileAnalysis[], analyzeCallbacks = true): FileAnalysis[] {
    const groups = this.components(files), next = new Map<string, Component>();
    const results = new Map<string, FileAnalysis>(), dirty = new Set<FileAnalysis>();
    for (const [key, inputs] of groups) {
      const previous = this.cached.get(key);
      if (previous?.analyzeCallbacks === analyzeCallbacks && inputs.every((file, n) => previous.inputs[n] === file)) {
        next.set(key, previous);
        previous.results.forEach(file => results.set(file.uri, file));
      } else inputs.forEach(file => dirty.add(file));
    }
    // One batch retains the existing project time/work budget. Deriving each
    // dirty component separately would silently multiply that budget.
    if (dirty.size || !files.length) {
      const fresh = derive(files.filter(file => dirty.has(file)));
      fresh.forEach(file => results.set(file.uri, file));
      // Time and memory pressure are transient, not stable source properties.
      // A limited batch can affect any component in it, so retry the whole batch.
      if (!this.limited(fresh)) for (const [key, inputs] of groups) if (!next.has(key)) {
        next.set(key, { inputs, results: inputs.map(file => results.get(file.uri)!), analyzeCallbacks });
      }
    }
    this.cached = next;
    return files.map(file => results.get(file.uri)!);
  }

  // Only call after the disk cache has validated the complete source/settings
  // snapshot. Raw IR identities become the inputs for the first subsequent edit.
  seed(rawFiles: FileAnalysis[], derivedFiles: FileAnalysis[], analyzeCallbacks = true): void {
    this.clear();
    if (rawFiles.length !== derivedFiles.length || rawFiles.some((file, n) => file.uri !== derivedFiles[n].uri) || this.limited(derivedFiles)) return;
    const results = new Map(derivedFiles.map(file => [file.uri, file]));
    for (const [key, inputs] of this.components(rawFiles)) {
      this.cached.set(key, { inputs, results: inputs.map(file => results.get(file.uri)!), analyzeCallbacks });
    }
  }

  clear(): void { this.cached.clear(); this.facts = new WeakMap(); }

  private limited(files: FileAnalysis[]): boolean {
    return files.some(file => file.callbackDiagnostics?.some(diagnostic => ['memory', 'time', 'work'].includes(diagnostic.kind)) ||
      file.issues.some(issue => /memory budget|analysis (?:time )?budget|work limit/i.test(issue)));
  }

  private dependencies(file: FileAnalysis): Facts {
    const cached = this.facts.get(file); if (cached) return cached;
    // Retaining identifier sets is much smaller than a second token/AST graph.
    // Comments and strings may over-connect files, which is safe for reuse.
    const uses = new Set<string>();
    for (const match of file.text.matchAll(/[\p{ID_Start}_][\p{ID_Continue}]*/gu)) uses.add(match[0]);
    const provides = new Set<string>();
    for (const symbol of file.symbols) {
      if (symbol.storage !== 'local' || symbol.kind === 'type' || symbol.memberOf) provides.add(symbol.name);
      if (symbol.type?.tag) provides.add(symbol.type.name);
    }
    for (const ref of file.references) {
      uses.add(ref.name);
      // Field-read names also constrain sparse effects when the aggregate
      // declaration is missing from the indexed source set.
      if (ref.member) provides.add(ref.member.name);
    }
    for (const event of file.preprocessor ?? []) {
      if (event.kind === 'define') provides.add(event.macro.name);
      else if (event.kind === 'undef') provides.add(event.name);
    }
    // Token pasting can manufacture identifiers absent from both the source
    // uses and provider declarations. Keep such workspaces in one component.
    const facts = { uses, provides, paste: file.text.includes('##') };
    this.facts.set(file, facts); return facts;
  }

  private components(files: FileAnalysis[]): Map<string, FileAnalysis[]> {
    const facts = files.map(file => this.dependencies(file));
    if (facts.some(fact => fact.paste)) return files.length ? new Map([[JSON.stringify(files.map(file => file.uri)), files]]) : new Map();
    const parents = files.map((_, i) => i);
    const root = (i: number): number => {
      while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; }
      return i;
    };
    const join = (a: number, b: number) => { parents[root(a)] = root(b); };
    const providers = new Map<string, number>(), uris = new Map<string, number>(), names = new Map<string, number[]>();
    files.forEach((file, i) => {
      uris.set(file.uri, i);
      const name = file.uri.split('/').pop()!, matches = names.get(name) ?? [];
      matches.push(i); names.set(name, matches);
      for (const name of facts[i].provides) {
        const owner = providers.get(name);
        if (owner === undefined) providers.set(name, i); else join(i, owner);
      }
    });
    files.forEach((file, i) => {
      for (const name of facts[i].uses) { const owner = providers.get(name); if (owner !== undefined) join(i, owner); }
      for (const include of file.includes) {
        const relative = uris.get(new URL(include, file.uri).href);
        if (!file.systemIncludes?.includes(include) && relative !== undefined) { join(i, relative); continue; }
        for (const candidate of names.get(encodeURIComponent(include.split('/').pop()!)) ?? []) {
          if (decodeURIComponent(files[candidate].uri).endsWith('/' + include)) join(i, candidate);
        }
      }
    });
    const groups = new Map<number, FileAnalysis[]>();
    files.forEach((file, i) => { const key = root(i), group = groups.get(key) ?? []; group.push(file); groups.set(key, group); });
    return new Map([...groups.values()].map(group => [JSON.stringify(group.map(file => file.uri)), group]));
  }
}
