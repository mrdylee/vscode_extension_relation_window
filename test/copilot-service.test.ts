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
  const config=new Map<string,unknown>([['copilotCallbacks',false],['copilotModel',''],['copilotInclude',['**']]]);
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
  const models=['model-a','model-b'].map(id=>({id,vendor:'copilot',name:id,family:'test',version:'1',maxInputTokens:64000,
    countTokens:async()=>{await waitHeld(id,'countTokens');return 100;},sendRequest:async(_messages:unknown,_options:unknown,token:{cancelled:boolean})=>{
      calls.push(id);prompts.push((_messages as string[])[0]);permissions.set(id,!denied);if(denied)throw new Error('Access denied');
      tokens.push(token);await waitHeld(id,'sendRequest');
      if(replyDelayMs)await new Promise(done=>setTimeout(done,replyDelayMs));
      return{text:(async function*(){await waitHeld(id,'stream');yield'{"status":"not-found","candidates":[]}';})()};
    }}));
  let available=models;
  async function update(key:string,value:unknown){config.set(key,value);settings.fire({affectsConfiguration:(name:string)=>name===`dynsight.${key}`});}
  const vscode={lm:{selectChatModels:async(selector:{id?:string})=>{queries.push(selector);if(selector.id)await waitHeld(selector.id,'discovery');return available;}},
    commands:{registerCommand:(id:string,command:any)=>{commands.set(id,command);return{dispose(){}};}},
    Uri: { parse: uri },
    workspace:{isTrusted:true,workspaceFolders:folders,getConfiguration:(_section:string,resource?:ReturnType<typeof uri>)=>({get:(key:string,fallback:unknown)=>(folderConfigs.get(resource?.toString() ?? '')?.get(key) ?? config.get(key))??fallback,
      inspect:(key:string)=>({workspaceValue:config.get(key),workspaceFolderValue:folderConfigs.get(resource?.toString() ?? '')?.get(key)}),
      update:async(key:string,value:unknown,target?:number)=>{if(heldSetting?.key===key){const waiting=heldSetting;heldSetting=undefined;waiting.started();await waiting.promise;}if(target===3&&resource){const values=folderConfigs.get(resource.toString())??new Map();values.set(key,value);folderConfigs.set(resource.toString(),values);settings.fire({affectsConfiguration:(name:string,scope?:ReturnType<typeof uri>)=>name===`dynsight.${key}`&&(!scope||scope.toString()===resource.toString())});}else await update(key,value);}}),onDidChangeConfiguration:settings.event,
      getWorkspaceFolder:(value:ReturnType<typeof uri>)=>[...folders].reverse().find(folder=>value.toString().startsWith(folder.uri.toString())),
      asRelativePath:(value:ReturnType<typeof uri>)=>{const folder=[...folders].reverse().find(folder=>value.toString().startsWith(folder.uri.toString()));return decodeURIComponent(value.toString().slice(folder?.uri.toString().length ?? 0));}},
    ConfigurationTarget:{Workspace:2,WorkspaceFolder:3},window:{showQuickPick:async(items:any[])=>{pickCount++;await waitHeld(pick,'picker');return items.find(item=>item.value.id===pick);},showErrorMessage:async(value:string)=>{messages.push(value);},showInformationMessage:async(value:string)=>{messages.push(value);}},
    LanguageModelChatMessage:{User:(value:string)=>value},CancellationTokenSource:class{token={cancelled:false};cancel(){this.token.cancelled=true;}dispose(){}}
  };
  const context={storageUri:{fsPath:storage},subscriptions:[]as{dispose():void}[],workspaceState:{get:(key:string)=>state.get(key),update:async(key:string,value:unknown)=>{state.set(key,value);}},languageModelAccessInformation:{canSendRequest:(model:{id:string})=>permissions.get(model.id)}};
  const workspace={index:new RelationIndex(),ready:Promise.resolve(),stable:true,generation:1,analysisKey:'key',hasDirtySources:false,
    copilotWaitReason:undefined as string|undefined,
    sourceChanged:new Emitter(),settled:new Emitter(),changed:new Emitter(),diagnosticsChanged:new Emitter(),whenIdle:async()=>{},copilotDiagnostics:undefined as any};
  workspace.index.update(file);
  function stop(){for(const item of context.subscriptions.splice(0))item.dispose();}
  function start(){const module={exports:{}as any};runInNewContext(bundle,{module,exports:module.exports,process,Buffer,URL,AbortController,setTimeout:(fn:()=>void,ms:number)=>setTimeout(fn,ms===60_000&&timeoutMs!==undefined?timeoutMs:ms),clearTimeout,setImmediate,require:(name:string)=>name==='vscode'?vscode:require(name)});return module.exports.registerCopilotCallbacks(context,workspace);}
  return{start,stop,config,commands,calls,prompts,queries,messages,workspace,update,state,tokens,folders,folderConfigs,
    updateMany:async(values:Record<string,unknown>)=>{for(const [key,value]of Object.entries(values))config.set(key,value);settings.fire({affectsConfiguration:(name:string)=>Object.keys(values).some(key=>name===`dynsight.${key}`)});await new Promise<void>(done=>setImmediate(done));},
    holdSetting:(key:string)=>{let release!:()=>void,started!:()=>void;const observed=new Promise<void>(done=>{started=done;});const promise=new Promise<void>(done=>{release=done;});heldSetting={key,started,promise};return{started:observed,release};},
    addFile:(value:string,text:string)=>{workspace.index.update(parser.analyze(value,text));workspace.generation++;},
    holdNext:(id:string,phase='sendRequest',afterCalls=0)=>{let release!:()=>void,reject!:(error:Error)=>void,started!:()=>void;const observed=new Promise<void>(done=>{started=done;});const promise=new Promise<void>((done,fail)=>{release=done;reject=fail;});held={id,phase,afterCalls,started,promise};return{started:observed,release,reject};},
    pick:(id:string)=>{pick=id;},pickCount:()=>pickCount,available:(ids:string[])=>{available=models.filter(model=>ids.includes(model.id));},
    dispose:async()=>{stop();await rm(storage,{recursive:true,force:true});}};
}
const settle=()=>new Promise(done=>setTimeout(done,1100));
function waitFor(h: Awaited<ReturnType<typeof harness>>, predicate: () => boolean): Promise<void> {
  if (predicate()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const subscription = h.workspace.diagnosticsChanged.event(() => {
      if (predicate()) { clearTimeout(timer); subscription.dispose(); resolve(); }
    });
    const timer = setTimeout(() => {
      subscription.dispose(); reject(new Error(`Copilot did not reach the expected state: ${JSON.stringify(h.workspace.copilotDiagnostics)}`));
    }, 10000);
  });
}

