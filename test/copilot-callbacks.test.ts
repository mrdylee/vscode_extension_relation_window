import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAnalyzer } from '../src/analyzer';
import { CopilotCallbackController, CopilotSnapshot, CopilotProvider } from '../src/copilot-callbacks';
import { callbackContexts } from '../src/copilot-context';

let analyzer: Awaited<ReturnType<typeof createAnalyzer>>;
before(async () => { analyzer = await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'), path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm')); });
const source = `struct Ops {void (*cb_complete)(void);};
static void target(void){}
static struct Ops registered={.cb_complete=target};
const struct Ops *get_ops(void){return &registered;}
static const struct Ops *active;
void init(const struct Ops *ops){active=ops;}
void configure(void){init(get_ops());}
void run(void){active->cb_complete();}`;
const snapshot = (files = [source], generation = 1): CopilotSnapshot => ({ generation, settingsKey: 'settings-1', files: files.map((text, n) => analyzer.analyze(`file:///demo/${n}.c`, text)) });
async function temporary(run: (cacheDir: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), 'dynsight-copilot-'));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
function validReply(s: CopilotSnapshot) {
  const context = callbackContexts(s.files)[0];
  const target = context.targets.find(item => item.name === 'target')!;
  assert.ok(target, 'registration function must be a context candidate');
  return JSON.stringify({status: 'candidates', candidates: [{targetId: target.id, evidenceIds: target.evidenceIds, reason: 'Registered in callback table, returned by getter and passed into init.'}]});
}
function controller(cacheDir: string, provider: CopilotProvider, isCurrent = (_s: CopilotSnapshot) => true) {
  return new CopilotCallbackController({cacheDir, provider, isCurrent});
}

test('restart restores validated candidates and normal analysis reuses cache without a request', async () => temporary(async cacheDir => {
  const s = snapshot(); let requests = 0;
  const provider = {modelKey: 'model-1', complete: async () => { requests++; return validReply(s); }};
  const first = controller(cacheDir, provider);
  assert.equal((await first.restore(s)).requested, 0);
  const generated = await first.analyzeUnresolved(s, {reason: 'enabled'});
  assert.equal(generated.requested, 1); assert.equal(generated.hints[0].status, 'candidates');
  assert.equal(generated.hints[0].candidates[0].targetId, s.files[0].symbols.find(item => item.name === 'target')!.id);
  const restarted = controller(cacheDir, provider);
  assert.equal((await restarted.restore({...s, generation: 2})).hints[0].cached, true);
  assert.equal((await restarted.analyzeUnresolved(s, {reason: 'saved-change'})).cached, 1);
  assert.equal(requests, 1);
  const files = await readdir(cacheDir);
  assert.ok(files.every(file => file.endsWith('.json')));
  assert.ok(!(await readFile(path.join(cacheDir, files[0]), 'utf8')).includes('static struct Ops'), 'cache must not store source prompts');
}));

test('unrelated file edits preserve cache while getter/registration edits invalidate it', async () => temporary(async cacheDir => {
  const s = snapshot([source, 'int unrelated=1;']);
  const c = controller(cacheDir, {modelKey: 'model-1', complete: async () => validReply(s)});
  await c.analyzeUnresolved(s, {reason: 'enabled'});
  assert.equal((await c.restore(snapshot([source, 'int unrelated=2;'], 2))).cached, 1);
  assert.equal((await c.restore(snapshot([source.replace('return &registered;', 'return 0;'), 'int unrelated=2;'], 3))).cached, 0);
  assert.equal((await c.restore({...s, settingsKey: 'settings-2'})).cached, 0);
  assert.equal((await controller(cacheDir, {modelKey: 'model-2', complete: async () => validReply(s)}).restore(s)).cached, 0);
}));

