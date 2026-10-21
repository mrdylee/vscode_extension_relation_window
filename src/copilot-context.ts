import { createHash } from 'node:crypto';
import { FileAnalysis, Location, ReferenceRecord, SymbolRecord } from './model';

export interface CallbackContext {
  key: string; callsite: Location; expression: string; fingerprint: string;
  snippets: {id: string; location: Location; text: string}[];
  targets: {id: string; name: string; evidenceIds: string[]}[];
  truncated: boolean;
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
  addFile(file: FileAnalysis) {
    this.fileByUri.set(file.uri, file);
    const names = new Set<string>();
    for (const symbol of file.symbols) {
      this.symbols.set(symbol.id,symbol); names.add(symbol.name);
      if (symbol.kind === 'function' && symbol.definition) {
        const entries = this.definitions.get(symbol.name) ?? []; entries.push(symbol); this.definitions.set(symbol.name,entries);
      }
    }
    for (const call of file.references) {
      names.add(call.name);
      // Non-evaluated expressions (sizeof, _Generic controls) have no access.
      if (call.kind !== 'call' || !call.access || (!call.indirect && call.callKind !== 'indirect' && !call.inference?.incomplete)) continue;
      if (call.inference && !call.inference.incomplete) continue;
      if (file.inactive?.some(range => call.location.start >= range.start && call.location.start < range.end)) continue;
      const key = `${file.uri}:${call.location.start}:${call.location.end}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      this.sites.push({key,file,call,expression:call.inference?.expression ?? call.name});
    }
    for (const name of names) {
      const entries = this.filesByName.get(name) ?? new Set<FileAnalysis>(); entries.add(file); this.filesByName.set(name,entries);
    }
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
  context(site: CallbackSite): CallbackContext {
    const {file,call,expression,key}=site;
    const identifiers=expression.match(/[A-Za-z_]\w*/g)??[];
    const keywords=new Set(identifiers.filter((name,n)=>n===identifiers.length-1||name.length>=4));
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
      const prefix=file.text.slice(0,start),text=file.text.slice(start,end);
      const line=(prefix.match(/\n/g)??[]).length,column=start-prefix.lastIndexOf('\n')-1,newline=text.lastIndexOf('\n');
      const location={uri:file.uri,start,end,line,column,endLine:line+(text.match(/\n/g)??[]).length,endColumn:newline<0?column+text.length:text.length-newline-1};
      snippets.push({id,location,text});
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
    const fingerprint=callbackDigest(JSON.stringify({expression,callsite:call.location,keywords:[...visited].sort(),
      sources:[...dependencies].sort().map(uri=>{
        let digest=this.digests.get(uri);if(!digest){digest=callbackDigest(this.fileByUri.get(uri)!.text);this.digests.set(uri,digest);}return[uri,digest];
      }),snippets:snippets.map(item=>item.id),targets:[...targets.keys()].sort(),truncated}));
    return{key,callsite:call.location,expression,fingerprint,snippets,targets:[...targets.values()].slice(0,32),truncated:truncated||targets.size>32};
  }
}

export async function prepareCallbackContexts(files: readonly FileAnalysis[], current:()=>boolean) {
  const builder=new CallbackContextBuilder();
  for(let n=0;n<files.length;n++){
    if(!current())break;builder.addFile(files[n]);
    if(n%8===7)await pause();
  }
  return builder;
}
/** Synchronous helper for small pure fixtures. Runtime uses the yielding builder. */
export function callbackContexts(files:readonly FileAnalysis[]) {
  const builder=new CallbackContextBuilder();for(const file of files)builder.addFile(file);
  return builder.sites.map(site=>builder.context(site));
}