for (const enabled of [false, true]) test(`Stop immediately after Analyze blocks every request (already enabled=${enabled})`, async t => {
  const h=await harness(false,undefined,8);t.after(h.dispose);h.config.set('copilotCallbacks',enabled);await h.start().ready;
  const active=h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  await h.commands.get('dynsight.stopCopilotAnalysis')!();await active;
  assert.equal(h.calls.length,0);assert.equal(h.queries.length,0,'a cancelled start must not open model selection');
});

test('Stop during an initial Include write prevents a late Analyze start', async t => {
  const h=await harness(false,undefined,8);t.after(h.dispose);await h.start().ready;
  h.config.delete('copilotInclude');h.config.set('include',['**']);
  const held=h.holdSetting('copilotInclude');
  const active=h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();await held.started;
  await h.commands.get('dynsight.stopCopilotAnalysis')!();held.release();await active;
  assert.equal(h.calls.length,0);assert.equal(h.queries.length,0);
});

test('Analyze can initialize Include paths without cancelling its own start', async t => {
  const h=await harness(false,undefined,8);t.after(h.dispose);await h.start().ready;
  h.config.delete('copilotInclude');h.config.set('include',['**']);
  await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  assert.equal(h.calls.length,8);assert.equal(h.workspace.copilotDiagnostics.completed,8);
});

test('Disable during an initial Include write prevents Analyze from enabling AI again', async t => {
  const h=await harness();t.after(h.dispose);h.config.set('copilotCallbacks',true);await h.start().ready;
  h.config.delete('copilotInclude');h.config.set('include',['**']);
  const held=h.holdSetting('copilotInclude');
  const active=h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();await held.started;
  await h.update('copilotCallbacks',false);held.release();await active;
  assert.equal(h.config.get('copilotCallbacks'),false);assert.equal(h.calls.length,0);assert.equal(h.queries.length,0);
});

