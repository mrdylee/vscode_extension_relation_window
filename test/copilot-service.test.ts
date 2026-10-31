import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RelationIndex } from '../src/relations';
import { createAnalyzer } from '../src/analyzer';
import { callbackContexts } from '../src/copilot-context';
const require = createRequire(path.resolve('package.json'));
const bundle = buildSync({ entryPoints: ['src/copilot-service.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vscode','./cli-callback-provider','./ai-extensions'] }).outputFiles[0].text;
class Emitter {
  listeners = new Set<(...args: any[]) => void>();
  event = (listener: (...args: any[]) => void) => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; };
  fire(value?: any) { for (const listener of this.listeners) listener(value); }
}
async function harness(denied=false, timeoutMs?:number, siteCount=denied?2:1, replyDelayMs=0) {
  const storage=await mkdtemp(path.join(tmpdir(),'dynsight-service-'));
  const parser=await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'),path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm'));
  const file=parser.analyze('file:///example.c','struct Ops{void(*cb_complete)(void);};'+
    Array.from({length:siteCount}, (_, n) => `void run${n || ''}(struct Ops*p){p->cb_complete();}`).join(''));
  const config=new Map<string,unknown>([['copilotCallbacks',false],['copilotModel',''],['copilotInclude',['**']],['detailedAnalysisFolders',['**']],['smartAnalysis.provider','copilot']]);
  let installed=['copilot','claude','codex'],cliFailure=false,activeCli=0,maxActiveCli=0;
  const aiExtensions={installedAiExtensions:()=>installed.map(value=>({label:value,value})),bundledAiEngine:async(provider:string)=>{
    if(!installed.includes(provider))throw new Error('Install the selected AI extension');return `/extensions/${provider}/bundled`;
  }};
  const calls:string[]=[],queries:unknown[]=[],messages:string[]=[],prompts:string[]=[];
  const cliSelections:{provider:string;model:string;executable:string}[]=[],cliSignals:AbortSignal[]=[];
  const pickerCalls:{title:string;labels:string[]}[]=[],catalogCalls:string[]=[],stateWrites:{key:string;value:unknown}[]=[];
  let picks:(string|undefined)[]|undefined;
  const uri = (value: string) => ({ path: new URL(value).pathname, toString: () => value });
  const folders = [{ uri: uri('file:///') }];
  const folderConfigs = new Map<string, Map<string, unknown>>();
  const commands=new Map<string,(...args:any[])=>Promise<void>>(),settings=new Emitter(),state=new Map<string,unknown>();
  const permissions=new Map<string,boolean>();let pick='model-a',pickCount=0;
  let held: {id:string; phase:string; afterCalls:number; started:()=>void; promise:Promise<void>} | undefined;
  let heldSetting: { key: string; started: () => void; promise: Promise<void> } | undefined;
  async function waitHeld(id:string,phase:string) {
    if(held?.id===id && held.phase===phase && calls.length>=held.afterCalls){const waiting=held;held=undefined;waiting.started();await waiting.promise;}
  }
  const tokens:{cancelled:boolean}[]=[];
  let reply=(prompt:string)=>'{"status":"not-found","candidates":[]}';
  const models=['model-a','model-b'].map(id=>({id,vendor:'copilot',name:id,family:'test',version:'1',maxInputTokens:64000,
    countTokens:async()=>{await waitHeld(id,'countTokens');return 100;},sendRequest:async(_messages:unknown,_options:unknown,token:{cancelled:boolean})=>{
      calls.push(id);prompts.push((_messages as string[])[0]);permissions.set(id,!denied);if(denied)throw new Error('Access denied');
      tokens.push(token);await waitHeld(id,'sendRequest');
      if(replyDelayMs)await new Promise(done=>setTimeout(done,replyDelayMs));
      return{text:(async function*(){await waitHeld(id,'stream');yield reply((_messages as string[])[0]);})()};
    }}));
  let available=models;
  async function update(key:string,value:unknown){config.set(key,value);settings.fire({affectsConfiguration:(name:string)=>name===`dynsight.${key}`});}
  const vscode={lm:{selectChatModels:async(selector:{id?:string})=>{queries.push(selector);if(selector.id)await waitHeld(selector.id,'discovery');return available;}},
    commands:{registerCommand:(id:string,command:any)=>{commands.set(id,command);return{dispose(){}};}},
    Uri: { parse: uri },
    workspace:{isTrusted:true,workspaceFolders:folders,getConfiguration:(_section:string,resource?:ReturnType<typeof uri>)=>({get:(key:string,fallback:unknown)=>(folderConfigs.get(resource?.toString() ?? '')?.get(key) ?? config.get(key))??(key==='detailedAnalysisFolders'?[]:fallback),
      inspect:(key:string)=>({workspaceValue:config.get(key),workspaceFolderValue:folderConfigs.get(resource?.toString() ?? '')?.get(key)}),
      update:async(key:string,value:unknown,target?:number)=>{if(heldSetting?.key===key){const waiting=heldSetting;heldSetting=undefined;waiting.started();await waiting.promise;}if(target===3&&resource){const values=folderConfigs.get(resource.toString())??new Map();values.set(key,value);folderConfigs.set(resource.toString(),values);settings.fire({affectsConfiguration:(name:string,scope?:ReturnType<typeof uri>)=>name===`dynsight.${key}`&&(!scope||scope.toString()===resource.toString())});}else await update(key,value);}}),onDidChangeConfiguration:settings.event,
      getWorkspaceFolder:(value:ReturnType<typeof uri>)=>[...folders].reverse().find(folder=>value.toString().startsWith(folder.uri.toString())),
      asRelativePath:(value:ReturnType<typeof uri>)=>{const folder=[...folders].reverse().find(folder=>value.toString().startsWith(folder.uri.toString()));return decodeURIComponent(value.toString().slice(folder?.uri.toString().length ?? 0));}},
    ConfigurationTarget:{Workspace:2,WorkspaceFolder:3},window:{showQuickPick:async(items:any[],options:any)=>{pickCount++;pickerCalls.push({title:options.title,labels:items.map(item=>item.label)});const target=picks?.length?picks.shift():pick;if(target===undefined)return undefined;await waitHeld(target,'picker');return items.find(item=>(item.value.id??item.value)===target) ?? items[0];},showErrorMessage:async(value:string)=>{messages.push(value);},showInformationMessage:async(value:string)=>{messages.push(value);}},
    LanguageModelChatMessage:{User:(value:string)=>value},CancellationTokenSource:class{token={cancelled:false};cancel(){this.token.cancelled=true;}dispose(){}}
  };
  const context={storageUri:{fsPath:storage},subscriptions:[]as{dispose():void}[],workspaceState:{get:(key:string)=>state.get(key),update:async(key:string,value:unknown)=>{stateWrites.push({key,value});state.set(key,value);}},languageModelAccessInformation:{canSendRequest:(model:{id:string})=>permissions.get(model.id)}};
  const workspace={index:new RelationIndex(),ready:Promise.resolve(),stable:true,generation:1,analysisKey:'key',hasDirtySources:false,
    copilotWaitReason:undefined as string|undefined,
    sourceChanged:new Emitter(),settled:new Emitter(),changed:new Emitter(),diagnosticsChanged:new Emitter(),whenIdle:async()=>{},copilotDiagnostics:undefined as any};
  workspace.index.update(file);
  function stop(){for(const item of context.subscriptions.splice(0))item.dispose();}
  const cli={listCliModels:async(options:{provider:string},signal:AbortSignal)=>{catalogCalls.push(options.provider);await Promise.race([waitHeld(options.provider,'models'),new Promise<never>((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}))]);return[{id:options.provider+'-balanced',label:'Balanced model'},{id:options.provider+'-fast',label:'Fast model'}];},createCliCallbackProvider:async(options:{provider:string;model:string;executable:string})=>{cliSelections.push(options);return{modelKey:JSON.stringify(options),complete:async(prompt:string,signal:AbortSignal)=>{
    calls.push(options.provider);prompts.push(prompt);cliSignals.push(signal);activeCli++;maxActiveCli=Math.max(maxActiveCli,activeCli);
    try {
      if(cliFailure)throw new Error('Selected extension request failed');
      await Promise.race([waitHeld(options.provider,'sendRequest'),new Promise<never>((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}))]);
      return reply(prompt);
    } finally {activeCli--;}
  }};}};
  function start(){const module={exports:{}as any};runInNewContext(bundle,{module,exports:module.exports,process,Buffer,URL,AbortController,setTimeout:(fn:()=>void,ms:number)=>setTimeout(fn,ms===60_000&&timeoutMs!==undefined?timeoutMs:ms),clearTimeout,setImmediate,require:(name:string)=>name==='vscode'?vscode:name==='./cli-callback-provider'?cli:name==='./ai-extensions'?aiExtensions:require(name)});return module.exports.registerCopilotCallbacks(context,workspace);}
  async function startPaused(){const api=start();await commands.get('dynsight.stopCopilotAnalysis')!();await api.ready;return api;}
  return{start,startPaused,stop,config,commands,calls,prompts,queries,messages,workspace,update,state,tokens,folders,folderConfigs,cliSelections,cliSignals,vscode,pickerCalls,catalogCalls,stateWrites,
    picks:(values:(string|undefined)[])=>{picks=values;},
    installed:(ids:string[])=>{installed=ids;},failCli:()=>{cliFailure=true;},maxActiveCli:()=>maxActiveCli,
    setReply:(value:(prompt:string)=>string)=>{reply=value;},
    updateMany:async(values:Record<string,unknown>)=>{for(const [key,value]of Object.entries(values))config.set(key,value);settings.fire({affectsConfiguration:(name:string)=>Object.keys(values).some(key=>name===`dynsight.${key}`)});await new Promise<void>(done=>setImmediate(done));},
    holdSetting:(key:string)=>{let release!:()=>void,started!:()=>void;const observed=new Promise<void>(done=>{started=done;});const promise=new Promise<void>(done=>{release=done;});heldSetting={key,started,promise};return{started:observed,release};},
    addFile:(value:string,text:string)=>{workspace.index.update(parser.analyze(value,text));workspace.generation++;},
    holdNext:(id:string,phase='sendRequest',afterCalls=0)=>{let release!:()=>void,reject!:(error:Error)=>void,started!:()=>void;const observed=new Promise<void>(done=>{started=done;});const promise=new Promise<void>((done,fail)=>{release=done;reject=fail;});held={id,phase,afterCalls,started,promise};return{started:observed,release,reject};},
    pick:(id:string)=>{pick=id;},pickCount:()=>pickCount,available:(ids:string[])=>{available=models.filter(model=>ids.includes(model.id));},
    dispose:async()=>{stop();await rm(storage,{recursive:true,force:true});}};
}