test('cached negative search is invalidated when a new file supplies a callback registration', async () => temporary(async cacheDir => {
  const missing = snapshot(['struct Ops{void(*cb_complete)(void);};void run(struct Ops*p){p->cb_complete();}']);
  const c = controller(cacheDir, {modelKey: 'model-1', complete: async () => '{"status":"not-found","candidates":[]}'});
  assert.equal((await c.analyzeUnresolved(missing, {reason: 'enabled'})).hints[0].status, 'not-found');
  assert.equal((await c.restore(snapshot([missing.files[0].text, 'int unrelated;']))).cached, 1);
  const added = snapshot([missing.files[0].text, 'void target(void){} struct Ops ops={.cb_complete=target};']);
  assert.equal((await c.restore(added)).cached, 0);
}));

test('invalid target/evidence, malformed replies and provider errors are not cached as negatives', async () => temporary(async cacheDir => {
  const s = snapshot();
  for (const reply of ['not json', '{"status":"candidates","candidates":[]}', JSON.stringify({status:'candidates',candidates:[{targetId:'invented', evidenceIds:['invented'],reason:'guess'}]})]) {
    const c = controller(cacheDir, {modelKey:'model-1',complete:async()=>reply});
    const result = await c.analyzeUnresolved(s,{reason:'enabled'});
    assert.equal(result.failures, 1); assert.equal(result.hints.length, 0);
    assert.equal((await c.restore(s)).cached, 0);
  }
  const failed = controller(cacheDir, {modelKey:'model-1',complete:async()=>{throw new Error('offline');}});
  assert.equal((await failed.analyzeUnresolved(s,{reason:'enabled'})).failures,1);
}));

test('cancelled or superseded work cannot apply or persist a stale answer', async () => temporary(async cacheDir => {
  const s=snapshot(); let resolve!: (value:string)=>void; let current=true; let applied=0;
  const c=new CopilotCallbackController({cacheDir,provider:{modelKey:'model-1',complete:async()=>new Promise<string>(done=>{resolve=done;})},isCurrent:()=>current,onHints:()=>applied++});
  const pending=c.analyzeUnresolved(s,{reason:'enabled'});
  while(!resolve) await new Promise(done=>setTimeout(done,1));
  current=false;c.invalidate();resolve(validReply(s));
  assert.equal((await pending).stale,true);assert.equal(applied,0);
  current=true;assert.equal((await c.restore(s)).cached,0);
}));

test('each run is bounded to five new requests, restores all cached results, and force bypasses valid cache', async () => temporary(async cacheDir => {
  const s=snapshot([`struct Ops{void(*cb)(void);};${Array.from({length:7},(_,n)=>`void run${n}(struct Ops*p){p->cb();}`).join('\n')}`]);
  let requests=0;const c=controller(cacheDir,{modelKey:'model-1',complete:async()=>{requests++;return '{"status":"not-found","candidates":[]}';}});
  const first=await c.analyzeUnresolved(s,{reason:'enabled'});
  assert.equal(first.requested,5);assert.equal(first.remaining,2);
  const second=await c.analyzeUnresolved(s,{reason:'saved-change'});
  assert.equal(second.requested,2);assert.equal(second.cached,5);
  assert.equal((await c.restore(s)).cached,7);
  assert.equal((await c.analyzeUnresolved(s,{reason:'force'})).requested,5);
  assert.equal(requests,12);
  assert.equal((await c.restore(s)).cached,5,'force leaves the remaining two invalidated for the next bounded batch');
  assert.equal((await c.analyzeUnresolved(s,{reason:'enabled'})).requested,2);
}));

test('context follows registration, getter and argument flow and excludes comments as function evidence', () => {
  const s=snapshot([source+'\n// .cb_complete = forged\nvoid forged(void){}', 'void secret(void){}']);
  const context=callbackContexts(s.files)[0];
  const text=JSON.stringify(context);
  for(const name of ['registered','get_ops','init','configure','target']) assert.ok(text.includes(name));
  assert.ok(!context.targets.some(target=>target.name==='forged'||target.name==='secret'));
  assert.ok(JSON.stringify(context).length<40_000);
});