test('Stop while the model picker is open prevents late selection from starting analysis', async t => {
  const h=await harness();t.after(h.dispose);await h.start().ready;
  const held=h.holdNext('model-a','picker');
  const active=h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();await held.started;
  await h.commands.get('dynsight.stopCopilotAnalysis')!();held.release();await active;
  assert.equal(h.calls.length,0);assert.equal(h.config.get('copilotCallbacks'),false);
  assert.equal(h.state.get('copilotCallbackModel'),undefined,'a cancelled picker must not write a late selection');
});

test('Stop during model discovery keeps the stopped state when discovery returns', async t => {
  const h=await harness();t.after(h.dispose);await h.start().ready;
  await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  const held=h.holdNext('model-a','discovery');
  const active=h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();await held.started;
  await h.commands.get('dynsight.stopCopilotAnalysis')!();held.release();await active;
  assert.equal(h.workspace.copilotDiagnostics.state,'stopped');
  h.addFile('file:///added.c','struct Ops{void(*cb_complete)(void);};void added(struct Ops*p){p->cb_complete();}');
  h.workspace.sourceChanged.fire('editor-save');h.workspace.settled.fire();
  await waitFor(h,()=>h.workspace.copilotDiagnostics.state==='stopped'&&h.workspace.copilotDiagnostics.total===2);
  assert.equal(h.calls.length,1,'saving after a cancelled model discovery must not send new requests');
});

test('a single JSON edit preserves an explicitly supplied AI subset', async t => {
  const h=await harness();t.after(h.dispose);h.config.set('copilotInclude',[]);
  h.addFile('file:///App/run.c','struct Ops{void(*cb_complete)(void);};void app(struct Ops*p){p->cb_complete();}');
  h.addFile('file:///Vendor/run.c','struct Ops{void(*cb_complete)(void);};void vendor(struct Ops*p){p->cb_complete();}');
  await h.start().ready;
  await h.updateMany({include:['App/**','Vendor/**'],copilotInclude:['App/**']});
  assert.deepEqual(Array.from(h.config.get('copilotInclude') as string[]),['App/**']);
  await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  assert.deepEqual(h.prompts.map(prompt=>JSON.parse(prompt.split('CONTEXT_JSON\n')[1]).callsite.uri),['file:///App/run.c']);
  await h.update('include',['App/**','Vendor/**','New/**']);
  await waitFor(h,()=>JSON.stringify(h.config.get('copilotInclude'))==='["App/**","New/**"]');
  assert.equal(h.calls.length,1,'later scope copying must not request excluded vendor callbacks');
});

test('clearing AI Include in the same JSON edit as Include keeps AI disabled', async t => {
  const h=await harness();t.after(h.dispose);await h.start().ready;
  await h.updateMany({include:['**'],copilotInclude:[]});
  assert.deepEqual(Array.from(h.config.get('copilotInclude') as string[]),[]);
  await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  assert.equal(h.calls.length,0);assert.equal(h.workspace.copilotDiagnostics.excluded,1);
});

test('Include paths initialize Copilot Include once; removals survive restart and new Include changes copy again', async t => {
  const h = await harness(); t.after(h.dispose);
  h.config.delete('copilotInclude'); h.config.set('include', ['App/**', 'Control/**/*.c']);
  await h.start().ready;
  assert.deepEqual(Array.from(h.config.get('copilotInclude') as string[]), ['App/**', 'Control/**/*.c']);
  assert.equal(h.calls.length, 0);
  await h.update('copilotInclude', ['Control/**/*.c']);
  h.stop(); await h.start().ready;
  assert.deepEqual(Array.from(h.config.get('copilotInclude') as string[]), ['Control/**/*.c']);
  await h.update('include', ['App/**', 'Control/**/*.c', 'New/**']);
  await waitFor(h, () => JSON.stringify(h.config.get('copilotInclude')) === '["Control/**/*.c","New/**"]');
  assert.equal((h.config.get('copilotInclude') as string[]).includes('App/**'), false, 'adding another source path does not restore a removed AI path');
  await h.update('include', ['Important/**']);
  await waitFor(h, () => JSON.stringify(h.config.get('copilotInclude')) === '["Important/**"]');
  assert.equal(h.calls.length, 0, 'editing scope never starts a new AI request');
});

