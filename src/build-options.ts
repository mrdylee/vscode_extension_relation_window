import { BuildEntry, BuildEvidence, BuildFileSystem, BuildProfile, buildDirectory, canonicalBuildUri, fingerprintBuildInput, normalizeCompileContext, resolveBuildUri, splitBuildWords } from './build-context';

import { expandMake, makePattern, MakeVariable } from './build-make-expression';
type Variable = MakeVariable;
interface Rule { targets: string[]; prerequisites: string[]; recipes: { text: string; evidence: BuildEvidence }[] }
const unknown = '\u0000';
function logicalLines(text: string, continuation = '\\') {
  const physical=text.split(/\r?\n/), result:{text:string;line:number}[]=[];
  for(let line=0;line<physical.length;line++) {
    const start=line;let text=physical[line];
    while(text.endsWith(continuation)&&line+1<physical.length)text=text.slice(0,-1)+' '+physical[++line];
    result.push({text,line:start});
  }
  return result;
}
export async function extractStaticBuildOptions(fs: BuildFileSystem, entry: BuildEntry, sourceUris: readonly string[], environment: Record<string, string | undefined>): Promise<BuildProfile> {
  const profile: BuildProfile = { id: entry.id, entry, fingerprint: '', units: [], coverage: 'partial', dependencies: [], relevantEnvironment: [], issues: [] };
  const readCache = new Map<string, string | undefined>(), dependencies = new Map<string, string>(), usedEnvironment = new Set<string>();
  let operations = 0, failed = false, bytesRead = 0;
  const overlay = new Map<string, string | undefined>();
  const metadataKey=(uri:string)=>canonicalBuildUri(uri,entry.dialect==='cmd'||process.platform==='win32');
  const issue = (code: string, message: string, evidence?: BuildEvidence) => { failed = true; if (profile.issues.length < 128) profile.issues.push({ code, message, evidence }); };
  async function read(uri: string, evidence?: BuildEvidence, optional = false) {
    if (overlay.has(metadataKey(uri))) { const text=overlay.get(metadataKey(uri)); if(text===undefined&&!optional)issue('missing-build-input',`Build input unavailable: ${uri}`,evidence); return text; }
    if (readCache.has(uri)) {
      const text=readCache.get(uri);
      if(text===undefined&&!optional)issue('missing-build-input',`Build input unavailable: ${uri}`,evidence);
      return text;
    }
    if (++operations > 20_000) { issue('extraction-limited', 'Build extraction operation limit', evidence); return; }
    let text: string | undefined;
    try { text = await fs.readText(uri); } catch { /* Report the unavailable dependency below. */ }
    if (text !== undefined && text.length > 1_048_576) { issue('file-limited', `Build input exceeds 1 MiB: ${uri}`, evidence); text = undefined; }
    if(text!==undefined&&(bytesRead+=Buffer.byteLength(text))>16*1024*1024){issue('extraction-limited','Build input exceeds the 16 MiB extraction budget',evidence);text=undefined;}
    readCache.set(uri, text); dependencies.set(uri, fingerprintBuildInput(text ?? null));
    if (text === undefined && !optional) issue('missing-build-input', `Build input unavailable: ${uri}`, evidence);
    return text;
  }
  function expand(text: string, variables: Map<string, Variable>, evidence: BuildEvidence, automatic: Record<string, string> = {}, cwd=entry.cwdUri): Promise<string> {
    return expandMake(text,variables,automatic,{step:()=>++operations<=20_000,issue:message=>issue(/limit|exceeds/.test(message)?'extraction-limited':'unsupported-expression',message,evidence),read:path=>read(resolveBuildUri(cwd,path),evidence),environment:name=>usedEnvironment.add(name)});
  }
  function words(text: string, dialect: 'posix' | 'windows', evidence: BuildEvidence): string[] {
    const result = splitBuildWords(text, dialect);
    if (!result) issue('invalid-quoting', 'Unclosed build command quoting', evidence);
    return result ?? [];
  }
  const envVariables = (env: Record<string, string | undefined>): Map<string, Variable> => new Map(Object.entries(env).filter((pair): pair is [string, string] => pair[1] !== undefined).map(([key, value]) => [key, { value, simple: true, origin: 'environment' as const }]));
  const makeControls = new Set(['MAKEFLAGS','MFLAGS','MAKEOVERRIDES','MAKEFILES']);
  async function make(args: string[], cwd: string, env: Record<string, string | undefined>, chain: BuildEvidence[], depth: number) {
    if (depth > 32) { issue('extraction-limited', 'Recursive Make depth limit', chain.at(-1)); return; }
    const variables = envVariables(env), filenames: string[] = [], selected: string[] = [];
    for (let n = 0; n < args.length; n++) {
      const arg = args[n];
      if (arg === '-C' || arg === '--directory') { const value = args[++n]; if (value) cwd = resolveBuildUri(cwd, value); else issue('missing-option-value', 'Make directory missing', chain.at(-1)); }
      else if (arg.startsWith('-C') && arg.length > 2) cwd = resolveBuildUri(cwd, arg.slice(2));
      else if (arg === '-f' || arg === '--file') { const value = args[++n]; if (value) filenames.push(value); else issue('missing-option-value', 'Make file missing', chain.at(-1)); }
      else if (arg.startsWith('-f') && arg.length > 2) filenames.push(arg.slice(2));
      else if (/^[A-Za-z_]\w*=/.test(arg)) { const at = arg.indexOf('='); variables.set(arg.slice(0, at), { value: arg.slice(at + 1), simple: false, origin: 'command' }); }
      else if (arg.startsWith('-')) { if (!/^(?:-j\d*|-s|--silent|--no-print-directory)$/.test(arg)) issue('unsupported-make-option', `Unresolved Make option ${arg}`, chain.at(-1)); }
      else selected.push(arg);
    }
    for(const name of makeControls)if(variables.get(name)?.value.trim()) {
      if(variables.get(name)?.origin==='environment')usedEnvironment.add(name);
      issue('unsupported-make-environment',`Make control variable is not interpreted: ${name}`,chain.at(-1));
    }
    if (!filenames.length) {
      for (const name of ['GNUmakefile', 'makefile', 'Makefile']) {
        const uri = resolveBuildUri(cwd, name), text = await read(uri,chain.at(-1),true);
        if (text !== undefined) { filenames.push(name); break; }
      }
      if (!filenames.length) { issue('missing-build-input', `No Makefile at ${cwd}`, chain.at(-1)); return; }
    }
    const rules: Rule[] = [], reading = new Set<string>(); let defaultTarget: string | undefined;
    const targetVariables: {targets:string[];name:string;operator:string;raw:string;evidence:BuildEvidence}[]=[];
    const matchingVariables=(name:string)=>targetVariables.filter(item=>++operations<=20_000&&item.targets.some(t=>makePattern(t,name)!==undefined)).sort((a,b)=>{
      const priority=(item:typeof a)=>Math.max(...item.targets.map(t=>t.includes('%')?t.length:65_537));
      return priority(a)-priority(b);
    });
    async function assign(vs:Map<string,Variable>,name:string,operator:string,raw:string,evidence:BuildEvidence,exported=false,literal=false){
      const old=vs.get(name);if(old?.origin==='command'||operator==='?='&&old)return;
      const simple=operator===':='||operator==='+='&&old?.simple===true;
      const next=simple&&!literal?await expand(raw,vs,evidence,{},cwd):raw;
      if(makeControls.has(name)&&next.trim())issue('unsupported-make-environment',`Make control variable is not interpreted: ${name}`,evidence);
      vs.set(name,{value:operator==='+='&&old?old.value+' '+next:next,simple,origin:'file',exported:exported||old?.exported||old?.origin==='environment'});
    }
    async function parse(uri: string, nesting: number) {
      if(nesting>32||reading.has(uri)){issue('include-cycle',`Make include cycle/depth at ${uri}`);return;}
      const text=await read(uri);if(text===undefined)return;reading.add(uri);
      let current:Rule|undefined,definition:{name:string;lines:string[];depth:number}|undefined;
      const conditionals:{parent:boolean;value:boolean|undefined;otherwise:boolean}[]=[];let active=true;
      for(const {text:original,line} of logicalLines(text)){
        const evidence={uri,line,expression:original};
        if(++operations>20_000){issue('extraction-limited','Build statement limit',evidence);break;}
        const value=original.replace(/(?<!\\)#.*$/,'').trim();
        if(definition){if(/^define\s/.test(value))definition.depth++;if(value==='endef'&&!--definition.depth){if(active)variables.set(definition.name,{value:definition.lines.join('\n'),simple:false,origin:'file'});definition=undefined;}else definition.lines.push(original);continue;}
        const define=/^define\s+([A-Za-z_]\w*)$/.exec(value);if(define){definition={name:define[1],lines:[],depth:1};current=undefined;continue;}
        if(/^\t/.test(original)){if(active&&current)current.recipes.push({text:original.trim(),evidence});continue;}
        if(!value)continue;
        const condition=/^(ifeq|ifneq|ifdef|ifndef)\s+(.+)$/.exec(value);
        if(condition){let known:boolean|undefined;
          if(active){
            const expression=await expand(condition[2],variables,evidence,{},cwd);
            if(!expression.includes(unknown)){
              if(condition[1]==='ifdef'||condition[1]==='ifndef'){known=!!variables.get(expression.trim())?.value;if(condition[1]==='ifndef')known=!known;}
              else {const pair=/^\(([^,]*),([^)]*)\)$/.exec(expression);if(pair)known=condition[1]==='ifeq'?pair[1].trim()===pair[2].trim():pair[1].trim()!==pair[2].trim();}
            }
            if(known===undefined)issue('unsupported-condition',`Unresolved Make condition: ${value}`,evidence);
          }
          conditionals.push({parent:active,value:known,otherwise:false});active=active&&known!==false;current=undefined;continue;
        }
        if(value==='else'){const c=conditionals.at(-1);if(!c||c.otherwise)issue('invalid-condition','Unexpected Make else',evidence);else{c.otherwise=true;active=c.parent&&c.value!==true;}current=undefined;continue;}
        if(value==='endif'){const c=conditionals.pop();if(!c)issue('invalid-condition','Unexpected Make endif',evidence);active=c?.parent??true;current=undefined;continue;}
        if(!active||conditionals.some(c=>c.value===undefined)){current=undefined;continue;}
        const include=/^(include|-include|sinclude)\s+(.+)$/.exec(value);
        if(include){for(const path of words(await expand(include[2],variables,evidence,{},cwd),'posix',evidence)){
          if(/[\u0000*?]/.test(path)){issue('unsupported-include',`Unresolved Make include: ${path}`,evidence);continue;}
          const next=resolveBuildUri(cwd,path);
          if(include[1]!=='include'&&await read(next,evidence,true)===undefined)continue;
          await parse(next,nesting+1);
        }current=undefined;continue;}
        const specific=/^([^:]+):\s*([A-Za-z_]\w*)\s*(:=|\?=|\+=|=)\s*(.*)$/.exec(value);
        if(specific){
          const targets=words(await expand(specific[1],variables,evidence,{},cwd),'posix',evidence);
          for(const target of targets){
            let raw=specific[4];const priorFailure=failed;
            if(specific[3]===':='){
              const vs=new Map(variables);
              for(const prior of matchingVariables(target))await assign(vs,prior.name,prior.operator,prior.raw,prior.evidence,false,true);
              raw=await expand(raw,vs,evidence,{},cwd);
            }
            failed=priorFailure;targetVariables.push({targets:[target],name:specific[2],operator:specific[3],raw,evidence});
          }
          current=undefined;continue;
        }
        const assignment=/^(?:export\s+)?([A-Za-z_]\w*)\s*(:=|\?=|\+=|=)\s*(.*)$/.exec(value);
        if(assignment){await assign(variables,assignment[1],assignment[2],assignment[3],evidence,/^export\s+/.test(value));current=undefined;continue;}
        if(/^export\s+[A-Za-z_]\w*$/.test(value)){const name=value.split(/\s+/)[1],old=variables.get(name);variables.set(name,{value:old?.value??'',simple:old?.simple??true,origin:old?.origin??'file',exported:true});continue;}
        const rule=/^([^:]+):([^=]*)$/.exec(value);
        if(rule&&!/\b(?:override|define|eval)\b/.test(value)){
          const targets=words(await expand(rule[1],variables,evidence,{},cwd),'posix',evidence);
          if(targets.some(t=>/[\u0000*?]/.test(t))){issue('unsupported-target',`Unresolved target: ${value}`,evidence);continue;}
          current={targets,prerequisites:words(await expand(rule[2],variables,evidence,{},cwd),'posix',evidence),recipes:[]};rules.push(current);
          if(!defaultTarget&&!targets[0]?.startsWith('.')&&!targets[0]?.includes('%'))defaultTarget=targets[0];
        }else {issue('unsupported-statement',`Unresolved Make statement: ${value}`,evidence);current=undefined;}
      }
      if(definition)issue('unsupported-statement',`Unclosed Make define in ${uri}`);
      if(conditionals.length)issue('invalid-condition',`Unclosed Make condition in ${uri}`);reading.delete(uri);
    }
    for(const filename of filenames)await parse(resolveBuildUri(cwd,filename),0);
    const visited=new Set<string>(),visiting=new Set<string>();
    async function target(name:string,level:number,inherited:Map<string,Variable>){
      if(++operations>20_000){issue('extraction-limited','Build target evaluation limit');return;}
      const priorFailure=failed,vs=new Map(inherited);
      try {
      for(const item of matchingVariables(name)){await assign(vs,item.name,item.operator,item.raw,item.evidence,false,true);if(item.raw.includes(unknown))failed=true;}
      const key=fingerprintBuildInput([name,[...vs]]);if(visited.has(key))return;
      if(level>64||visiting.has(name)){issue('target-cycle',`Target cycle/depth at ${name}`);return;}visiting.add(name);
      let selectedRules=rules.filter(rule=>rule.targets.includes(name)),stem:string|undefined;
      if(!selectedRules.some(r=>r.recipes.length)){
        const pattern=rules.find(rule=>rule.recipes.length&&rule.targets.some(t=>t.includes('%')&&makePattern(t,name)!==undefined));
        if(pattern){selectedRules=[...selectedRules,pattern];stem=makePattern(pattern.targets.find(t=>t.includes('%')&&makePattern(t,name)!==undefined)!,name);}
      }
      for(const rule of selectedRules){
        const prerequisites=rule.prerequisites.map(p=>stem===undefined?p:p.replace(/%/g,stem));
        for(const prerequisite of prerequisites.filter(p=>p!=='|'))await target(prerequisite,level+1,vs);
        const normal=prerequisites.slice(0,prerequisites.includes('|')?prerequisites.indexOf('|'):undefined);
        for(const recipe of rule.recipes){
          const command=await expand(recipe.text.replace(/^[@+-]+/,''),vs,recipe.evidence,{'@':name,'<':normal[0]??'','^':normal.join(' '),'*':stem??'',MAKE:'make'},cwd);
          if(command.includes(unknown))continue;
          const argv=words(command,'posix',recipe.evidence);if(!argv.length)continue;
          const binary=argv[0].split(/[\\/]/).pop()!.replace(/\.exe$/,'');
          if(/^(?:g?make)$/.test(binary)){
            const inherited:Record<string,string>={},overrides:string[]=[];
            for(const [key,v]of vs){if(v.exported||v.origin==='environment')inherited[key]=await expand(v.value,vs,recipe.evidence,{},cwd);if(v.origin==='command')overrides.push(key+'='+await expand(v.value,vs,recipe.evidence,{},cwd));}
            await make([...overrides,...argv.slice(1)],cwd,inherited,[...chain,recipe.evidence],depth+1);continue;
          }
          if(!/(?:^|-)gcc$|^(?:cc|dcc|clang)$/.test(binary)){
            // A recipe for a generated artifact does not redefine a known compiler invocation.
            if(/\.(?:h|o|obj|elf|map|srec|bin|txt|dld)$/i.test(name)||/^(?:mkdir|sync)$/.test(binary)){
              if(profile.issues.length<128)profile.issues.push({code:'unresolved-artifact',message:`Generated artifact is not evaluated: ${name}`,evidence:recipe.evidence});
              if(/\.h$/i.test(name))(profile.unresolvedArtifacts??=[]).push(resolveBuildUri(cwd,name));
            }else issue('unsupported-recipe',`Recipe cannot be evaluated statically: ${argv[0]}`,recipe.evidence);
            continue;
          }
          if(argv.some(v=>/[;&|<>`]/.test(v))){issue('unsupported-recipe','Shell operators in compile command',recipe.evidence);continue;}
          const source=argv.find(arg=>/\.[cC]$/.test(arg));if(!source){if(argv.includes('-c'))issue('missing-source','Compile command has no resolved source',recipe.evidence);continue;}
          const unit=await normalizeCompileContext({profileId:profile.id,sourceUri:resolveBuildUri(cwd,source),cwdUri:cwd,argv,dialect:'posix',evidence:[...chain,recipe.evidence]},fs);
          if(failed){unit.status='partial';unit.membership='unknown';unit.issues.push(...profile.issues);}
          profile.units.push(unit);
        }
      }
      visiting.delete(name);visited.add(key);
      } finally {failed=priorFailure;}
    }
    for(const name of selected.length?selected:defaultTarget?[defaultTarget]:[])await target(name,0,variables);
    if(!defaultTarget&&!selected.length)issue('missing-target','No statically known Make target');
  }
  const scriptStack = new Set<string>();
  async function script(uri: string, args: string[], cwd: string, env: Record<string, string | undefined>, dialect: 'sh' | 'cmd', chain: BuildEvidence[], depth: number, exported = new Set(Object.keys(env))): Promise<{ env: Record<string, string | undefined>; cwd: string; exported:Set<string> } | undefined> {
    const key=fingerprintBuildInput([uri,args,cwd,env]);
    if(depth>32||scriptStack.has(key)){issue('script-cycle',`Script cycle/depth: ${uri}`);return;}
    const text=await read(uri);if(text===undefined)return;scriptStack.add(key);
    const local={...env},scopes:Record<string,string|undefined>[]=[],directories:string[]=[];
    const nameKey=(name:string)=>dialect==='cmd'?Object.keys(local).find(key=>key.toLowerCase()===name.toLowerCase())??name:name;
    const set=(name:string,value:string)=>{const key=nameKey(name);local[key]=value;exported.add(key);};
    const substitute=(value:string,evidence:BuildEvidence)=>{
      const variable=(name:string)=>{const key=nameKey(name);if(!(key in local)){issue('unknown-script-variable',`Missing script variable: ${name}`,evidence);return unknown;}usedEnvironment.add(key);return local[key]??'';};
      if(dialect==='cmd')return value.replace(/%~dp0/gi,decodeURIComponent(new URL(buildDirectory(uri)+'/').pathname).replace(/^\/([A-Za-z]:)/,'$1')).replace(/%([A-Za-z_]\w*)%|%([1-9])/g,(_m,name,position)=>name?variable(name):args[Number(position)-1]??(issue('missing-script-argument',`Missing argument ${position}`,evidence),unknown));
      if(/`|\$\(/.test(value)){issue('unsupported-expression','Dynamic shell expression',evidence);return unknown;}
      return value.replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)|\$([1-9])/g,(_m,brace,name,position)=>position?args[Number(position)-1]??(issue('missing-script-argument',`Missing argument ${position}`,evidence),unknown):variable(brace??name));
    };
    try {
      for(const {text:original,line}of logicalLines(text,dialect==='cmd'?'^':'\\')){
        const evidence={uri,line,expression:original};if(++operations>20_000){issue('extraction-limited','Build statement limit',evidence);break;}
        let value=original.trim().replace(/^@/,'');
        if(!value||/^#!|^#|^::|^rem\b/i.test(value))continue;
        const redirected=dialect==='cmd'?/^echo\s+(.+?)\s*(>>|>)\s*("[^"]+"|[^\s<>]+)$/i.exec(value):undefined;
        if(redirected){
          const target=resolveBuildUri(cwd,substitute(redirected[3].replace(/^"|"$/g,''),evidence));
          const payload=substitute(redirected[1].trimEnd(),evidence);
          if(!/\.(?:cfg|mk)$/i.test(target)||/[;&|<>`!\u0000]/.test(payload+target)){issue('unsupported-statement','Echo has unresolved file effects',evidence);continue;}
          const previous=await read(target,evidence,true);
          const next=(redirected[2]==='>>'?previous??'':'')+payload+'\n';
          if(next.length>1_048_576||overlay.size>=128){issue('extraction-limited','Generated build metadata limit',evidence);continue;}
          overlay.set(metadataKey(target),next);continue;
        }
        if(/^echo(?:\b|\.)/i.test(value)){if(/[;&|<>`]|\$\(/.test(value))issue('unsupported-statement','Echo has shell side effects',evidence);continue;}
        if(/^setlocal(?:\s|$)/i.test(value)){if(/enabledelayedexpansion/i.test(value))issue('unsupported-statement','Delayed cmd expansion',evidence);scopes.push({...local});continue;}
        if(/^endlocal$/i.test(value)){const prior=scopes.pop();if(prior){for(const key of Object.keys(local))delete local[key];Object.assign(local,prior);}else issue('invalid-scope','Unexpected endlocal',evidence);continue;}
        if(dialect==='sh')value=value.replace(/\s+#.*$/,'');
        const assignment=dialect==='cmd'?/^(?:set\s+"?([A-Za-z_]\w*)=(.*?)"?|(?:(PATH)=|path\s+)(.*))$/i.exec(value):/^(?:export\s+)?([A-Za-z_]\w*)=(.*)$/.exec(value);
        if(assignment){const name=assignment[1]??assignment[3]??'PATH',raw=substitute(assignment[1]?assignment[2]:assignment[4],evidence);
          // cmd SET preserves spaces, quotes and semicolon-separated PATH values.
          const wasExported=exported.has(name);set(name,dialect==='cmd'?raw:words(raw,'posix',evidence).join(' '));if(dialect==='sh'&&!/^export\s+/.test(value)&&!wasExported)exported.delete(name);continue;}
        if(dialect==='sh'&&/^export\s+[A-Za-z_]\w*$/.test(value)){exported.add(value.split(/\s+/)[1]);continue;}
        value=substitute(value,evidence);if(value.includes(unknown))continue;
        const argv=words(value,dialect==='cmd'?'windows':'posix',evidence);if(!argv.length)continue;
        if(argv.some(v=>/[;&|<>`]/.test(v))){issue('unsupported-statement','Compound shell statement',evidence);continue;}
        const commandText=argv.shift()!,command=commandText.toLowerCase();
        if(dialect==='cmd'&&/^(?:pause|timeout)$/i.test(command))continue;
        if(dialect==='cmd'&&/^(?:del|erase)$/.test(command)){
          for(const name of argv.filter(v=>!v.startsWith('/'))){const target=resolveBuildUri(cwd,name);
            if(/[?*]/.test(name)||!/\.(?:cfg|mk|o|obj|elf|map|srec|bin|exe)$/i.test(name)){issue('unsupported-statement',`Unresolved deletion: ${name}`,evidence);continue;}
            if(/\.(?:cfg|mk)$/i.test(name)){await read(target,evidence,true);overlay.set(metadataKey(target),undefined);}
          }continue;
        }
        if(command==='cd'||command==='pushd'){if(argv[0]?.toLowerCase()==='/d')argv.shift();if(command==='pushd')directories.push(cwd);if(argv.length===1)cwd=resolveBuildUri(cwd,argv[0]);else issue('unsupported-directory','Directory not resolved',evidence);}
        else if(command==='popd'){const prior=directories.pop();if(prior)cwd=prior;else issue('unsupported-directory','Unmatched popd',evidence);}
        else if(/^(?:.*[\\/])?g?make(?:\.exe)?$/.test(command))await make(argv,cwd,dialect==='cmd'?local:Object.fromEntries([...exported].map(name=>[name,local[name]])),[...chain,evidence],depth+1);
        else if(['sh','bash','call','.','source'].includes(command)||dialect==='cmd'&&/\.(?:bat|cmd)$/i.test(command)){
          const direct=/\.(?:bat|cmd)$/i.test(command),next=direct?commandText:argv.shift();if(!next){issue('missing-script','Script path missing',evidence);continue;}
          const shared=direct||['call','.','source'].includes(command),inherited=shared?local:Object.fromEntries([...exported].map(name=>[name,local[name]]));
          const result=await script(resolveBuildUri(cwd,next),argv,cwd,inherited,/\.(?:bat|cmd)$/i.test(next)?'cmd':'sh',[...chain,evidence],depth+1,shared?new Set(exported):new Set(Object.keys(inherited)));
          if(result&&shared){for(const key of Object.keys(local))delete local[key];Object.assign(local,result.env);cwd=result.cwd;exported=result.exported;}
          if(direct)break;
        }else issue('unsupported-statement',`Unresolved script statement: ${command}`,evidence);
      }
      return {env:local,cwd,exported};
    } finally {scriptStack.delete(key);}
  }
  if (entry.dialect === 'make') await make(['-f', entry.entryUri, ...entry.args], entry.cwdUri, environment, entry.evidence, 0);
  else await script(entry.entryUri, entry.args, entry.cwdUri, environment, entry.dialect, entry.evidence, 0);
  profile.units = [...new Map(profile.units.map(unit => [unit.id, unit])).values()];
  // Reaching some compile recipes does not prove the full target/link source set.
  profile.coverage = 'partial';
  profile.dependencies = [...dependencies].map(([uri, digest]) => ({ uri, digest }));
  profile.units.forEach(unit => unit.dependencies.forEach(d => { if (!dependencies.has(d.uri)) profile.dependencies.push(d); }));
  profile.relevantEnvironment = [...usedEnvironment].filter(name => environment[name] !== undefined).sort();
  profile.unresolvedArtifacts=[...new Set(profile.unresolvedArtifacts??[])];
  profile.fingerprint = fingerprintBuildInput([entry, profile.units.map(u => u.fingerprint), profile.dependencies, profile.relevantEnvironment.map(name => [name, environment[name]]), profile.issues,profile.unresolvedArtifacts]);
  return profile;
}