const settle=()=>new Promise(done=>setTimeout(done,50));
async function until(check:()=>boolean){const deadline=Date.now()+3000;while(!check()&&Date.now()<deadline)await new Promise(done=>setTimeout(done,10));assert.ok(check(),'service did not reach the expected state');}
const firstSite=(h:Awaited<ReturnType<typeof harness>>)=>({siteKey:callbackContexts([...h.workspace.index.files.values()])[0].key});
test('enabling the single AI checkbox immediately guides provider then model before any source request',async t=>{
  const h=await harness();t.after(h.dispose);h.workspace.stable=false;h.config.set('smartAnalysis.include',[]);h.picks(['codex','codex-balanced']);
  await h.start().ready;await h.update('smartAnalysis.ai',true);
  await until(()=>!!h.state.get('smartAiSelection-v1'));
  assert.match(h.pickerCalls[0].title,/1\/2/);assert.match(h.pickerCalls[1].title,/2\/2/);
  assert.deepEqual(h.catalogCalls,['codex']);assert.deepEqual(h.calls,[]);
  assert.equal((h.state.get('smartAiSelection-v1') as any).modelId,'codex-balanced');
  assert.equal(h.stateWrites.filter(value=>value.key==='smartAiSelection-v1').length,1);
  assert.equal(h.config.get('smartAnalysis.provider'),'copilot','hidden provider setting is never written');
});
for(const phase of [1,2])test(`cancelling AI setup step ${phase} leaves the checkbox off and saves no partial choice`,async t=>{
  const h=await harness();t.after(h.dispose);h.picks(phase===1?[undefined]:['claude',undefined]);
  await h.start().ready;await h.update('smartAnalysis.ai',true);
  await until(()=>h.config.get('smartAnalysis.ai')===false);
  assert.equal(h.state.get('smartAiSelection-v1'),undefined);assert.deepEqual(h.calls,[]);
});
test('guided model choice is persisted, passed to the selected provider and restored without another picker',async t=>{
  const h=await harness();t.after(h.dispose);h.picks(['codex','codex-fast']);
  await h.start().ready;await h.update('smartAnalysis.ai',true);
  await until(()=>h.calls.length===1&&h.workspace.copilotDiagnostics.state==='ready');
  assert.equal(h.cliSelections[0].model,'codex-fast');assert.equal(h.workspace.copilotDiagnostics.model,'Fast model');
  h.stop();await h.start().ready;assert.equal(h.pickerCalls.length,2);assert.deepEqual(h.calls,['codex']);
});
test('reconfiguring the guided model uses separate caches and cancellation keeps the completed choice',async t=>{
  const h=await harness();t.after(h.dispose);h.picks(['codex','codex-fast']);await h.start().ready;await h.update('smartAnalysis.ai',true);
  await until(()=>h.calls.length===1&&h.workspace.copilotDiagnostics.state==='ready');
  h.picks(['codex','codex-balanced']);await h.commands.get('dynsight.configureAi')!();await until(()=>h.calls.length===2&&h.workspace.copilotDiagnostics.state==='ready');
  assert.deepEqual(h.cliSelections.map(value=>value.model),['codex-fast','codex-balanced']);
  const before=JSON.stringify(h.state.get('smartAiSelection-v1'));
  h.picks(['claude',undefined]);await h.commands.get('dynsight.configureAi')!();await settle();
  assert.equal(JSON.stringify(h.state.get('smartAiSelection-v1')),before);assert.deepEqual(h.calls,['codex','codex']);
  h.picks(['codex','codex-fast']);await h.commands.get('dynsight.configureAi')!();await until(()=>h.workspace.copilotDiagnostics.state==='ready');
  assert.equal(h.calls.length,2,'returning to the first model reuses its own validated cache');assert.equal(h.maxActiveCli(),1);
});
test('turning AI off cancels model discovery and cannot commit a late selection',async t=>{
  const h=await harness();t.after(h.dispose);h.picks(['codex','codex-fast']);const held=h.holdNext('codex','models');
  await h.start().ready;await h.update('smartAnalysis.ai',true);await held.started;
  await h.update('smartAnalysis.ai',false);held.release();await settle();
  assert.equal(h.state.get('smartAiSelection-v1'),undefined);assert.deepEqual(h.calls,[]);assert.equal(h.pickerCalls.length,1);
});
for(const provider of ['claude','codex'])test(`Smart Analysis uses only the selected ${provider} extension when all three are installed`,async t=>{
  const h=await harness();t.after(h.dispose);
  h.config.set('smartAnalysis.ai',true);h.config.set('smartAnalysis.provider',provider);h.config.set('smartAnalysis.include',['**']);
  h.config.set(`smartAnalysis.${provider}Model`,'chosen-model');
  await h.start().ready;
  assert.deepEqual(h.calls,[provider]);assert.equal(h.queries.length,0);
  assert.equal(h.cliSelections[0].model,'','old typed IDs are ignored in favor of the default model');assert.equal(h.cliSelections[0].executable,`/extensions/${provider}/bundled`);
  assert.equal(h.workspace.copilotDiagnostics.provider,provider==='claude'?'Claude Code':'Codex');
  await h.commands.get('dynsight.analyzeCallbacksWithAI')!();assert.deepEqual(h.calls,[provider]);
});
test('Copilot alone handles requests when all three are installed and Copilot is selected',async t=>{
  const h=await harness();t.after(h.dispose);h.config.set('smartAnalysis.ai',true);h.config.set('copilotModel','model-a');
  await h.start().ready;assert.deepEqual(h.calls,['model-a']);assert.equal(h.cliSelections.length,0);
});
test('first-time setup guides both steps even with one installed extension',async t=>{
  const h=await harness();t.after(h.dispose);h.installed(['codex']);h.config.set('smartAnalysis.ai',true);h.config.set('smartAnalysis.provider','auto');
  await h.start().ready;assert.deepEqual(h.calls,['codex']);assert.equal(h.pickCount(),2);assert.equal((h.state.get('smartAiSelection-v1') as any).provider,'codex');
});
test('Auto asks once when all three are installed, saves one provider and only uses that provider',async t=>{
  const h=await harness();t.after(h.dispose);h.pick('codex');h.config.set('smartAnalysis.ai',true);h.config.set('smartAnalysis.provider','auto');
  await h.start().ready;assert.deepEqual(h.calls,['codex']);assert.equal((h.state.get('smartAiSelection-v1') as any).provider,'codex');assert.equal(h.pickCount(),2);
  h.stop();await h.start().ready;assert.deepEqual(h.calls,['codex']);assert.equal(h.pickCount(),2);
});
test('selected extension failure does not try either of the other installed providers',async t=>{
  const h=await harness();t.after(h.dispose);h.failCli();h.config.set('smartAnalysis.ai',true);h.config.set('smartAnalysis.provider','codex');
  await h.start().ready;await settle();assert.deepEqual(h.calls,['codex']);assert.equal(h.queries.length,0);assert.equal(h.workspace.copilotDiagnostics.state,'request-failed');
});
test('missing selected extension does not fall back to the remaining installed extensions',async t=>{
  const h=await harness();t.after(h.dispose);h.installed(['copilot','claude']);h.config.set('smartAnalysis.ai',true);h.config.set('smartAnalysis.provider','codex');
  await h.start().ready;assert.deepEqual(h.calls,[]);assert.equal(h.queries.length,0);assert.equal(h.workspace.copilotDiagnostics.state,'request-failed');
});
test('cancelling the extension choice leaves all installed providers idle',async t=>{
  const h=await harness();t.after(h.dispose);h.config.set('smartAnalysis.ai',true);h.config.set('smartAnalysis.provider','auto');
  (h.vscode.window as any).showQuickPick=async()=>undefined;
  await h.start().ready;assert.deepEqual(h.calls,[]);assert.equal(h.cliSelections.length,0);assert.equal(h.queries.length,0);
  assert.equal(h.config.get('smartAnalysis.provider'),'auto');assert.equal(h.workspace.copilotDiagnostics.state,'provider-unavailable');
});
test('new AI off overrides legacy Copilot on and untrusted workspaces never launch a CLI',async t=>{
  const h=await harness();t.after(h.dispose);h.config.set('copilotCallbacks',true);h.config.set('copilotModel','model-a');h.config.set('smartAnalysis.ai',false);
  const api=h.start();await api.ready;assert.equal(h.calls.length,0);
  h.vscode.workspace.isTrusted=false;
  await h.updateMany({'smartAnalysis.ai':true,'smartAnalysis.provider':'claude'});await settle();assert.equal(h.cliSelections.length,0);
});
test('providers use separate default-model caches and obsolete model ID settings cannot change them',async t=>{
  const h=await harness();t.after(h.dispose);h.config.set('smartAnalysis.ai',true);h.config.set('smartAnalysis.provider','claude');
  await h.start().ready;
  await h.update('smartAnalysis.provider','codex');await until(()=>h.calls.length===2&&h.workspace.copilotDiagnostics.state==='ready');
  await h.update('smartAnalysis.provider','claude');await until(()=>h.workspace.copilotDiagnostics.cacheHits===1&&h.workspace.copilotDiagnostics.state==='ready');
  assert.deepEqual(h.calls,['claude','codex']);
  await h.update('smartAnalysis.claudeModel','different');await settle();assert.equal(h.calls.length,2);
});
test('changing provider cancels the old CLI request before the new provider starts',async t=>{
  const h=await harness();t.after(h.dispose);h.config.set('smartAnalysis.ai',true);h.config.set('smartAnalysis.provider','claude');
  const hold=h.holdNext('claude');const api=h.start();await hold.started;
  await h.update('smartAnalysis.provider','codex');await api.ready;
  await until(()=>h.calls.includes('codex')&&h.workspace.copilotDiagnostics.state==='ready');
  assert.equal(h.cliSignals[0].aborted,true);assert.equal(h.maxActiveCli(),1,'old provider settles before the new provider starts');hold.release();
});
for(const provider of ['claude','codex'])test(`${provider} model commands use the default model without asking for an ID`,async t=>{
  const h=await harness();t.after(h.dispose);h.config.set('smartAnalysis.ai',true);h.config.set('smartAnalysis.provider',provider);
  let inputCount=0;(h.vscode.window as any).showInputBox=async()=>{inputCount++;return 'typed-model';};
  await h.start().ready;
  for(const command of ['dynsight.selectAiModel','dynsight.selectCopilotModel']) {
    h.picks([provider,'']);
    await h.commands.get(command)!();await settle();
    assert.equal(inputCount,0,'neither current nor legacy commands can open a model ID input');
  }
  assert.ok(h.cliSelections.every(value=>value.model===''));assert.deepEqual(h.calls,[provider]);
  assert.equal(h.pickerCalls.length,4,'both aliases guide extension then model');
});
test('Copilot model command still uses the available model list without a text input',async t=>{
  const h=await harness();t.after(h.dispose);h.pick('model-b');
  (h.vscode.window as any).showInputBox=async()=>{throw new Error('No model ID input allowed');};
  await h.start().ready;await h.commands.get('dynsight.selectAiModel')!();
  assert.equal((h.state.get('smartAiSelection-v1') as any).modelId,'model-b');assert.equal(h.pickCount(),2);assert.equal(h.calls.length,0);
});
for(const partial of [false,true])test(`selected ${partial?'partial':'empty'} Build preserves basic-index AI callback edges`,async t=>{
  const h=await harness();t.after(h.dispose);
  h.config.set('copilotCallbacks',true);h.config.set('copilotModel','model-a');
  h.addFile('file:///registration.c','struct Ops{void(*cb_complete)(void);};void target(void){}void replacement(void){}void configure(struct Ops*p){p->cb_complete=target;}');
  const basic=h.workspace.index,build=new RelationIndex();
  if(partial){const parser=await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'),path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm'));build.update(parser.analyze('file:///covered.c','void covered(void){}'));}
  h.workspace.index=build;(h.workspace as any).callbackIndexes=[basic,build];
  h.setReply(prompt=>{const value=JSON.parse(prompt.split('CONTEXT_JSON\n')[1]),target=value.targets.find((item:any)=>item.name==='target');assert.ok(target);return JSON.stringify({status:'candidates',candidates:[{targetId:target.id,evidenceIds:target.evidenceIds,reason:'Registration chain'}]});});
  const api=h.start();await api.ready;
  assert.equal(h.calls.length,1);assert.equal(h.workspace.copilotDiagnostics.candidates,1);
  assert.ok(basic.files.get('file:///example.c')!.references.some(ref=>ref.callKind==='ai-candidate'));
  const call=basic.files.get('file:///example.c')!.references.find(ref=>ref.callKind==='ai-candidate')!;
  assert.equal(basic.callbackAt('file:///example.c',call.location.end-1)?.targets[0].name,'target');
  h.stop();const calls=h.calls.length;const restored=h.start();await restored.ready;
  assert.equal(h.calls.length,calls,'restart restores the same basic-context AI cache');
  assert.ok(basic.files.get('file:///example.c')!.references.some(ref=>ref.callKind==='ai-candidate'));
  const action={siteKey:callbackContexts([...basic.files.values()])[0].key,targetId:call.targetId};
  const choices=await restored.actions.search(action,'replacement');assert.equal(choices.length,1);
  await restored.actions.setTarget(action,choices[0].id);
  const manual=basic.files.get('file:///example.c')!.references.find(ref=>ref.callKind==='user-confirmed')!;
  assert.equal(manual.targetId,choices[0].id);
  await restored.actions.removeOverride({...action,overrideKey:manual.manual!.overrideKey});
  assert.ok(basic.files.get('file:///example.c')!.references.some(ref=>ref.callKind==='ai-candidate'));
  h.workspace.index=basic;(h.workspace as any).callbackIndexes=[basic];
  h.workspace.analysisKey='cleared-build-key';
  h.workspace.generation++;h.workspace.sourceChanged.fire('configuration');h.workspace.settled.fire();
  await until(()=>h.workspace.copilotDiagnostics.state==='ready');
  assert.equal(h.calls.length,calls+1,'changing Build settings revalidates the basic-context result');
  assert.ok(basic.files.get('file:///example.c')!.references.some(ref=>ref.callKind==='ai-candidate'));
});
test('Smart Analysis shares include/exclude while Copilot runs independently of Macro',async t=>{
  const h=await harness();t.after(h.dispose);
  h.config.set('smartAnalysis.copilot',true);h.config.set('copilotModel','model-a');
  h.config.set('smartAnalysis.include',['**']);h.config.set('smartAnalysis.exclude',['**']);h.config.set('smartAnalysis.macro',false);
  h.config.set('copilotInclude',[]);h.config.set('detailedAnalysisFolders',[]);
  const api=h.start();await api.ready;assert.equal(h.calls.length,0);
  await h.update('smartAnalysis.exclude',[]);await until(()=>h.calls.length===1&&h.workspace.copilotDiagnostics.state==='ready');
  await h.update('smartAnalysis.include',[]);await settle();assert.equal(h.workspace.copilotDiagnostics.excluded,1);
});
test('enabling Copilot automatically processes all sites and startup, save and rebuild reuse valid cache',async t=>{
  const h=await harness(false,undefined,8);t.after(h.dispose);const api=h.start();await api.ready;
  assert.equal(h.calls.length,0);assert.equal(h.pickCount(),0);
  await h.update('copilotCallbacks',true);await settle();
  await until(()=>h.workspace.copilotDiagnostics.state==='ready'&&h.workspace.copilotDiagnostics.completed===8);
  assert.equal(h.calls.length,8);assert.equal(h.pickCount(),2,'extension and model are selected; callbacks need no picker');
  h.workspace.sourceChanged.fire('editor-save');h.workspace.generation++;h.workspace.settled.fire();await settle();
  await until(()=>h.workspace.copilotDiagnostics.state==='ready');
  assert.equal(h.calls.length,8);assert.equal(h.workspace.copilotDiagnostics.cacheHits,8);
  h.workspace.sourceChanged.fire('configuration');h.workspace.settled.fire();await settle();
  assert.equal(h.calls.length,8);
  h.stop();await h.start().ready;
  assert.equal(h.calls.length,8);assert.equal(h.workspace.copilotDiagnostics.completed,8);
  await h.commands.get('dynsight.selectCopilotModel')!();await settle();
  assert.equal(h.calls.length,8);assert.equal(h.config.get('copilotInclude') instanceof Array,true);
});
test('enabled startup uses the configured model and continues beyond five requests',async t=>{
  const h=await harness(false,undefined,8);t.after(h.dispose);h.config.set('copilotCallbacks',true);h.config.set('copilotModel','model-a');
  const held=h.holdNext('model-a'),api=h.start();await until(()=>h.calls.length===1);await held.started;
  h.workspace.settled.fire();h.workspace.settled.fire();await settle();assert.equal(h.calls.length,1,'automatic requests and notifications must not overlap');
  held.release();await api.ready;assert.equal(h.calls.length,8);assert.equal(h.pickCount(),0);
  assert.equal(h.workspace.copilotDiagnostics.completed,8);assert.equal(h.workspace.copilotDiagnostics.remaining,0);
});
test('AI still analyzes a member callback when legacy local propagation is disabled',async t=>{
  const h=await harness();t.after(h.dispose);
  h.config.delete('detailedAnalysisFolders');h.config.set('analyzeCallbacks',false);
  h.config.set('copilotCallbacks',true);h.config.set('copilotModel','model-a');
  h.addFile('file:///example.c','struct Ops{void(*cb_preprocess)(void);};extern struct Ops*priv_non_safety_callbacks;void run(void){priv_non_safety_callbacks->cb_preprocess();}');
  const raw=h.workspace.index.files.get('file:///example.c')!;
  h.workspace.index.update({...raw,analysisPolicy:{expandMacros:false,propagateCallbacks:false}});
  await h.start().ready;
  assert.equal(h.calls.length,1);
  assert.equal(h.workspace.copilotDiagnostics.total,1);
  assert.ok(h.prompts[0].includes('priv_non_safety_callbacks->cb_preprocess'));
});
test('empty AI include reports excluded callback sites rather than claiming none exist',async t=>{
  const h=await harness();t.after(h.dispose);
  h.config.set('copilotCallbacks',true);h.config.set('copilotModel','model-a');h.config.set('copilotInclude',[]);
  await h.start().ready;
  assert.equal(h.calls.length,0);
  assert.equal(h.workspace.copilotDiagnostics.excluded,1);
  assert.equal(h.pickCount(),0);
});
test('automatic analysis handles new saved callbacks and an individual recheck does not inflate progress',async t=>{
  const h=await harness();t.after(h.dispose);h.config.set('copilotCallbacks',true);h.config.set('copilotModel','model-a');
  const api=h.start();await api.ready;
  await api.actions.analyze(firstSite(h),true);assert.equal(h.workspace.copilotDiagnostics.completed,1);assert.equal(h.workspace.copilotDiagnostics.total,1);
  h.workspace.sourceChanged.fire('editor-save');h.addFile('file:///example.c','struct Ops{void(*cb_complete)(void);};void run(struct Ops*p){p->cb_complete();p->cb_complete();}');h.workspace.settled.fire();
  await until(()=>h.workspace.copilotDiagnostics.state==='ready'&&h.workspace.copilotDiagnostics.completed===2);
  assert.equal(h.workspace.copilotDiagnostics.remaining,0);assert.equal(h.calls.length,4);
});
test('an unavailable configured model pauses automation without fallback or repeated discovery',async t=>{
  const h=await harness();t.after(h.dispose);h.config.set('copilotCallbacks',true);h.config.set('copilotModel','model-b');h.available(['model-a']);
  await h.start().ready;assert.equal(h.calls.length,0);assert.equal(h.pickCount(),0);assert.equal(h.workspace.copilotDiagnostics.state,'model-unavailable');
  h.workspace.settled.fire();await settle();assert.equal(h.queries.length,1);
  await h.update('copilotModel','model-a');await until(()=>h.calls.length===1&&h.workspace.copilotDiagnostics.state==='ready');
  assert.deepEqual(h.calls,['model-a']);
});
test('automatic analysis waits for saved sources and honors empty or excluded scope',async t=>{
  const h=await harness();t.after(h.dispose);h.config.set('copilotCallbacks',true);h.config.set('copilotModel','model-a');h.workspace.hasDirtySources=true;
  await h.start().ready;assert.equal(h.calls.length,0);
  await h.update('copilotInclude',[]);h.workspace.hasDirtySources=false;h.workspace.settled.fire();await settle();assert.equal(h.calls.length,0);
  await h.updateMany({copilotInclude:['**'],copilotExclude:['**']});await settle();assert.equal(h.calls.length,0);
  await h.updateMany({copilotExclude:[],detailedAnalysisFolders:[]});await settle();assert.equal(h.calls.length,0);
  await h.update('detailedAnalysisFolders',['**']);await until(()=>h.calls.length===1&&h.workspace.copilotDiagnostics.state==='ready');
});
test('Stop keeps automatic analysis paused across index notifications until explicitly resumed',async t=>{
  const h=await harness(false,undefined,8);t.after(h.dispose);h.config.set('copilotCallbacks',true);h.config.set('copilotModel','model-a');
  h.addFile('file:///targets.c','struct Ops{void(*cb_complete)(void);};void target(void){}struct Ops config={.cb_complete=target};');
  h.setReply(prompt=>{const context=JSON.parse(prompt.split('CONTEXT_JSON\n')[1]);const target=context.targets.find((value:any)=>value.name==='target');return JSON.stringify({status:'candidates',candidates:[{targetId:target.id,evidenceIds:target.evidenceIds,reason:'Explicit registration'}]});});
  const held=h.holdNext('model-a','sendRequest',3),api=h.start();await until(()=>h.calls.length===3);await held.started;
  await h.commands.get('dynsight.stopCopilotAnalysis')!();held.release();await api.ready;
  assert.equal(h.calls.length,3);assert.equal(h.workspace.copilotDiagnostics.state,'stopped');
  assert.equal(h.workspace.index.files.get('file:///example.c')!.references.filter(ref=>ref.callKind==='ai-candidate').length,2,'completed AI candidates remain visible after stopping');
  h.workspace.settled.fire();h.workspace.sourceChanged.fire('editor-save');h.workspace.settled.fire();await settle();
  assert.equal(h.calls.length,3);assert.equal(h.workspace.copilotDiagnostics.state,'stopped');
  await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  assert.equal(h.calls.length,9,'two completed results are reused; only the interrupted and remaining sites are requested');
  assert.equal(h.workspace.copilotDiagnostics.completed,8);
  assert.equal(h.workspace.index.files.get('file:///example.c')!.references.filter(ref=>ref.callKind==='ai-candidate').length,8,'automatic analysis publishes the discovered targets');
});
test('automatic request failure pauses instead of retrying on source or index notifications',async t=>{
  const h=await harness(true);t.after(h.dispose);h.config.set('copilotCallbacks',true);h.config.set('copilotModel','model-a');
  await h.start().ready;assert.equal(h.calls.length,1);assert.equal(h.workspace.copilotDiagnostics.state,'request-failed');
  h.workspace.settled.fire();h.workspace.sourceChanged.fire('editor-save');h.workspace.settled.fire();await settle();
  assert.equal(h.calls.length,1);
});
test('a source update during a request automatically processes the latest saved snapshot',async t=>{
  const h=await harness();t.after(h.dispose);h.config.set('copilotCallbacks',true);h.config.set('copilotModel','model-a');
  const held=h.holdNext('model-a'),api=h.start();await until(()=>h.calls.length===1);await held.started;
  h.workspace.sourceChanged.fire('editor-save');
  h.addFile('file:///example.c','struct Ops{void(*cb_complete)(void);};void changed(struct Ops*p){p->cb_complete();}');
  h.workspace.settled.fire();held.release();await api.ready;
  await until(()=>h.calls.length===2&&h.workspace.copilotDiagnostics.state==='ready');
  assert.ok(h.tokens[0].cancelled);assert.equal(h.workspace.copilotDiagnostics.completed,1);
});
test('automatic model changes use the new configured model without a callback picker',async t=>{
  const h=await harness();t.after(h.dispose);h.config.set('copilotCallbacks',true);h.config.set('copilotModel','model-a');
  const held=h.holdNext('model-a'),api=h.start();await until(()=>h.calls.length===1);await held.started;
  await h.update('copilotModel','model-b');held.release();await api.ready;
  await until(()=>h.calls.length===2&&h.workspace.copilotDiagnostics.state==='ready');
  assert.deepEqual(h.calls,['model-a','model-b']);assert.equal(h.pickCount(),0);
});
test('automatic runs skip active user confirmations and keep their targets',async t=>{
  const h=await harness(false,undefined,2);t.after(h.dispose);h.config.set('copilotCallbacks',true);h.config.set('copilotModel','model-a');
  h.addFile('file:///targets.c','void wrong(void){}void correct(void){}');const api=await h.startPaused();
  await api.actions.setTarget({...firstSite(h),targetId:h.workspace.index.symbols().find(s=>s.name==='wrong')!.id},h.workspace.index.symbols().find(s=>s.name==='correct')!.id);
  await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  assert.equal(h.calls.length,1);assert.equal(h.workspace.copilotDiagnostics.total,1);
  assert.ok(h.workspace.index.files.get('file:///example.c')!.references.some(ref=>ref.callKind==='user-confirmed'&&ref.name==='correct'));
});
test('explicit per-call action sends one request; recheck bypasses only its cache',async t=>{
  const h=await harness(false,undefined,8);t.after(h.dispose);h.config.set('copilotCallbacks',true);
  const api=await h.startPaused();const site=firstSite(h);
  await api.actions.analyze(site,false);assert.equal(h.calls.length,1);
  await api.actions.analyze(site,false);assert.equal(h.calls.length,1);
  await api.actions.analyze(site,true);assert.equal(h.calls.length,2);
});
test('disabled or excluded Copilot never changes settings to send requests',async t=>{
  const h=await harness();t.after(h.dispose);const api=await h.startPaused();
  await assert.rejects(api.actions.analyze(firstSite(h),true));assert.equal(h.calls.length,0);assert.equal(h.config.get('copilotCallbacks'),false);
  await h.update('copilotCallbacks',true);await h.update('copilotExclude',['**']);
  await assert.rejects(api.actions.analyze(firstSite(h),true));assert.equal(h.calls.length,0);
});
test('saved basic snapshot allows manual investigation after local detail stop',async t=>{
  const h=await harness();t.after(h.dispose);h.config.set('copilotCallbacks',true);
  h.workspace.stable=false;Object.assign(h.workspace,{copilotSnapshotReady:true,copilotWaitReason:'analysis-paused'});
  const api=await h.startPaused();await api.actions.analyze(firstSite(h),true);assert.equal(h.calls.length,1);
});
test('an absent unified setting preserves legacy AI scope while an explicit empty list disables it',async t=>{
  const h=await harness();t.after(h.dispose);h.config.delete('detailedAnalysisFolders');h.config.set('copilotCallbacks',true);h.config.set('copilotModel','model-a');
  const api=await h.startPaused();await api.actions.analyze(firstSite(h),true);assert.equal(h.calls.length,1);
  await h.update('detailedAnalysisFolders',[]);await assert.rejects(api.actions.analyze(firstSite(h),true));assert.equal(h.calls.length,1);
});
for(const phase of ['countTokens','sendRequest','stream'])test(`Stop cancels a held ${phase} without a late result`,async t=>{
  const h=await harness();t.after(h.dispose);h.config.set('copilotCallbacks',true);h.config.set('copilotModel','model-a');
  const api=await h.startPaused();const held=h.holdNext('model-a',phase);
  const active=api.actions.analyze(firstSite(h),true);await held.started;
  await h.commands.get('dynsight.stopCopilotAnalysis')!();held.release();
  await active.catch(()=>undefined);assert.equal(h.workspace.copilotDiagnostics.state,'stopped');
});
test('model changes reject a stale per-call response and automatically use the new model',async t=>{
  const h=await harness();t.after(h.dispose);h.config.set('copilotCallbacks',true);h.config.set('copilotModel','model-a');
  const api=await h.startPaused();const held=h.holdNext('model-a');
  const active=api.actions.analyze(firstSite(h),true);await held.started;
  await h.update('copilotModel','model-b');held.release();await active.catch(()=>undefined);await settle();
  await until(()=>h.workspace.copilotDiagnostics.state==='ready');
  assert.deepEqual(h.calls,['model-a','model-b']);assert.ok(![...h.workspace.index.files.values()].some(file=>file.references.some(ref=>ref.callKind==='ai-candidate')));
});
test('a source change during a paused per-call request keeps automatic analysis stopped',async t=>{
  const h=await harness();t.after(h.dispose);h.config.set('copilotCallbacks',true);h.config.set('copilotModel','model-a');
  const api=await h.startPaused(),held=h.holdNext('model-a');const active=api.actions.analyze(firstSite(h),true);await held.started;
  h.workspace.sourceChanged.fire('editor-save');h.workspace.generation++;h.workspace.settled.fire();held.release();await active.catch(()=>undefined);await settle();
  assert.equal(h.calls.length,1);assert.equal(h.workspace.copilotDiagnostics.state,'stopped');
});
test('manual function search rejects obviously incompatible callback signatures',async t=>{
  const h=await harness();t.after(h.dispose);
  h.addFile('file:///targets.c','void no_args(void){}void needs_arg(int value){}void *pointer_result(void){return 0;}');
  const api=await h.startPaused();const rows=await api.actions.search(firstSite(h),'');
  assert.equal(rows.find((row:any)=>row.name==='needs_arg').compatibility,'incompatible');
  assert.equal(rows.find((row:any)=>row.name==='pointer_result').compatibility,'incompatible');
  assert.notEqual(rows.find((row:any)=>row.name==='no_args').compatibility,'incompatible');
});