test('empty Copilot Include disables requests and uses no pending AI slots', async t => {
  const h = await harness(); t.after(h.dispose); h.config.set('copilotInclude', []);
  await h.start().ready; await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  assert.equal(h.calls.length, 0);
  assert.equal(h.workspace.copilotDiagnostics.total, 0);
  assert.equal(h.workspace.copilotDiagnostics.remaining, 0);
  assert.equal(h.workspace.copilotDiagnostics.excluded, 1);
  assert.equal(h.workspace.index.files.size, 1, 'scope never removes local analysis');
});

test('initial Include copying uses separate folder settings in a multi-root workspace', async t => {
  const h = await harness(); t.after(h.dispose); h.config.delete('copilotInclude'); h.config.set('include', ['App/**']);
  h.folders.push({ uri: { path: '/other/', toString: () => 'file:///other/' } });
  h.folderConfigs.set('file:///other/', new Map([['include', ['Control/**']]]));
  await h.start().ready;
  assert.deepEqual(Array.from(h.folderConfigs.get('file:///')!.get('copilotInclude') as string[]), ['App/**']);
  assert.deepEqual(Array.from(h.folderConfigs.get('file:///other/')!.get('copilotInclude') as string[]), ['Control/**']);
  assert.equal(h.config.has('copilotInclude'), false, 'one root must not overwrite the workspace-wide AI scope');
});

test('folder-specific AI includes and exclusions limit requests to the actual callsite paths', async t => {
  const h = await harness(); t.after(h.dispose);
  h.config.set('copilotInclude', ['Important/**']); h.config.set('copilotExclude', ['**/skip.c']);
  h.addFile('file:///Important/run.c', 'struct Ops{void(*cb)(void);};void important(struct Ops*p){p->cb();}');
  h.addFile('file:///Important/skip.c', 'struct Ops{void(*cb)(void);};void skip(struct Ops*p){p->cb();}');
  h.addFile('file:///Vendor/run.c', 'struct Ops{void(*cb)(void);};void vendor(struct Ops*p){p->cb();}');
  h.folders.push({ uri: { path: '/other/', toString: () => 'file:///other/' } });
  h.folderConfigs.set('file:///other/', new Map([['copilotInclude', ['Control/**']]]));
  h.addFile('file:///other/Control/run.c', 'struct Ops{void(*cb)(void);};void other(struct Ops*p){p->cb();}');
  h.addFile('file:///other/Important/run.c', 'struct Ops{void(*cb)(void);};void wrong(struct Ops*p){p->cb();}');
  const originals = [...h.workspace.index.files.values()];
  await h.start().ready; await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  assert.deepEqual(h.prompts.map(prompt => JSON.parse(prompt.split('CONTEXT_JSON\n')[1]).callsite.uri).sort(), ['file:///Important/run.c', 'file:///other/Control/run.c']);
  assert.equal(h.workspace.copilotDiagnostics.total, 2);
  assert.equal(h.workspace.copilotDiagnostics.excluded, 4);
  assert.deepEqual([...h.workspace.index.files.values()], originals);
});

test('changing AI scope aborts the active request and only restores eligible cache until Analyze', async t => {
  const h = await harness(false, undefined, 8); t.after(h.dispose); await h.start().ready;
  const held = h.holdNext('model-a', 'sendRequest', 2);
  const active = h.commands.get('dynsight.analyzeCallbacksWithCopilot')!(); await held.started;
  await h.update('copilotInclude', []);
  await active; held.release();
  await waitFor(h, () => h.workspace.copilotDiagnostics.state === 'ready');
  assert.equal(h.calls.length, 2);
  assert.equal(h.tokens[1].cancelled, true);
  assert.equal(h.workspace.copilotDiagnostics.total, 0);
  assert.equal(h.workspace.copilotDiagnostics.excluded, 8);
  await h.update('copilotInclude', ['**']);
  await waitFor(h, () => h.workspace.copilotDiagnostics.total === 8 && h.workspace.copilotDiagnostics.state === 'more-callbacks-available');
  assert.equal(h.workspace.copilotDiagnostics.cacheHits, 1);
  assert.equal(h.calls.length, 2);
  await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  assert.equal(h.calls.length, 9, 'only the seven missing callbacks need requests after scope is widened');
});

test('one Analyze command processes all 38 sites and a restart makes no new requests', async t => {
  const h = await harness(false, undefined, 38); t.after(h.dispose); await h.start().ready;
  await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  assert.equal(h.calls.length, 38);
  assert.equal(h.workspace.copilotDiagnostics.completed, 38);
  assert.equal(h.workspace.copilotDiagnostics.remaining, 0);
  assert.equal(h.workspace.copilotDiagnostics.automatic, false);
  assert.equal(h.workspace.copilotDiagnostics.state, 'ready');
  h.stop(); await h.start().ready;
  assert.equal(h.calls.length, 38);
  assert.equal(h.workspace.copilotDiagnostics.cacheHits, 38);
});

