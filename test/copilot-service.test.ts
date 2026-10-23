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
const bundle = buildSync({ entryPoints: ['src/copilot-service.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vscode'] }).outputFiles[0].text;
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
  const config=new Map<string,unknown>([['copilotCallbacks',false],['copilotModel',''],['copilotInclude',['**']],['detailedAnalysisFolders',['**']]]);
  const calls:string[]=[],queries:unknown[]=[],messages:string[]=[],prompts:string[]=[];
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
    ConfigurationTarget:{Workspace:2,WorkspaceFolder:3},window:{showQuickPick:async(items:any[])=>{pickCount++;await waitHeld(pick,'picker');return items.find(item=>item.value.id===pick) ?? items[0];},showErrorMessage:async(value:string)=>{messages.push(value);},showInformationMessage:async(value:string)=>{messages.push(value);}},
    LanguageModelChatMessage:{User:(value:string)=>value},CancellationTokenSource:class{token={cancelled:false};cancel(){this.token.cancelled=true;}dispose(){}}
  };
  const context={storageUri:{fsPath:storage},subscriptions:[]as{dispose():void}[],workspaceState:{get:(key:string)=>state.get(key),update:async(key:string,value:unknown)=>{state.set(key,value);}},languageModelAccessInformation:{canSendRequest:(model:{id:string})=>permissions.get(model.id)}};
  const workspace={index:new RelationIndex(),ready:Promise.resolve(),stable:true,generation:1,analysisKey:'key',hasDirtySources:false,
    copilotWaitReason:undefined as string|undefined,
    sourceChanged:new Emitter(),settled:new Emitter(),changed:new Emitter(),diagnosticsChanged:new Emitter(),whenIdle:async()=>{},copilotDiagnostics:undefined as any};
  workspace.index.update(file);
  function stop(){for(const item of context.subscriptions.splice(0))item.dispose();}
  function start(){const module={exports:{}as any};runInNewContext(bundle,{module,exports:module.exports,process,Buffer,URL,AbortController,setTimeout:(fn:()=>void,ms:number)=>setTimeout(fn,ms===60_000&&timeoutMs!==undefined?timeoutMs:ms),clearTimeout,setImmediate,require:(name:string)=>name==='vscode'?vscode:require(name)});return module.exports.registerCopilotCallbacks(context,workspace);}
  async function startPaused(){const api=start();await commands.get('dynsight.stopCopilotAnalysis')!();await api.ready;return api;}
  return{start,startPaused,stop,config,commands,calls,prompts,queries,messages,workspace,update,state,tokens,folders,folderConfigs,
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
test('enabling Copilot automatically processes all sites and startup, save and rebuild reuse valid cache',async t=>{
  const h=await harness(false,undefined,8);t.after(h.dispose);const api=h.start();await api.ready;
  assert.equal(h.calls.length,0);assert.equal(h.pickCount(),0);
  await h.update('copilotCallbacks',true);await settle();
  await until(()=>h.workspace.copilotDiagnostics.state==='ready'&&h.workspace.copilotDiagnostics.completed===8);
  assert.equal(h.calls.length,8);assert.equal(h.pickCount(),1,'only the model is selected; callbacks need no picker');
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
