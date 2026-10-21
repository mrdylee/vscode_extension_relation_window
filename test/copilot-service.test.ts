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
async function harness(denied=false) {
  const storage=await mkdtemp(path.join(tmpdir(),'dynsight-service-'));
  const parser=await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'),path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm'));
  const file=parser.analyze('file:///example.c','struct Ops{void(*cb_complete)(void);};void run(struct Ops*p){p->cb_complete();}'+(denied?'void run2(struct Ops*p){p->cb_complete();}':''));
  const config=new Map<string,unknown>([['copilotCallbacks',false],['copilotModel','']]);
  const calls:string[]=[],queries:unknown[]=[],messages:string[]=[];
  const commands=new Map<string,(...args:any[])=>Promise<void>>(),settings=new Emitter(),state=new Map<string,unknown>();
  const permissions=new Map<string,boolean>();let pick='model-a',pickCount=0;
  let held: {id:string; started:()=>void; promise:Promise<void>} | undefined;
  const tokens:{cancelled:boolean}[]=[];
  const models=['model-a','model-b'].map(id=>({id,vendor:'copilot',name:id,family:'test',version:'1',maxInputTokens:64000,
    countTokens:async()=>100,sendRequest:async(_messages:unknown,_options:unknown,token:{cancelled:boolean})=>{
      calls.push(id);permissions.set(id,!denied);if(denied)throw new Error('Access denied');
      tokens.push(token);if(held?.id===id){const waiting=held;held=undefined;waiting.started();await waiting.promise;}
      return{text:(async function*(){yield'{"status":"not-found","candidates":[]}';})()};
    }}));
  let available=models;
  async function update(key:string,value:unknown){config.set(key,value);settings.fire({affectsConfiguration:(name:string)=>name===`dynsight.${key}`});}
  const vscode={lm:{selectChatModels:async(selector:unknown)=>{queries.push(selector);return available;}},
    commands:{registerCommand:(id:string,command:any)=>{commands.set(id,command);return{dispose(){}};}},
    workspace:{isTrusted:true,getConfiguration:()=>({get:(key:string,fallback:unknown)=>config.get(key)??fallback,update}),onDidChangeConfiguration:settings.event},
    ConfigurationTarget:{Workspace:2},window:{showQuickPick:async(items:any[])=>{pickCount++;return items.find(item=>item.value.id===pick);},showErrorMessage:async(value:string)=>{messages.push(value);},showInformationMessage:async(value:string)=>{messages.push(value);}},
    LanguageModelChatMessage:{User:(value:string)=>value},CancellationTokenSource:class{token={cancelled:false};cancel(){this.token.cancelled=true;}dispose(){}}
  };
  const context={storageUri:{fsPath:storage},subscriptions:[]as{dispose():void}[],workspaceState:{get:(key:string)=>state.get(key),update:async(key:string,value:unknown)=>{state.set(key,value);}},languageModelAccessInformation:{canSendRequest:(model:{id:string})=>permissions.get(model.id)}};
  const workspace={index:new RelationIndex(),ready:Promise.resolve(),stable:true,generation:1,analysisKey:'key',hasDirtySources:false,
    sourceChanged:new Emitter(),settled:new Emitter(),changed:new Emitter(),diagnosticsChanged:new Emitter(),whenIdle:async()=>{},copilotDiagnostics:undefined as any};
  workspace.index.update(file);
  function stop(){for(const item of context.subscriptions.splice(0))item.dispose();}
  function start(){const module={exports:{}as any};runInNewContext(bundle,{module,exports:module.exports,process,Buffer,URL,AbortController,setTimeout,clearTimeout,setImmediate,require:(name:string)=>name==='vscode'?vscode:require(name)});return module.exports.registerCopilotCallbacks(context,workspace);}
  return{start,stop,config,commands,calls,queries,messages,workspace,update,state,tokens,
    holdNext:(id:string)=>{let release!:()=>void,started!:()=>void;const observed=new Promise<void>(done=>{started=done;});const promise=new Promise<void>(done=>{release=done;});held={id,started,promise};return{started:observed,release};},
    pick:(id:string)=>{pick=id;},pickCount:()=>pickCount,available:(ids:string[])=>{available=models.filter(model=>ids.includes(model.id));},
    dispose:async()=>{stop();await rm(storage,{recursive:true,force:true});}};
}
const settle=()=>new Promise(done=>setTimeout(done,1100));
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