test('Stop cancels a held request, retains progress, and suppresses background requests until Analyze', async t => {
  const h = await harness(false, undefined, 38); t.after(h.dispose); await h.start().ready;
  const held = h.holdNext('model-a', 'sendRequest', 8);
  const pending = h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  await held.started;
  assert.equal(h.workspace.copilotDiagnostics.completed, 7);
  assert.equal(h.workspace.copilotDiagnostics.automatic, true);
  await h.commands.get('dynsight.stopCopilotAnalysis')!();
  try { await pending; } finally { held.release(); }
  assert.equal(h.tokens[7].cancelled, true);
  assert.equal(h.workspace.copilotDiagnostics.state, 'stopped');
  assert.equal(h.workspace.copilotDiagnostics.completed, 7);
  assert.equal(h.workspace.copilotDiagnostics.failures, 0);
  assert.equal(h.workspace.copilotDiagnostics.automatic, false);
  h.workspace.sourceChanged.fire('editor-save'); h.workspace.settled.fire();
  await waitFor(h, () => h.workspace.copilotDiagnostics.state === 'stopped' && h.workspace.copilotDiagnostics.completed === 7);
  assert.equal(h.calls.length, 8, 'save/settled events must not restart a stopped job');
  await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  assert.equal(h.calls.length, 39, 'seven completed results are reused; only 31 pending sites are requested');
  assert.equal(h.workspace.copilotDiagnostics.completed, 38);
});

test('a stopped deferred job does not start after saving unsaved sources', async t => {
  const h = await harness(false, undefined, 7); t.after(h.dispose); await h.start().ready;
  h.workspace.hasDirtySources = true;
  await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  assert.equal(h.workspace.copilotDiagnostics.automatic, true);
  assert.equal(h.workspace.copilotDiagnostics.state, 'waiting-for-saved-index');
  await h.commands.get('dynsight.stopCopilotAnalysis')!();
  h.workspace.hasDirtySources = false;
  h.workspace.sourceChanged.fire('editor-save'); h.workspace.settled.fire();
  await waitFor(h, () => h.workspace.copilotDiagnostics.state === 'stopped' && h.workspace.copilotDiagnostics.remaining === 7);
  assert.equal(h.calls.length, 0);
  assert.equal(h.workspace.copilotDiagnostics.state, 'stopped');
  await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  assert.equal(h.calls.length, 7);
});

test('automatic analysis pauses on edits and resumes all remaining work after saving', async t => {
  const h = await harness(false, undefined, 7, 25); t.after(h.dispose); await h.start().ready;
  const held = h.holdNext('model-a'), pending = h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  await held.started;
  h.workspace.hasDirtySources = true; h.workspace.stable = false;
  h.workspace.sourceChanged.fire('editor-change');
  try { await pending; } finally { held.release(); }
  assert.equal(h.workspace.copilotDiagnostics.automatic, true);
  assert.equal(h.workspace.copilotDiagnostics.state, 'waiting-for-saved-index');
  h.workspace.hasDirtySources = false; h.workspace.stable = true; h.workspace.generation++;
  h.workspace.sourceChanged.fire('editor-save'); h.workspace.settled.fire();
  await waitFor(h, () => h.workspace.copilotDiagnostics.state === 'ready');
  assert.equal(h.calls.length, 8);
  assert.equal(h.workspace.copilotDiagnostics.completed, 7);
  assert.equal(h.workspace.copilotDiagnostics.state, 'ready');
});

test('Stop while the Analyze command waits for local indexing prevents a late start', async t => {
  const h = await harness(); t.after(h.dispose); await h.start().ready;
  let release!:() => void, entered!:() => void;
  const held = new Promise<void>(done => { release = done; }), started = new Promise<void>(done => { entered = done; });
  h.workspace.whenIdle = async () => { entered(); await held; };
  const pending = h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  await started; await h.commands.get('dynsight.stopCopilotAnalysis')!(); release(); await pending;
  assert.equal(h.calls.length, 0);
  assert.equal(h.workspace.copilotDiagnostics.state, 'stopped');
});

