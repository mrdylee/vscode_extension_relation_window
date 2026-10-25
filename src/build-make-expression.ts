import { splitBuildWords } from './build-context';

export const unknownBuildValue = '\u0000';
export interface MakeVariable { value: string; simple: boolean; origin: 'environment' | 'file' | 'command'; exported?: boolean }
export function makePattern(pattern: string, value: string): string | undefined {
  const at=pattern.indexOf('%');
  if(at<0)return pattern===value?'':undefined;
  const start=pattern.slice(0,at),end=pattern.slice(at+1);
  return value.startsWith(start)&&value.endsWith(end)&&value.length>=start.length+end.length?value.slice(start.length,value.length-end.length):undefined;
}
// Deliberately evaluates data only. There is no shell, compiler or Make execution.
export async function expandMake(text: string, variables: Map<string, MakeVariable>, automatic: Record<string,string>,
  control: { step(): boolean; issue(message:string):void; read(path:string):Promise<string|undefined>; environment(name:string):void }, seen=new Set<string>(), nesting=0): Promise<string> {
  const fail=(message:string)=>{control.issue(message);return unknownBuildValue;};
  if(!control.step()||seen.size>32||nesting>32||text.length>65_536)return fail('Build variable expansion limit');
  const expand=(value:string)=>expandMake(value,variables,automatic,control,seen,nesting+1);
  const words=(value:string)=>value.trim().split(/\s+/).filter(Boolean);
  async function reference(body:string):Promise<string>{
    if(body in automatic)return automatic[body];
    const fn=/^([\w-]+)\s+([\s\S]*)$/.exec(body);
    if(fn){
      const parts:string[]=[];let start=0,depth=0;
      for(let i=0;i<fn[2].length;i++){if(fn[2][i]==='('||fn[2][i]==='{')depth++;else if(fn[2][i]===')'||fn[2][i]==='}')depth--;else if(fn[2][i]===','&&!depth){parts.push(fn[2].slice(start,i));start=i+1;}}
      parts.push(fn[2].slice(start));
      if(fn[1]==='if'){const condition=await expand(parts[0]);if(condition.includes(unknownBuildValue))return unknownBuildValue;return expand(condition.trim()?parts[1]??'':parts[2]??'');}
      if(fn[1]==='shell')return shell(await expand(fn[2]));
      const args:string[]=[];for(const part of parts)args.push(await expand(part));
      if(args.some(a=>a.includes(unknownBuildValue)))return unknownBuildValue;
      const [a='',b='',c='']=args;
      if(['addprefix','addsuffix'].includes(fn[1])&&words(b).reduce((n,v)=>n+v.length+a.length+1,0)>65_536||fn[1]==='subst'&&a&&c.length+(c.split(a).length-1)*(b.length-a.length)>65_536||fn[1]==='patsubst'&&words(c).length*b.length+c.length>65_536)return fail('Expanded build argument exceeds 64 KiB');
      switch(fn[1]){
        case 'strip':return words(a).join(' ');
        case 'sort':return [...new Set(words(a))].sort().join(' ');
        case 'addprefix':return words(b).map(v=>a+v).join(' ');
        case 'addsuffix':return words(b).map(v=>v+a).join(' ');
        case 'subst':return a?c.split(a).join(b):c+b;
        case 'patsubst':return words(c).map(v=>{const stem=makePattern(a,v);return stem===undefined?v:b.replace('%',stem);}).join(' ');
        case 'filter':case 'filter-out': {
          const patterns=words(a),result:string[]=[];
          for(const value of words(b)){let matched=false;for(const pattern of patterns){if(!control.step())return fail('Build filter evaluation limit');if(makePattern(pattern,value)!==undefined){matched=true;break;}}
            if(matched===(fn[1]==='filter'))result.push(value);}
          return result.join(' ');
        }
        case 'dir':return words(a).map(v=>v.includes('/')?v.slice(0,v.lastIndexOf('/')+1):'./').join(' ');
        case 'notdir':return words(a).map(v=>v.slice(v.lastIndexOf('/')+1)).join(' ');
        case 'basename':return words(a).map(v=>v.lastIndexOf('.')>v.lastIndexOf('/')?v.slice(0,v.lastIndexOf('.')):v).join(' ');
        case 'suffix':return words(a).map(v=>v.lastIndexOf('.')>v.lastIndexOf('/')?v.slice(v.lastIndexOf('.')):'').filter(Boolean).join(' ');
        case 'words':return String(words(a).length);
        case 'word':return words(b)[Number(a)-1]??'';
        default:return fail(`Cannot statically evaluate Make function ${fn[1]}`);
      }
    }
    const substitution=/^([A-Za-z_]\w*):([^=]*)=([\s\S]*)$/.exec(body);
    if(substitution){const value=await reference(substitution[1]),from=await expand(substitution[2]),to=await expand(substitution[3]);
      if((value+from+to).includes(unknownBuildValue))return unknownBuildValue;
      let result='';for(const v of words(value)){
        const stem=makePattern(from,v),next=from.includes('%')?stem===undefined?v:to.replace('%',stem):v.endsWith(from)?v.slice(0,v.length-from.length)+to:v;
        if(result.length+next.length+1>65_536)return fail('Expanded build argument exceeds 64 KiB');result+=(result?' ':'')+next;
      }return result;}
    if(!/^[A-Za-z_]\w*$/.test(body)||seen.has(body))return fail(`Cannot statically evaluate ${body}`);
    const variable=variables.get(body);if(variable?.origin==='environment')control.environment(body);
    return !variable?'':variable.simple?variable.value:expandMake(variable.value,variables,automatic,control,new Set([...seen,body]),nesting+1);
  }
  async function shell(command:string):Promise<string>{
    if(command.includes(unknownBuildValue))return unknownBuildValue;
    // These exact read-only transforms occur in build metadata. Unknown pipelines stay unknown.
    const pipeline=command.split(/\s+\|\s+/);let value:string|undefined;
    for(let i=0;i<pipeline.length;i++){
      const argv=splitBuildWords(pipeline[i]);if(!argv?.length)return fail('Unresolved read-only shell expression');
      const [name,...args]=argv;
      if(i===0&&name==='cat'&&args.length===1)value=await control.read(args[0]);
      else if(i===0&&name==='basename'&&args.length===1)value=args[0].replace(/\/+$/,'').split('/').pop();
      else if(i===0&&name==='echo'&&!/[;&<>`]/.test(command))value=args.join(' ');
      else if(i===0&&name==='sed'&&args.length===2&&/^s\/\[(?:\\t|\t) \]\/\/?g$/.test(args[0])){value=await control.read(args[1]);value=value?.replace(/[\t ]/g,'');}
      else if(value!==undefined&&name==='tr'&&args.join(' ')==='[a-z] [A-Z]')value=value.toUpperCase();
      else if(value!==undefined&&name==='tr'&&args.join(' ')==='-d \\n')value=value.replace(/\r?\n/g,'');
      else return fail(`Cannot statically evaluate shell expression: ${command}`);
      if(value===undefined)return fail(`Read-only shell input unavailable: ${command}`);
    }
    return (value??'').replace(/[\r\n]+/g,' ').trimEnd();
  }
  let result='';
  for(let i=0;i<text.length;i++){
    if(text[i]!=='$'){result+=text[i];continue;}
    const next=text[++i];
    if(next==='$'){result+='$';continue;}
    if(next==='('||next==='{'){
      const close=next==='('?')':'}';let depth=1,start=i+1;
      while(depth&&++i<text.length){if(text[i]===next)depth++;else if(text[i]===close)depth--;}
      if(depth)return fail('Unclosed Make variable expression');
      result+=await reference(text.slice(start,i));
    }else if(next)result+=await reference(next);
    if(result.length>65_536)return fail('Expanded build argument exceeds 64 KiB');
  }
  return result.length>65_536?fail('Expanded build argument exceeds 64 KiB'):result;
}