test('manual targets survive Copilot disable and restart, then code changes require review',async t=>{
  const h=await harness();t.after(h.dispose);
  h.addFile('file:///targets.c','void wrong(void){}void correct(void){}');
  let api=await h.startPaused();
  const action={...firstSite(h),targetId:h.workspace.index.symbols().find(s=>s.name==='wrong')!.id};
  const target=h.workspace.index.symbols().find(s=>s.name==='correct')!;
  await api.actions.setTarget(action,target.id);
  const manual=()=>[...h.workspace.index.files.values()].flatMap(file=>file.references).find(ref=>ref.callKind==='user-confirmed');
  assert.equal(manual()?.name,'correct');
  await h.update('copilotCallbacks',false);await settle();assert.equal(manual()?.name,'correct');
  h.stop();api=await h.startPaused();assert.equal(manual()?.name,'correct');
  assert.equal(h.calls.length,0,'manual edits never use Copilot');
  h.addFile('file:///targets.c','void wrong(void){}void correct(void){int changed=1;}');
  h.workspace.sourceChanged.fire('editor-save');h.workspace.settled.fire();await settle();
  assert.equal(manual(),undefined);assert.equal(h.workspace.copilotDiagnostics.manualReview,1);
});
test('AI comparison never replaces a user target until Use this target is chosen',async t=>{
  const h=await harness();t.after(h.dispose);h.config.set('copilotCallbacks',true);h.config.set('copilotModel','model-a');
  h.addFile('file:///targets.c','struct Ops{void(*cb_complete)(void);};void wrong(void){}void correct(void){}struct Ops a={.cb_complete=wrong};struct Ops b={.cb_complete=correct};');
  const api=await h.startPaused();const action={...firstSite(h),targetId:h.workspace.index.symbols().find(s=>s.name==='wrong')!.id};
  await api.actions.setTarget(action,h.workspace.index.symbols().find(s=>s.name==='correct')!.id);
  const manual=()=>[...h.workspace.index.files.values()].flatMap(file=>file.references).find(ref=>ref.callKind==='user-confirmed')!;
  const confirmed={...action,overrideKey:manual().manual!.overrideKey};
  let choice='correct';h.setReply(prompt=>{const context=JSON.parse(prompt.split('CONTEXT_JSON\n')[1]);const target=context.targets.find((target:any)=>target.name===choice);assert.ok(target);return JSON.stringify({status:'candidates',candidates:[{targetId:target.id,evidenceIds:[target.evidenceIds[0]],reason:'Explicit callback registration'}]});});
  assert.equal((await api.actions.analyze(confirmed,true)).comparison,'agrees');assert.equal(manual().name,'correct');
  choice='wrong';const changed=await api.actions.analyze(confirmed,true);assert.equal(changed.comparison,'different');assert.equal(manual().name,'correct');
  assert.ok(![...h.workspace.index.files.values()].flatMap(file=>file.references).some(ref=>ref.callKind==='ai-candidate'));
  await api.actions.useSuggestion(confirmed,changed.suggestionId!,changed.hint!.candidates[0].targetId);
  assert.equal(manual().name,'wrong');assert.equal(manual().callKind,'user-confirmed');
});
test('a user confirmation can be rechecked after local analysis resolves the same call',async t=>{
  const h=await harness();t.after(h.dispose);h.config.set('copilotCallbacks',true);h.config.set('copilotModel','model-a');
  h.addFile('file:///targets.c','void wrong(void){}void correct(void){}');
  const api=await h.startPaused();const action={...firstSite(h),targetId:h.workspace.index.symbols().find(s=>s.name==='wrong')!.id};
  await api.actions.setTarget(action,h.workspace.index.symbols().find(s=>s.name==='correct')!.id);
  const file=h.workspace.index.files.get('file:///example.c')!;
  h.workspace.index.update({...file,references:file.references.filter(ref=>ref.callKind!=='user-confirmed').map(ref=>ref.kind==='call'?{...ref,targetId:action.targetId,indirect:false,callKind:'inferred',inference:{expression:'p->cb_complete',incomplete:false,reasons:[],evidence:[]}}:ref)});
  h.workspace.generation++;h.workspace.settled.fire();await settle();
  const manual=h.workspace.index.files.get(file.uri)!.references.find(ref=>ref.callKind==='user-confirmed')!;assert.ok(manual);assert.equal(h.calls.length,0);
  await api.actions.analyze({...action,overrideKey:manual.manual!.overrideKey},true);assert.equal(h.calls.length,1);
  assert.equal(h.workspace.index.files.get(file.uri)!.references.find(ref=>ref.callKind==='user-confirmed')?.name,'correct');
});
test('changing a manual target after restart preserves its registration dependencies',async t=>{
  const h=await harness();t.after(h.dispose);h.config.set('copilotCallbacks',true);h.config.set('copilotModel','model-a');
  h.addFile('file:///targets.c','void wrong(void){}void correct(void){}void other(void){}');
  const registration='void wrong(void);struct Ops{void(*cb_complete)(void);};struct Ops config={.cb_complete=wrong};';
  h.addFile('file:///registration.c',registration);
  let api=await h.startPaused();const action=firstSite(h);
  h.setReply(prompt=>{const context=JSON.parse(prompt.split('CONTEXT_JSON\n')[1]);const target=context.targets.find((value:any)=>value.name==='wrong');assert.ok(target);return JSON.stringify({status:'candidates',candidates:[{targetId:target.id,evidenceIds:target.evidenceIds,reason:'Registration'}]});});
  const hint=(await api.actions.analyze(action,true)).hint!;
  await api.actions.setTarget({...action,targetId:hint.candidates[0].targetId},h.workspace.index.symbols().find(s=>s.name==='correct')!.id);
  const records=()=>h.state.get('callbackOverrides-v1') as {key:string;dependencies:{uri:string}[]}[];
  assert.ok(records()[0].dependencies.some(value=>value.uri==='file:///registration.c'));
  await h.update('copilotCallbacks',false);h.stop();api=await h.startPaused();
  await api.actions.setTarget({...action,overrideKey:records()[0].key},h.workspace.index.symbols().find(s=>s.name==='other')!.id);
  assert.ok(records()[0].dependencies.some(value=>value.uri==='file:///registration.c'));
  h.addFile('file:///registration.c',registration.replace('.cb_complete=wrong','.cb_complete=0'));
  h.workspace.sourceChanged.fire('editor-save');h.workspace.settled.fire();await settle();
  assert.equal(h.workspace.copilotDiagnostics.manualReview,1);
  assert.ok(!h.workspace.index.files.get('file:///example.c')!.references.some(ref=>ref.callKind==='user-confirmed'));
});
for(const phase of ['countTokens','sendRequest','stream'])test(`timeout cancels held ${phase} without late network work`,async t=>{
  const h=await harness(false,20);t.after(h.dispose);h.config.set('copilotCallbacks',true);h.config.set('copilotModel','model-a');
  const api=await h.startPaused();const held=h.holdNext('model-a',phase);
  const active=api.actions.analyze(firstSite(h),true);await held.started;
  await assert.rejects(active);const before=h.calls.length;held.release();await settle();
  assert.equal(h.calls.length,before,'a timed out token count must not start another request');
});
test('permission errors and unavailable chosen models never fall back or retry',async t=>{
  const h=await harness(true);t.after(h.dispose);h.config.set('copilotCallbacks',true);h.config.set('copilotModel','model-a');
  const api=await h.startPaused();await assert.rejects(api.actions.analyze(firstSite(h),true));
  assert.equal(h.calls.length,1);await settle();assert.equal(h.calls.length,1);
  h.available(['model-b']);await assert.rejects(api.actions.analyze(firstSite(h),true));assert.equal(h.calls.length,1);
});