test('saved-file background work still requests at most five sites after an explicit job completes', async t => {
  const h = await harness(false, undefined, 7); t.after(h.dispose); await h.start().ready;
  await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  h.workspace.analysisKey = 'edited-settings'; h.workspace.generation++;
  h.workspace.sourceChanged.fire('editor-save'); h.workspace.settled.fire();
  await waitFor(h, () => h.workspace.copilotDiagnostics.state === 'more-callbacks-available');
  assert.equal(h.calls.length, 12);
  assert.equal(h.workspace.copilotDiagnostics.completed, 5);
  assert.equal(h.workspace.copilotDiagnostics.remaining, 2);
  assert.equal(h.workspace.copilotDiagnostics.automatic, false);
});
test('disabled Copilot stays off while dirty sources or local analysis block the index',async t=>{
  const h=await harness();t.after(h.dispose);await h.start().ready;
  h.workspace.hasDirtySources=true;h.workspace.stable=false;
  h.workspace.sourceChanged.fire('editor-change');await settle();
  assert.equal(h.workspace.copilotDiagnostics.state,'off');
  assert.equal(h.workspace.copilotDiagnostics.waitReason,undefined);
  assert.equal(h.calls.length,0);
});

for(const denied of [false,true])test(`Copilot command and restart respect cached results and consent (denied=${denied})`,async t=>{
  const h=await harness(denied);t.after(h.dispose);await h.start().ready;
  assert.equal(h.queries.length,0);assert.equal(h.calls.length,0);
  await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();assert.equal(h.calls.length,1);
  h.workspace.sourceChanged.fire('editor-close');h.workspace.settled.fire();await settle();
  assert.equal(h.calls.length,1,'unchanged navigation must not request AI');
  h.stop();const queries=h.queries.length;await h.start().ready;
  assert.equal(h.calls.length,1);assert.equal(h.queries.length,queries,'restart uses saved model version without discovery');
});

test('Settings model selection does not enable AI or request source analysis',async t=>{
  const h=await harness();t.after(h.dispose);await h.start().ready;
  assert.ok(h.commands.has('dynsight.selectCopilotModel'));
  h.pick('model-b');await h.commands.get('dynsight.selectCopilotModel')!();
  assert.equal(h.config.get('copilotModel'),'model-b');assert.equal(h.config.get('copilotCallbacks'),false);assert.equal(h.calls.length,0);
  const picks=h.pickCount();await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  assert.deepEqual(h.calls,['model-b']);assert.equal(h.pickCount(),picks,'Analyze must use configured model without another picker');
});

test('switching models restores separate caches and selecting a model never issues requests',async t=>{
  const h=await harness();t.after(h.dispose);await h.start().ready;
  await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();assert.deepEqual(h.calls,['model-a']);
  h.pick('model-b');await h.commands.get('dynsight.selectCopilotModel')!();await settle();assert.deepEqual(h.calls,['model-a']);
  await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();assert.deepEqual(h.calls,['model-a','model-b']);
  h.pick('model-a');await h.commands.get('dynsight.selectCopilotModel')!();await settle();
  assert.equal(h.workspace.copilotDiagnostics.cacheHits,1);assert.deepEqual(h.calls,['model-a','model-b']);
  await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();assert.deepEqual(h.calls,['model-a','model-b']);
});

test('manually edited model ID resolves only on Analyze and unavailable IDs never fall back',async t=>{
  const h=await harness();t.after(h.dispose);await h.start().ready;
  await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  const picks=h.pickCount(),queries=h.queries.length;
  await h.update('copilotModel','model-b');await settle();assert.equal(h.queries.length,queries);assert.deepEqual(h.calls,['model-a']);
  await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();assert.deepEqual(h.calls,['model-a','model-b']);assert.equal(h.pickCount(),picks);
  await h.update('copilotModel','missing-model');await settle();
  await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  assert.deepEqual(h.calls,['model-a','model-b']);assert.equal(h.config.get('copilotModel'),'missing-model');assert.equal(h.pickCount(),picks);
  assert.ok(h.messages.some(message=>message.includes('missing-model')));
});

