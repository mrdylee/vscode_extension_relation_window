import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

function client() {
  const worker = new Worker(path.resolve('dist/analysis-worker.cjs'), { workerData: { assets: path.resolve('dist') } });
  let serial = 0; const pending = new Map(); let diagnostics;
  worker.on('message', message => {
    if (message.type === 'diagnostics') { diagnostics = message.diagnostics; return; }
    const request = pending.get(message.id); pending.delete(message.id);
    clearTimeout(request?.timer);
    if (message.error) request?.reject(new Error(message.error)); else request?.resolve(message.result);
  });
  worker.on('error', error => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); } pending.clear(); });
  const request = data => {
    const id = ++serial;
    return { id, promise: new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`No ${data.type ?? 'analyze'} response`)); }, 5000);
      pending.set(id, { resolve, reject, timer }); worker.postMessage({ ...data, id });
    }) };
  };
  return { worker, request, get diagnostics() { return diagnostics; } };
}
const sources = [
  ['file:///main.c', 'typedef void (*CB)(void);extern CB slot;void run(void){slot();}'],
  ['file:///slot.c', 'typedef void (*CB)(void);void one(void){}void two(void){}CB slot=one;'],
  ['file:///unrelated.c', 'void unrelated(void){}']
];
async function build(connection) {
  const versions = [];
  for (const [uri, text] of sources) {
    const job = connection.request({ uri, text, skip: true, expandMacros: false }); await job.promise;
    versions.push([uri, job.id, -job.id]);
  }
  const derived = await connection.request({ type: 'derive', versions }).promise;
  for (const [uri, stamp] of derived.versions) versions.find(entry => entry[0] === uri)[2] = stamp;
  return versions;
}
async function temporary(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'dynsight-worker-cache-'));
  const clients = []; const spawn = () => { const connection = client(); clients.push(connection); return connection; };
  try { await run(directory, spawn); } finally { await Promise.all(clients.map(connection => connection.worker.terminate())); await rm(directory, { recursive: true, force: true }); }
}

test('unchanged restart restores full callback results without source or relation phases', async () => temporary(async (directory, spawn) => {
  const first = spawn();
  assert.deepEqual(await first.request({ type: 'cache-init', directory, key: 'v1' }).promise, { state: 'missing' });
  const versions = await build(first);
  assert.equal((await first.request({ type: 'cache-save', versions }).promise).saved, true);
  await first.worker.terminate();
  const second = spawn();
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  assert.deepEqual(await second.request({ type: 'cache-init', directory, key: 'v1' }).promise, { state: 'ready', savedVersion: manifest.analysisVersion });
  const restored = [], actual = [];
  for (const [uri, text] of sources) {
    const job = second.request({ type: 'cache-restore', uri, text, skip: true, expandMacros: false });
    const result = await job.promise; assert.equal(result.hit, true);
    restored.push([uri, job.id, result.stamp]); actual.push(result.file);
  }
  assert.equal((await second.request({ type: 'cache-validate', versions: restored }).promise).valid, true);
  assert.ok(actual[0].references.some(reference => reference.name === 'one' && reference.callKind === 'inferred'));
  assert.ok(actual[1].callbackRegistrations.some(reference => reference.name === 'one' && reference.kind === 'reference' && reference.callKind === 'registered'));
  assert.ok(actual.every(file => !file.programs && !file.initializers));
  assert.deepEqual(second.diagnostics.phases, {}, 'restoring does not parse or rederive');
  assert.equal(second.diagnostics.counts.files, 3);
  assert.equal((await second.request({ type: 'cache-validate', versions: restored.slice(0, 1) }).promise).valid, false, 'deleted dependencies cannot restore the old graph');
}));

