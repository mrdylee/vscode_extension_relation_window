import { createHash } from 'node:crypto';
import { FileAnalysis, Location, ReferenceRecord, SymbolRecord } from './model';
import { RelationIndex } from './relations';

export interface CallbackContext {
  key: string; callsite: Location; expression: string; fingerprint: string;
  selection: 'local-candidates' | 'source-search';
  snippets: {id: string; location: Location; text: string}[];
  targets: {id: string; name: string; evidenceIds: string[]; trace?: {evidenceId: string; reason: string}[]}[];
  truncated: boolean; preferredTargetId?: string;
}
export interface CallbackSite { key: string; file: FileAnalysis; call: ReferenceRecord; expression: string }
export const callbackDigest = (text: string) => createHash('sha256').update(text).digest('hex');
const maxSnippets = 20, maxChars = 20_000, maxKeywords = 32, maxHits = 120;
const pause = () => new Promise<void>(resolve => setImmediate(resolve));

/** A compact name-to-file inventory includes negative search dependencies without
 * retaining a second object for every source reference. */
export class CallbackContextBuilder {
  readonly sites: CallbackSite[] = [];
  private symbols = new Map<string, SymbolRecord>();
  private definitions = new Map<string, SymbolRecord[]>();
  private filesByName = new Map<string, Set<FileAnalysis>>();
  private fileByUri = new Map<string, FileAnalysis>();
  private digests = new Map<string, string>();
  private ordered = new Map<string, ReferenceRecord[]>();
  private seen = new Set<string>();
  private localCandidates = new Map<string, ReferenceRecord[]>();
  private bindings = new RelationIndex();
  addFile(file: FileAnalysis) {
    this.fileByUri.set(file.uri, file);
    // Binding needs declarations/includes, not another index of every reference.
    this.bindings.update({...file,references:[],functionArguments:undefined});
    const names = new Set<string>();
    for (const symbol of file.symbols) {
      this.symbols.set(symbol.id,symbol); names.add(symbol.name);
      if (symbol.kind === 'function' && symbol.definition) {
        const entries = this.definitions.get(symbol.name) ?? []; entries.push(symbol); this.definitions.set(symbol.name,entries);
      }
    }
    for (const call of file.references) names.add(call.name);
    for (const name of names) {
      const entries = this.filesByName.get(name) ?? new Set<FileAnalysis>(); entries.add(file); this.filesByName.set(name,entries);
    }
  }
  collectSites(file: FileAnalysis, requestedSites?: ReadonlySet<string>) {
    for (const call of file.references) {
      // Non-evaluated expressions (sizeof, _Generic controls) have no access.
      if (call.kind !== 'call' || !call.access) continue;
      const key = `${file.uri}:${call.location.start}:${call.location.end}`, requested=requestedSites?.has(key);
      if (call.inference && !call.inference.incomplete && !requested) continue;
      if (file.inactive?.some(range => call.location.start >= range.start && call.location.start < range.end)) continue;
      if (!requested && !call.indirect && call.callKind !== 'indirect' && !call.inference?.incomplete &&
        !this.bindings.resolveReference(call).some(symbol=>symbol.kind==='variable' &&
          this.bindings.layout(symbol).some(type=>type.layers[0]==='function' ||
            (type.layers[0]==='pointer' && type.layers[1]==='function')))) continue;
      if (call.targetId && call.inference?.evidence.length && ['registered', 'inferred'].includes(call.callKind ?? '')) {
        const candidates = this.localCandidates.get(key) ?? [];
        candidates.push(call); this.localCandidates.set(key, candidates);
      }
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      this.sites.push({key,file,call,expression:call.inference?.expression ?? call.name});
    }
  }
  private snippet(file: FileAnalysis, start: number, end: number): CallbackContext['snippets'][number] {
    const prefix = file.text.slice(0, start), text = file.text.slice(start, end);
    const line = (prefix.match(/\n/g) ?? []).length, column = start - prefix.lastIndexOf('\n') - 1, newline = text.lastIndexOf('\n');
    return {id: `${file.uri}:${start}:${end}`, text,
      location: {uri: file.uri, start, end, line, column, endLine: line + (text.match(/\n/g) ?? []).length,
        endColumn: newline < 0 ? column + text.length : text.length - newline - 1}};
  }
  // Reuse the existing object/parameter/getter analysis, rather than joining
  // unrelated callback fields by spelling or recomputing pointer propagation.
  private localContext(site: CallbackSite): CallbackContext | undefined {
    const candidates = this.localCandidates.get(site.key);
    if (!candidates?.length) return;
    const snippets: CallbackContext['snippets'] = [], targets: CallbackContext['targets'] = [];
    const dependencies = new Set([site.file.uri]);
    let chars = 0;
    const add = (at: Location) => {
      const file = this.fileByUri.get(at.uri);
      if (!file || at.start < 0 || at.end <= at.start || at.end > file.text.length) return;
      dependencies.add(file.uri);
      const previous = snippets.find(item => item.location.uri === at.uri && item.location.start <= at.start && item.location.end >= at.end);
      if (previous) return previous;
      const owner = file.symbols.find(symbol => symbol.kind === 'function' && symbol.definition &&
        symbol.extent.start <= at.start && symbol.extent.end >= at.end);
      const extent = owner?.extent, small = extent && extent.end - extent.start <= 1200;
      const start = small ? extent.start : Math.max(0, at.start - 160);
      const end = small ? extent.end : Math.min(file.text.length, at.end + 240);
      if (snippets.length >= 10 || chars + end - start > 8000) return;
      const snippet = this.snippet(file, start, end);
      snippets.push(snippet); chars += end - start; return snippet;
    };
    if (!add(site.call.location)) return;
    for (const candidate of candidates) {
      const symbol = this.symbols.get(candidate.targetId!);
      if (!symbol || symbol.kind !== 'function' || !symbol.definition || targets.some(target => target.id === symbol.id)) continue;
      dependencies.add(symbol.location.uri);
      const trace: NonNullable<CallbackContext['targets'][number]['trace']> = [];
      for (const evidence of candidate.inference!.evidence) {
        const snippet = add(evidence.location);
        if (snippet) trace.push({evidenceId: snippet.id, reason: evidence.reason.slice(0, 160)});
        if (trace.length >= 12) break;
      }
      if (!trace.length) continue;
      targets.push({id: symbol.id, name: symbol.name, evidenceIds: [...new Set(trace.map(step => step.evidenceId))], trace});
      if (targets.length >= 8) break;
    }
    if (!targets.length) return;
    // Pointer propagation records the function address but may omit intermediate
    // getter/caller frames. Supply a small bridge context for the LLM to review.
    // This only enriches evidence; it never adds targets by a matching name.
    if (candidates.some(candidate => candidate.callKind === 'inferred')) {
      const names = new Set<string>(), visited = new Set<string>();
      const owner = this.symbols.get(site.call.functionId ?? '');
      if (owner) names.add(owner.name);
      for (const name of site.expression.match(/[A-Za-z_]\w*/g) ?? []) {
        if (this.bindings.resolveReference({id: '', name, kind: 'reference', location: site.call.location, conditions: []})
          .some(symbol => symbol.kind === 'variable' && !symbol.scope)) names.add(name);
      }
      let hits = 0;
      for (let round = 0; round < 3 && hits < 24; round++) for (const name of [...names].filter(name => !visited.has(name))) {
        if (hits >= 24) break;
        visited.add(name);
        bridgeSearch: for (const file of this.filesByName.get(name) ?? []) for (const ref of file.references) {
          if (ref.name !== name || ['inferred', 'registered', 'ai-candidate', 'user-confirmed'].includes(ref.callKind ?? '')) continue;
          if (hits >= 24) break bridgeSearch;
          hits++;
          const snippet = add(ref.location);
          if (snippet) for (const target of targets) if (!target.evidenceIds.includes(snippet.id)) {
            target.evidenceIds.push(snippet.id);
            target.trace!.push({evidenceId: snippet.id, reason: `Bridge source around ${name}; verify the registration-to-invocation path.`});
          }
          const fn = this.symbols.get(ref.functionId ?? ref.ownerId ?? '');
          if (fn?.kind !== 'function' || names.size >= 8) continue;
          names.add(fn.name);
          for (const call of this.range(file, fn.extent.start, fn.extent.end)) {
            if (names.size >= 8) break;
            if (call.kind === 'call' && !call.indirect && call.callKind === 'direct') names.add(call.name);
          }
        }
      }
    }
    const sources = [...dependencies].sort().map(uri => {
      let digest = this.digests.get(uri);
      if (!digest) { digest = callbackDigest(this.fileByUri.get(uri)!.text); this.digests.set(uri, digest); }
      return [uri, digest];
    });
    // A local shortlist is intentionally incomplete, even if no size cap was hit.
    const fingerprint = callbackDigest(JSON.stringify({selection: 'local-candidates', callsite: site.call.location,
      expression: site.expression, targets, snippets: snippets.map(item => item.id), sources}));
    return {key: site.key, callsite: site.call.location, expression: site.expression, fingerprint,
      selection: 'local-candidates', targets, snippets, truncated: true};
  }
  private range(file: FileAnalysis, start: number, end: number) {
    let ordered = this.ordered.get(file.uri);
    if (!ordered) { ordered = [...file.references].sort((a,b)=>a.location.start-b.location.start); this.ordered.set(file.uri,ordered); }
    let low=0, high=ordered.length;
    while (low<high) { const middle=(low+high)>>>1; if(ordered[middle].location.start<start)low=middle+1;else high=middle; }
    const result: ReferenceRecord[]=[];
    for(let n=low;n<ordered.length && ordered[n].location.start<end;n++) if(ordered[n].location.end<=end)result.push(ordered[n]);
    return result;
  }
  context(site: CallbackSite, preferredTargetId?: string): CallbackContext {
    const local = this.localContext(site);
    if (local && !preferredTargetId) return local;
    const {file,call,expression,key}=site;
    const identifiers=expression.match(/[A-Za-z_]\w*/g)??[];
    const keywords=new Set(identifiers.filter((name,n)=>n===identifiers.length-1||name.length>=4));
    const preferred=preferredTargetId&&this.symbols.get(preferredTargetId);if(preferred)keywords.add(preferred.name);
    const snippets: CallbackContext['snippets']=[], dependencies=new Set<string>(), visited=new Set<string>(), added=new Set<string>();
    let chars=0,truncated=false;
    const add=(file:FileAnalysis,at:Location,owner?:SymbolRecord)=>{
      dependencies.add(file.uri);
      const extent=owner?.extent;
      const start=extent && extent.end-extent.start<=1800?extent.start:Math.max(0,at.start-400);
      const end=extent && extent.end-extent.start<=1800?extent.end:Math.min(file.text.length,at.end+700);
      const id=`${file.uri}:${start}:${end}`;
      if(added.has(id))return;
      if(snippets.length>=maxSnippets||chars+end-start>maxChars){truncated=true;return;}
      added.add(id);chars+=end-start;
      snippets.push(this.snippet(file,start,end));
      if(owner && keywords.size<maxKeywords)keywords.add(owner.name);
      for(const ref of this.range(file,start,end)) if(/^[A-Za-z_]\w{3,}$/.test(ref.name)&&!visited.has(ref.name)){
        if(keywords.size>=maxKeywords){truncated=true;break;}keywords.add(ref.name);
      }
    };
    add(file,call.location,this.symbols.get(call.functionId??call.ownerId??''));
    for(let round=0;round<3;round++)for(const name of [...keywords].filter(name=>!visited.has(name))){
      visited.add(name);let hits=0;
      for(const match of this.filesByName.get(name)??[]){
        dependencies.add(match.uri);
        if(hits>=maxHits){truncated=true;continue;}
        for(const ref of match.references)if(ref.name===name){
          if(++hits>maxHits){truncated=true;break;}
          add(match,ref.location,this.symbols.get(ref.ownerId??ref.functionId??''));
        }
        for(const symbol of match.symbols)if(symbol.name===name){
          if(++hits>maxHits){truncated=true;break;}add(match,symbol.location,symbol);
        }
      }
    }
    if([...keywords].some(name=>!visited.has(name)))truncated=true;
    const targets=new Map<string,CallbackContext['targets'][number]>();
    for(const snippet of snippets){
      const owner=this.fileByUri.get(snippet.location.uri)!;
      for(const ref of this.range(owner,snippet.location.start,snippet.location.end)){
        if(ref.kind!=='reference'||ref.access==='write'||!ref.access)continue;
        const symbol=ref.targetId?this.symbols.get(ref.targetId):undefined;
        if(symbol && symbol.kind!=='function')continue;
        const options=symbol?.definition?[symbol]:(this.definitions.get(ref.name)??[]).filter(target=>target.storage!=='static'||target.location.uri===owner.uri);
        for(const target of options){
          const record=targets.get(target.id)??{id:target.id,name:target.name,evidenceIds:[]};
          if(!record.evidenceIds.includes(snippet.id))record.evidenceIds.push(snippet.id);
          targets.set(target.id,record);dependencies.add(target.location.uri);
        }
      }
    }
    const fingerprint=callbackDigest(JSON.stringify({preferredTargetId,expression,callsite:call.location,keywords:[...visited].sort(),
      sources:[...dependencies].sort().map(uri=>{
        let digest=this.digests.get(uri);if(!digest){digest=callbackDigest(this.fileByUri.get(uri)!.text);this.digests.set(uri,digest);}return[uri,digest];
      }),snippets:snippets.map(item=>item.id),targets:[...targets.keys()].sort(),truncated}));
    return{key,callsite:call.location,expression,fingerprint,preferredTargetId,selection:'source-search',snippets,targets:[...targets.values()].slice(0,32),truncated:truncated||targets.size>32};
  }
}

export async function prepareCallbackContexts(files: readonly FileAnalysis[], current:()=>boolean, requestedSites?: ReadonlySet<string>) {
  const builder=new CallbackContextBuilder();
  for(let n=0;n<files.length;n++){
    if(!current())break;builder.addFile(files[n]);
    if(n%8===7)await pause();
  }
  // A call's typedef can be declared in a header appearing later in the snapshot.
  for(let n=0;n<files.length;n++){
    if(!current())break;builder.collectSites(files[n],requestedSites);
    if(n%8===7)await pause();
  }
  return builder;
}
/** Synchronous helper for small pure fixtures. Runtime uses the yielding builder. */
export function callbackContexts(files:readonly FileAnalysis[]) {
  const builder=new CallbackContextBuilder();for(const file of files)builder.addFile(file);
  for(const file of files)builder.collectSites(file);
  return builder.sites.map(site=>builder.context(site));
}
