import { createHash } from 'node:crypto';
import { RelationIndex } from './relations';
import { Location, ReferenceRecord, SymbolRecord, fileKey, locationKey } from './model';
import { locationIn, tokenizeC } from './c-tokens';

interface TargetAnchor { context?: string; uri: string; name: string; digest: string }
export interface CallbackOverride {
  buildFingerprint?: string;
  version: 1; key: string; uri: string; owner: TargetAnchor; expression: string; ordinal: number; count: number;
  original: TargetAnchor; target: TargetAnchor; dependencies: { context?: string; uri: string; digest: string }[];
}
export interface ResolvedOverride {
  record: CallbackOverride; status: 'active' | 'needs-review' | 'inactive'; site?: ReferenceRecord;
  target?: SymbolRecord; original?: SymbolRecord;
}
const digest = (text: string) => createHash('sha256').update(tokenizeC(text, locationIn(text, '')).map(token=>token.text).join('\0')).digest('hex');
function anchor(index: RelationIndex, symbol: SymbolRecord): TargetAnchor {
  const file=index.fileAt(symbol.location.uri,symbol.location.context)!;
  return {...(symbol.location.context?{context:symbol.location.context}:{}),uri:file.uri,name:symbol.name,digest:digest(file.text.slice(symbol.extent.start,symbol.extent.end))};
}
function find(index: RelationIndex, target: TargetAnchor) {
  return index.symbols().filter(symbol=>symbol.kind==='function'&&symbol.definition&&symbol.name===target.name&&symbol.location.uri===target.uri&&(!target.context||symbol.location.context===target.context)&&anchor(index,symbol).digest===target.digest);
}
function calls(index: RelationIndex, owner: SymbolRecord, expression: string) {
  const file=index.fileAt(owner.location.uri,owner.location.context)!;
  const seen=new Set<string>();
  return file.references.filter(ref=> {
    if(ref.kind!=='call'||!ref.access||ref.functionId!==owner.id||['ai-candidate','user-confirmed'].includes(ref.callKind??''))return false;
    const key=ref.location.start+':'+ref.location.end;
    if(seen.has(key)||digest(file.text.slice(ref.location.start,ref.location.end))!==expression)return false;
    seen.add(key);return true;
  });
}
export function makeCallbackOverride(index: RelationIndex, location: Location, originalId: string, targetId: string, dependencyUris: string[] = []): CallbackOverride {
  const file=index.fileAt(location.uri,location.context),target=index.symbol(targetId),original=index.symbol(originalId);
  const site=file?.references.find(ref=>ref.kind==='call'&&ref.access&&ref.location.start===location.start&&ref.location.end===location.end&&ref.functionId);
  const owner=site?.functionId&&index.symbol(site.functionId);
  if(!file||!site||!owner||!target?.definition||target.kind!=='function'||!original||original.kind!=='function')throw new Error('The call or target changed. Choose an indexed function again.');
  const expression=digest(file.text.slice(location.start,location.end)),siblings=calls(index,owner,expression);
  const ordinal=siblings.findIndex(ref=>ref.location.start===location.start);
  if(ordinal<0)throw new Error('The callback is no longer available.');
  const ownerAnchor=anchor(index,owner),originalAnchor=anchor(index,original);
  const key=createHash('sha256').update(JSON.stringify([file.uri,ownerAnchor,expression,ordinal,originalAnchor])).digest('hex');
  return {buildFingerprint:file.context?.configurationFingerprint,version:1,key,uri:file.uri,owner:ownerAnchor,expression,ordinal,count:siblings.length,original:originalAnchor,target:anchor(index,target),
    dependencies:[...new Set([fileKey(file),locationKey(target.location),locationKey(original.location),...dependencyUris])].flatMap(uri=>{const dependency=index.fileAt(uri);return dependency?[{uri:dependency.uri,context:dependency.context?.key,digest:digest(dependency.text)}]:[]})};
}
export class CallbackOverrideStore {
  private values=new Map<string,CallbackOverride>();
  private revisions=new Map<string,number>();
  constructor(saved: unknown = []) {
    if(!Array.isArray(saved))return;
    for(const value of saved) {
      const record=value as CallbackOverride;
      const validAnchor=(item: TargetAnchor)=>item&&typeof item.uri==='string'&&typeof item.name==='string'&&/^[a-f0-9]{64}$/.test(item.digest);
      if(record?.version!==1||typeof record.key!=='string'||!validAnchor(record.owner)||!validAnchor(record.original)||!validAnchor(record.target)||
        typeof record.uri!=='string'||typeof record.expression!=='string'||!Number.isSafeInteger(record.ordinal)||record.ordinal<0||!Number.isSafeInteger(record.count)||record.count<=record.ordinal||
        !Array.isArray(record.dependencies)||record.dependencies.some(item=>!item||typeof item.uri!=='string'||typeof item.digest!=='string'))continue;
      this.values.set(record.key,record);
    }
  }
  records() { return [...this.values.values()]; }
  revision(key: string) { return this.revisions.get(key)??0; }
  set(record: CallbackOverride) { this.values.set(record.key,record);this.revisions.set(record.key,this.revision(record.key)+1); }
  remove(key: string) { this.values.delete(key);this.revisions.set(key,this.revision(key)+1); }
  resolve(index: RelationIndex): ResolvedOverride[] {
    return this.records().map(record=> {
      const build=[...index.files.values()].find(file=>file.context)?.context?.configurationFingerprint;
      if(record.buildFingerprint!==build&&(record.buildFingerprint||build))return{record,status:'needs-review'};
      if(record.dependencies.some(item=>!index.fileAt(item.uri,item.context)))return{record,status:'inactive'};
      if(record.dependencies.some(item=>digest(index.fileAt(item.uri,item.context)!.text)!==item.digest))return{record,status:'needs-review'};
      const owners=find(index,record.owner),targets=find(index,record.target),originals=find(index,record.original);
      if(owners.length!==1||targets.length!==1||originals.length!==1)return{record,status:'needs-review'};
      const sites=calls(index,owners[0],record.expression);
      if(sites.length!==record.count)return{record,status:'needs-review'};
      return{record,status:'active',site:sites[record.ordinal],target:targets[0],original:originals[0]};
    });
  }
}