test('changing the model cancels an active request and discards the old response and cache',async t=>{
  const h=await harness();t.after(h.dispose);await h.start().ready;
  const held=h.holdNext('model-a');const pending=h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();await held.started;
  await h.update('copilotModel','model-b');assert.equal(h.tokens[0].cancelled,true);
  await settle();held.release();await pending;await settle();
  assert.equal(h.workspace.copilotDiagnostics.state,'model-selection-required','a slow cancellation cannot lose the pending model change');
  await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();assert.deepEqual(h.calls,['model-a','model-b']);
  h.pick('model-a');await h.commands.get('dynsight.selectCopilotModel')!();assert.equal(h.workspace.copilotDiagnostics.cacheHits,0);
  await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();assert.deepEqual(h.calls,['model-a','model-b','model-a']);
});

test('Copilot progress is visible during a request and source changes clear completion',async t=>{
  const h=await harness();t.after(h.dispose);await h.start().ready;
  const held=h.holdNext('model-a'), pending=h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  await held.started;
  try {
    assert.equal(h.workspace.copilotDiagnostics.state,'analyzing');
    assert.equal(h.workspace.copilotDiagnostics.total,1);
    assert.equal(h.workspace.copilotDiagnostics.completed,0);
    assert.equal(h.workspace.copilotDiagnostics.remaining,1);
  } finally { held.release(); }
  await pending;
  assert.equal(h.workspace.copilotDiagnostics.completed,1);
  assert.equal(h.workspace.copilotDiagnostics.notFound,1);
  h.workspace.hasDirtySources=true;h.workspace.sourceChanged.fire('editor-change');
  assert.equal(h.workspace.copilotDiagnostics.state,'waiting-for-saved-index');
  assert.equal(h.workspace.copilotDiagnostics.waitReason,'unsaved-sources');
  assert.equal(h.workspace.copilotDiagnostics.completed,0);
  assert.equal(h.workspace.copilotDiagnostics.total,0);
});

test('saving dirty sources resumes Copilot after the local index settles',async t=>{
  const h=await harness();t.after(h.dispose);await h.start().ready;
  await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  h.workspace.hasDirtySources=true;h.workspace.stable=false;
  h.workspace.sourceChanged.fire('editor-change');
  await settle();assert.equal(h.calls.length,1);
  assert.equal(h.workspace.copilotDiagnostics.waitReason,'unsaved-sources');
  h.workspace.hasDirtySources=false;h.workspace.copilotWaitReason='relations';
  h.workspace.analysisKey='changed';h.workspace.generation++;
  h.workspace.sourceChanged.fire('editor-save');await settle();
  assert.equal(h.calls.length,1);assert.equal(h.workspace.copilotDiagnostics.waitReason,'relations');
  h.workspace.stable=true;h.workspace.copilotWaitReason=undefined;
  h.workspace.settled.fire();await settle();
  assert.equal(h.calls.length,2);assert.equal(h.workspace.copilotDiagnostics.state,'ready');
  assert.equal(h.workspace.copilotDiagnostics.waitReason,undefined);
});

for(const force of [false,true])test(`Analyze requested while dirty resumes after saving an already indexed buffer (force=${force})`,async t=>{
  const h=await harness();t.after(h.dispose);await h.start().ready;
  if(force)await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  const before=h.calls.length;
  h.workspace.hasDirtySources=true;h.workspace.sourceChanged.fire('editor-change');
  await h.commands.get(force?'dynsight.reanalyzeCallbacksWithCopilot':'dynsight.analyzeCallbacksWithCopilot')!();
  assert.equal(h.workspace.copilotDiagnostics.waitReason,'unsaved-sources');
  await settle();assert.equal(h.calls.length,before,'dirty sources must never be sent');
  // WorkspaceIndex already parsed this buffer before save, so its generation stays unchanged.
  h.workspace.hasDirtySources=false;h.workspace.stable=false;h.workspace.copilotWaitReason='relations';
  h.workspace.sourceChanged.fire('editor-save');await settle();
  assert.equal(h.calls.length,before,'local analysis must settle before resuming');
  h.workspace.stable=true;h.workspace.copilotWaitReason=undefined;h.workspace.settled.fire();await settle();
  assert.equal(h.calls.length,before+1,'saving must resume the requested analysis, including forced cache bypass');
  assert.equal(h.workspace.copilotDiagnostics.state,'ready');
  h.workspace.settled.fire();await settle();
  assert.equal(h.calls.length,before+1,'the deferred command must only run once');
});