test('changed file reparses while restored raw flow recomputes dependent callbacks', async () => temporary(async (directory, spawn) => {
  const first = spawn(); await first.request({ type: 'cache-init', directory, key: 'v1' }).promise;
  const versions = await build(first); await first.request({ type: 'cache-save', versions }).promise;
  const before = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  const second = spawn(); await second.request({ type: 'cache-init', directory, key: 'v1' }).promise;
  const main = second.request({ type: 'cache-restore', uri: sources[0][0], text: sources[0][1], skip: true, expandMacros: false });
  const restored = await main.promise; assert.equal(restored.hit, true);
  const unrelated = second.request({ type: 'cache-restore', uri: sources[2][0], text: sources[2][1], skip: true, expandMacros: false });
  const independent = await unrelated.promise; assert.equal(independent.hit, true);
  // Validate the complete old generation before simulating a save in this session.
  const oldSlot = second.request({ type: 'cache-restore', uri: sources[1][0], text: sources[1][1], skip: true, expandMacros: false });
  const old = await oldSlot.promise;
  const previous = [[sources[0][0], main.id, restored.stamp], [sources[1][0], oldSlot.id, old.stamp], [sources[2][0], unrelated.id, independent.stamp]];
  assert.equal((await second.request({ type: 'cache-validate', versions: previous }).promise).valid, true);
  const text = sources[1][1].replace('slot=one', 'slot=two');
  assert.equal((await second.request({ type: 'cache-restore', uri: sources[1][0], text, skip: true, expandMacros: false }).promise).hit, false);
  const edit = second.request({ uri: sources[1][0], text, skip: true, expandMacros: false }); await edit.promise;
  const changed = [[sources[0][0], main.id, restored.stamp], [sources[1][0], edit.id, -edit.id], [sources[2][0], unrelated.id, independent.stamp]];
  assert.equal((await second.request({ type: 'cache-validate', versions: changed }).promise).valid, false);
  assert.equal((await second.request({ type: 'cache-save', versions: changed }).promise).saved, false, 'mixed raw/old derived state cannot persist');
  const result = await second.request({ type: 'derive', versions: changed }).promise;
  assert.equal(result.files.some(file => file.uri === sources[2][0]), false, 'unrelated restored component keeps its derived snapshot');
  const refs = result.files.find(file => file.uri === sources[0][0]).references;
  assert.ok(refs.some(ref => ref.name === 'two' && ref.callKind === 'inferred'));
  assert.equal(refs.some(ref => ref.name === 'one' && ref.callKind === 'inferred'), false);
  for (const [uri, stamp] of result.versions) changed.find(entry => entry[0] === uri)[2] = stamp;
  assert.equal((await second.request({ type: 'cache-save', versions: changed }).promise).saved, true);
  const after = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  const previousRecord = before.entries.find(entry => entry.uri === sources[2][0]), retained = after.entries.find(entry => entry.uri === sources[2][0]);
  assert.equal((await stat(path.join(directory, before.generation, previousRecord.name))).ino,
    (await stat(path.join(directory, after.generation, retained.name))).ino, 'unchanged raw and derived records reuse stored bytes');
  assert.notEqual(before.entries.find(entry => entry.uri === sources[0][0]).digest, after.entries.find(entry => entry.uri === sources[0][0]).digest,
    'changed cross-file callback results rewrite their record even when source text is unchanged');
  changed[0][1] = -1;
  assert.equal((await second.request({ type: 'cache-save', versions: changed }).promise).saved, false);
}));

test('alias conditions and numeric aggregate copies remain complete across warm, disk and saved edits', async () => temporary(async (directory, spawn) => {
  const definitions=Array.from({length:6},(_,n)=>`#if BOARD\n#define M${n} first\n#else\n#define M${n} second\n#endif\n`).join('');
  const fields=Array.from({length:270},(_,n)=>`struct Data data${n};`).join('');
  const values=Array.from({length:270},(_,n)=>`.data${n}={${n}},`).join('');
  const inputs=[
    {uri:'file:///alias.c',text:'#define BOARD FEATURE\n'+definitions+'typedef void(*CB)(void);static void first(void){}static void second(void){}void macro_run(void){'+Array.from({length:6},(_,n)=>`CB cb${n}=M${n};cb${n}();`).join('')+'}'},
    {uri:'file:///aggregate.c',text:`typedef void(*CB)(void);struct Data{unsigned value;};struct Object{${fields}CB cb;};
      static void target(void){}static void replacement(void){}static struct Object source={${values}.cb=target},destination;
      static void configure(void){destination=source;}void run(void){configure();destination.cb();}`}
  ];
  const files=new Map(),versions=[];
  const snapshot=(expected='target')=>{
    assert.ok([...files.values()].every(file=>!file.issues.some(issue=>/limit|budget|cancelled/i.test(issue))));
    const references=[...files.values()].flatMap(file=>file.references).filter(ref=>ref.callKind==='inferred');
    assert.deepEqual([...new Set(references.map(ref=>ref.name))].sort(),['first','second',expected].sort());
    assert.equal(references.length,13);
    const registrations=files.get('file:///alias.c').callbackRegistrations;
    assert.equal(registrations.length,12);
    assert.ok(registrations.every(ref=>ref.kind==='reference'&&ref.callKind==='registered'));
    assert.ok(references.every(ref=>ref.inference?.incomplete===false));
    return references.map(ref=>({name:ref.name,location:ref.location,conditions:ref.conditions,inference:ref.inference}));
  };
  const derive=async connection=>{
    const result=await connection.request({type:'derive',versions,analyzeCallbacks:true}).promise;
    for(const file of result.files)files.set(file.uri,file);
    for(const [uri,stamp] of result.versions)versions.find(value=>value[0]===uri)[2]=stamp;
  };
  const first=spawn();await first.request({type:'cache-init',directory,key:'root-fixes'}).promise;
  for(const input of inputs){const job=first.request({...input,skip:true,expandMacros:true,propagateCallbacks:true});files.set(input.uri,await job.promise);versions.push([input.uri,job.id,-job.id]);}
  await derive(first);const cold=snapshot();
  await derive(first);assert.deepEqual(snapshot(),cold);
  assert.equal((await first.request({type:'cache-save',versions}).promise).saved,true);
  await first.worker.terminate();
  const second=spawn();await second.request({type:'cache-init',directory,key:'root-fixes'}).promise;
  versions.length=0;files.clear();
  for(const input of inputs){
    const job=second.request({type:'cache-restore',...input,skip:true,expandMacros:true,propagateCallbacks:true}),result=await job.promise;
    assert.equal(result.hit,true);files.set(input.uri,result.file);versions.push([input.uri,job.id,result.stamp]);
  }
  assert.equal((await second.request({type:'cache-validate',versions,analyzeCallbacks:true}).promise).valid,true);
  assert.deepEqual(snapshot(),cold);
  const edit={...inputs[1],text:inputs[1].text.replace('.cb=target','.cb=replacement')};
  const job=second.request({...edit,skip:true,expandMacros:true,propagateCallbacks:true});files.set(edit.uri,await job.promise);versions[1]=[edit.uri,job.id,-job.id];
  await derive(second);snapshot('replacement');
}));