test('tampered or truncated cache is a miss without a provider call', async () => temporary(async cacheDir => {
  const s=snapshot();let calls=0;const c=controller(cacheDir,{modelKey:'model-1',complete:async()=>{calls++;return validReply(s);}});
  await c.analyzeUnresolved(s,{reason:'enabled'});
  const filename=path.join(cacheDir,(await readdir(cacheDir))[0]);
  await writeFile(filename,'{');assert.equal((await c.restore(s)).cached,0);assert.equal(calls,1);
}));

test('multi-file getter and formal parameter mapping are supplied without assuming the third argument', async () => temporary(async cacheDir => {
  const s=snapshot([
    `struct Callbacks{void(*cb_preprocess)(void);};static void target(void){}
     static const struct Callbacks table={.cb_preprocess=target};
     const struct Callbacks*get_callbacks(void){return &table;}`,
    `struct Callbacks;const struct Callbacks*get_callbacks(void);
     void stage_init(int,const struct Callbacks*,int);
     void configure(void){stage_init(11,get_callbacks(),22);}`,
    `struct Callbacks{void(*cb_preprocess)(void);};static const struct Callbacks*active;
     void stage_init(int first,const struct Callbacks*cbs,int third){active=cbs;}
     void run(void){active->cb_preprocess();}`
  ]);
  let sent='';const c=controller(cacheDir,{modelKey:'model-1',complete:async prompt=>{sent=prompt;return validReply(s);}});
  const result=await c.analyzeUnresolved(s,{reason:'enabled'});
  assert.equal(result.hints[0].candidates[0].targetId,s.files[0].symbols.find(symbol=>symbol.name==='target')!.id);
  assert.ok(sent.includes('stage_init(11,get_callbacks(),22)'));
  assert.ok(sent.includes('stage_init(int first,const struct Callbacks*cbs,int third)'));
  assert.ok(sent.includes('return &table'));
  assert.equal(result.hints[0].callsite.uri,s.files[2].uri);
}));

test('unevaluated sizeof callback expressions do not trigger requests or become candidate sites', async () => temporary(async cacheDir => {
  const s=snapshot(['struct Ops{int(*cb)(void);};int inspect(struct Ops*p){return sizeof(p->cb());}']);
  let requests=0;const c=controller(cacheDir,{modelKey:'model-1',complete:async()=>{requests++;return '{"status":"not-found","candidates":[]}';}});
  assert.equal(callbackContexts(s.files).length,0);
  const result=await c.analyzeUnresolved(s,{reason:'enabled'});
  assert.equal(result.requested,0);assert.equal(requests,0);
}));

test('only queued sites construct prompts and old shifted-location records are removed on saved analysis', async () => temporary(async cacheDir => {
  let requests=0;const c=controller(cacheDir,{modelKey:'model-1',complete:async()=>{requests++;return '{"status":"not-found","candidates":[]}';}});
  const s=snapshot();
  await c.analyzeUnresolved(s,{reason:'enabled'});
  await c.analyzeUnresolved(snapshot(['\n'+source],2),{reason:'saved-change'});
  assert.equal((await readdir(cacheDir)).filter(name=>name.endsWith('.json')).length,1);
  assert.equal(requests,2);
}));

test('scope-limited not-found is marked and prompt size stays bounded', async () => temporary(async cacheDir => {
  const many=snapshot([`struct Ops{void(*cb)(void);};void run(struct Ops*p){p->cb();}`, ...Array.from({length:50},(_,n)=>`void target${n}(void){}struct Ops ops${n}={.cb=target${n}};`)]);
  let size=0;const c=controller(cacheDir,{modelKey:'model-1',complete:async prompt=>{size=Buffer.byteLength(prompt);return '{"status":"not-found","candidates":[]}';}});
  const result=await c.analyzeUnresolved(many,{reason:'enabled'});
  assert.ok(size<64*1024);assert.equal(result.hints[0].contextLimited,true);
}));