for(const cancel of ['disable','model'])test(`a deferred Analyze is cancelled by ${cancel}`,async t=>{
  const h=await harness();t.after(h.dispose);await h.start().ready;
  h.workspace.hasDirtySources=true;
  await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  if(cancel==='disable') {
    await h.update('copilotCallbacks',false);
    assert.equal(h.workspace.copilotDiagnostics.state,'off');
    await h.update('copilotCallbacks',true);
  } else {
    h.pick('model-b');await h.commands.get('dynsight.selectCopilotModel')!();
  }
  h.workspace.hasDirtySources=false;h.workspace.sourceChanged.fire('editor-save');h.workspace.settled.fire();
  await settle();
  assert.equal(h.calls.length,0,'cancelled commands must not send source after saving');
  assert.equal(h.workspace.copilotDiagnostics.state,'more-callbacks-available');
  assert.equal(h.workspace.copilotDiagnostics.failures,0);
});

test('stable partial analysis can run Copilot while a failed local analysis reports its blocker',async t=>{
  const h=await harness();t.after(h.dispose);await h.start().ready;
  const file=[...h.workspace.index.files.values()][0];
  h.workspace.index.update({...file,issues:['Callback region limit: 256 reachable objects; targets may be incomplete']});
  await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();assert.equal(h.calls.length,1);
  h.workspace.stable=false;h.workspace.copilotWaitReason='analysis-failed';
  h.workspace.sourceChanged.fire('editor-save');await settle();
  assert.equal(h.workspace.copilotDiagnostics.waitReason,'analysis-failed');assert.equal(h.calls.length,1);
});

for(const phase of ['countTokens','sendRequest','stream'])test(`model picker cancels a held ${phase} without waiting for the provider`,async t=>{
  const h=await harness();t.after(h.dispose);await h.start().ready;
  const held=h.holdNext('model-a',phase),pending=h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  await held.started;h.pick('model-b');
  const selecting=h.commands.get('dynsight.selectCopilotModel')!();
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    const finished=await Promise.race([selecting.then(()=>true),new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),250);})]);
    assert.equal(finished,true,'the previous provider must not block model selection after cancellation');
    assert.equal(h.config.get('copilotModel'),'model-b');
    assert.equal(h.workspace.copilotDiagnostics.state,'more-callbacks-available');
  } finally {clearTimeout(timer);held.reject(new Error('late provider rejection'));await pending;await selecting;}
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.config.get('copilotModel'),'model-b');
  assert.equal(h.workspace.copilotDiagnostics.failures,0,'a stale rejection must not replace the new model state');
});

for(const phase of ['countTokens','sendRequest','stream'])test(`provider timeout settles a held ${phase} even when cancellation is ignored`,async t=>{
  const h=await harness(false,20);t.after(h.dispose);await h.start().ready;
  const held=h.holdNext('model-a',phase),pending=h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  await held.started;let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    const finished=await Promise.race([pending.then(()=>true),new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),250);})]);
    assert.equal(finished,true,'the timeout must reject the provider wait, not only cancel its token');
    if(phase!=='countTokens')assert.equal(h.tokens[0].cancelled,true);
    assert.equal(h.workspace.copilotDiagnostics.state,'request-failed');
    assert.equal(h.workspace.copilotDiagnostics.failures,1);
    assert.equal(h.workspace.copilotDiagnostics.completed,0);
  } finally {clearTimeout(timer);held.release();await pending;}
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.calls.length,phase==='countTokens'?0:1,'a timed-out token count must not start a late request');
  assert.equal(h.workspace.copilotDiagnostics.completed,0,'a late timeout response is not accepted');
});

test('model picker cancels provider model discovery after restart',async t=>{
  const h=await harness();t.after(h.dispose);await h.start().ready;
  await h.commands.get('dynsight.analyzeCallbacksWithCopilot')!();
  h.stop();await h.start().ready;
  const held=h.holdNext('model-a','discovery');
  h.workspace.analysisKey='changed';h.workspace.generation++;h.workspace.sourceChanged.fire('editor-save');
  await held.started;h.pick('model-b');
  const selecting=h.commands.get('dynsight.selectCopilotModel')!();let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    const finished=await Promise.race([selecting.then(()=>true),new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),250);})]);
    assert.equal(finished,true,'provider discovery must not block switching models');
    assert.equal(h.config.get('copilotModel'),'model-b');
  } finally {clearTimeout(timer);held.release();await selecting;}
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(h.calls,['model-a'],'late discovery must not request analysis with the old model');
  assert.equal(h.workspace.copilotDiagnostics.state,'more-callbacks-available');
});