test('corrupt cache record requests manual recovery instead of masquerading as a source edit', async () => temporary(async (directory, spawn) => {
  const first = spawn(); await first.request({ type: 'cache-init', directory, key: 'v1' }).promise;
  const versions = await build(first); await first.request({ type: 'cache-save', versions }).promise;
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  await writeFile(path.join(directory, manifest.generation, manifest.entries[0].name), '{}');
  const second = spawn(); await second.request({ type: 'cache-init', directory, key: 'v1' }).promise;
  const result = await second.request({ type: 'cache-restore', uri: sources[0][0], text: sources[0][1], skip: true, expandMacros: false }).promise;
  assert.deepEqual(result, { hit: false, invalid: true });
}));

test('nested diagnostic callback leaves survive cold, warm, disk and saved target changes',async()=>temporary(async(directory,spawn)=>{
  const entries=Array.from({length:96},()=>'{.check={{.check_func=first}}}').join(',');
  const input={uri:'file:///diagnostic-table.c',text:`typedef void(*CB)(void);static void first(void){}static void second(void){}
    struct Check{CB check_func;};struct Diagnostic{struct Check check[1];};struct Table{struct Diagnostic diagnostic[96];};
    static struct Table source={.diagnostic={${entries}}},destination;
    static void configure(struct Table*out){*out=source;}void run(void){configure(&destination);
    ${Array.from({length:96},(_,n)=>`destination.diagnostic[${n}].check[0].check_func();`).join('')}}`,skip:true,expandMacros:true,propagateCallbacks:true};
  const check=(file,name)=>{
    assert.deepEqual(file.issues,[]);
    const calls=file.references.filter(ref=>ref.callKind==='inferred');
    assert.equal(calls.length,96);
    assert.ok(calls.every(ref=>ref.name===name&&ref.inference?.incomplete===false));
    return calls;
  };
  const first=spawn();await first.request({type:'cache-init',directory,key:'photo-pattern'}).promise;
  const job=first.request(input);await job.promise;
  let versions=[[input.uri,job.id,-job.id]];
  const cold=await first.request({type:'derive',versions,analyzeCallbacks:true}).promise;
  const expected=check(cold.files[0],'first');versions[0][2]=cold.versions[0][1];
  const warm=await first.request({type:'derive',versions,analyzeCallbacks:true}).promise;
  if(warm.files.length)assert.deepEqual(check(warm.files[0],'first'),expected);
  assert.equal((await first.request({type:'cache-save',versions}).promise).saved,true);
  await first.worker.terminate();
  const second=spawn();await second.request({type:'cache-init',directory,key:'photo-pattern'}).promise;
  const restoredJob=second.request({type:'cache-restore',...input}),restored=await restoredJob.promise;
  assert.equal(restored.hit,true);assert.deepEqual(check(restored.file,'first'),expected);
  assert.equal((await second.request({type:'cache-validate',versions:[[input.uri,restoredJob.id,restored.stamp]],analyzeCallbacks:true}).promise).valid,true);
  const edit=second.request({...input,text:input.text.replaceAll('check_func=first','check_func=second')});await edit.promise;
  const changed=await second.request({type:'derive',versions:[[input.uri,edit.id,-edit.id]],analyzeCallbacks:true}).promise;
  check(changed.files[0],'second');
}));
