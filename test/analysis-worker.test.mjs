import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import path from 'node:path';

test('macro growth yields partial function arguments without exhausting a small Worker heap', async () => {
  const worker = new Worker(path.resolve('dist/analysis-worker.cjs'), { workerData: { assets: path.resolve('dist') }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
  let serial = 0; const pending = new Map();
  worker.on('message', message => {
    const request = pending.get(message.id); pending.delete(message.id);
    if (message.error) request?.reject(new Error(message.error)); else request?.resolve(message.result);
  });
  worker.on('error', error => { for (const request of pending.values()) request.reject(error); pending.clear(); });
  const request = data => {
    const id = ++serial;
    return { id, promise: new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ ...data, id }); }) };
  };
  let timer;
  try {
    const sources = [['file:///api.h', '#if BOARD\n#define M(x) foo(x)\n#else\n#define M(x) bar(x)\n#endif\nvoid foo(int);void bar(int);void svc(void (*)(void));\n']];
    for (let n = 0; n < 20; n++) sources.push([`file:///source${n}.c`, `#include "api.h"\nvoid cb${n}(void){}void run${n}(void){${'M(0);'.repeat(500)}svc(cb${n});}`]);
    const versions = [];
    for (const [uri, text] of sources) {
      const job = request({ uri, text, skip: true }); await job.promise;
      versions.push([uri, job.id, -job.id]);
    }
    const result = await Promise.race([
      request({ type: 'derive', versions }).promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Memory-limited analysis did not finish')), 20000); })
    ]);
    assert.ok(result.files.some(file => file.issues.some(issue => /memory budget/.test(issue))));
    for (let n = 0; n < 20; n++) assert.ok(result.files.find(file => file.uri === `file:///source${n}.c`).functionArguments?.some(ref => ref.name === `cb${n}`), 'literal callback arguments survive partial analysis');
    assert.ok(result.files.some(file => file.functionArguments?.some(ref => ref.inference?.incomplete)));
    assert.ok(result.files.every(file => !file.argumentPrograms));
    const next = await request({ uri: 'file:///next.c', text: 'void next(void){}', skip: true }).promise;
    assert.ok(next.symbols.some(symbol => symbol.name === 'next'), 'the Worker still accepts source changes');
  } finally { clearTimeout(timer); await worker.terminate(); }
});

test('repeated empty includes cannot block following source analysis in the Worker', async () => {
  const worker = new Worker(path.resolve('dist/analysis-worker.cjs'), { workerData: { assets: path.resolve('dist') } });
  let serial = 0;
  const pending = new Map();
  worker.on('message', message => {
    const request = pending.get(message.id); pending.delete(message.id);
    if (message.error) request?.reject(new Error(message.error)); else request?.resolve(message.result);
  });
  const request = data => {
    const id = ++serial;
    const promise = new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ ...data, id }); });
    return { id, promise };
  };
  let timer;
  try {
    const versions = [], sources = [['file:///main.c', '#include "h27.h"\nvoid target(void){}void svc(void (*)(void));void run(void){target();svc(target);}'], ['file:///h0.h', '']];
    for (let n = 1; n <= 27; n++) sources.push([`file:///h${n}.h`, `#include "h${n-1}.h"\n#include "h${n-1}.h"\n`]);
    for (const [uri, text] of sources) {
      const job = request({ uri, text, skip: true }); await job.promise;
      versions.push([uri, job.id, -job.id]);
    }
    const deriving = request({ type: 'derive', versions });
    const next = request({ uri: 'file:///next.c', text: 'void next(void){}', skip: true });
    const [result, parsed] = await Promise.race([
      Promise.all([deriving.promise, next.promise]),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Include traversal blocked the following Worker request')), 3000); })
    ]);
    const partial = result.files.find(file => file.uri === 'file:///main.c');
    assert.ok(partial.issues.some(issue => /Macro include.*limit/.test(issue)));
    assert.deepEqual(partial.functionArguments.map(ref => ref.name), ['target']);
    assert.equal(partial.functionArguments[0].inference.incomplete, true);
    assert.ok(result.files.every(file => !file.programs && !file.initializers && !file.argumentPrograms), 'argument-only flow stays in the Worker');
    assert.ok(parsed.symbols.some(symbol => symbol.name === 'next'));
    const replay = await request({ type: 'derive', versions }).promise;
    assert.deepEqual(replay.versions, result.versions, 'partial argument results retain identity until acknowledged');
    for (const [uri, stamp] of result.versions) versions.find(entry => entry[0] === uri)[2] = stamp;
    assert.equal((await request({ type: 'derive', versions }).promise).files.length, 0);
  } finally { clearTimeout(timer); await worker.terminate(); }
});

test('discarded derived responses are retried until the caller acknowledges them', async () => {
  const worker = new Worker(path.resolve('dist/analysis-worker.cjs'), { workerData: { assets: path.resolve('dist') } });
  let id = 0; const pending = new Map();
  worker.on('message', message => { const request = pending.get(message.id); pending.delete(message.id); if (message.error) request?.reject(new Error(message.error)); else request?.resolve(message.result); });
  worker.on('error', error => { for (const request of pending.values()) request.reject(error); pending.clear(); });
  const request = message => { const serial = ++id; return { id: serial, result: new Promise((resolve, reject) => { pending.set(serial, { resolve, reject }); worker.postMessage({ ...message, id: serial }); }) }; };
  try {
    const main = request({ uri: 'file:///main.c', text: '#include "api.h"\nvoid run(void){CALL();}', skip: true }); await main.result;
    const header = request({ uri: 'file:///api.h', text: '#define CALL() foo()\nvoid foo(void){}', skip: true }); await header.result;
    const versions = [['file:///main.c', main.id, -main.id], ['file:///api.h', header.id, -header.id]];
    const first = await request({ type: 'derive', versions }).result;
    assert.ok(first.files.some(file => file.references.some(ref => ref.name === 'foo' && ref.expansion)));
    // Simulate a discarded old revision: do not acknowledge first.versions.
    const retry = await request({ type: 'derive', versions }).result;
    assert.deepEqual(retry.versions, first.versions);
    assert.equal(retry.files.length, first.files.length);
    for (const [uri, stamp] of retry.versions) versions.find(entry => entry[0] === uri)[2] = stamp;
    assert.equal((await request({ type: 'derive', versions }).result).files.length, 0);
    const edited = request({ uri: 'file:///api.h', text: 'void foo(void){}', skip: true }); await edited.result;
    versions[1] = ['file:///api.h', edited.id, -edited.id];
    const cleared = await request({ type: 'derive', versions }).result;
    assert.ok(cleared.files.some(file => file.uri === 'file:///main.c' && !file.references.some(ref => ref.expansion)), 'header edit restores raw calls');
    const stale = await request({ type: 'derive', versions: [['file:///main.c', -123, 0]] }).result;
    assert.equal(stale.stale, true);
    worker.postMessage({ type: 'reset' });
    const callbackMain=request({uri:'file:///callbacks.c',text:'typedef void (*CB)(void);extern CB slot;void one(void){}void two(void){}void svc(CB cb);void run(void){svc(slot);slot();}',skip:true});await callbackMain.result;
    const slot=request({uri:'file:///slot.c',text:'typedef void (*CB)(void);void one(void);void two(void);CB slot=one;',skip:true});await slot.result;
    const callbacks=[['file:///callbacks.c',callbackMain.id,-callbackMain.id],['file:///slot.c',slot.id,-slot.id]];
    const target=await request({type:'derive',versions:callbacks}).result;
    assert.ok(target.files.every(file=>!file.programs&&!file.initializers),'Worker-only flow facts are not copied into the extension host');
    assert.ok(target.files.find(file=>file.uri==='file:///callbacks.c').references.some(ref=>ref.name==='one'&&ref.callKind==='inferred'));
    assert.deepEqual(target.files.find(file=>file.uri==='file:///callbacks.c').functionArguments.map(ref=>ref.name),['one']);
    for(const [uri,stamp] of target.versions)callbacks.find(entry=>entry[0]===uri)[2]=stamp;
    assert.equal((await request({type:'derive',versions:callbacks}).result).files.length,0,'cached callback results keep acknowledged identity');
    const next=request({uri:'file:///slot.c',text:'typedef void (*CB)(void);void two(void);CB slot=two;',skip:true});await next.result;
    callbacks[1]=['file:///slot.c',next.id,-next.id];
    const updated=await request({type:'derive',versions:callbacks}).result;
    const refs=updated.files.find(file=>file.uri==='file:///callbacks.c').references;
    assert.ok(refs.some(ref=>ref.name==='two'&&ref.callKind==='inferred'));
    assert.equal(refs.some(ref=>ref.name==='one'&&ref.callKind==='inferred'),false);
    assert.deepEqual(updated.files.find(file=>file.uri==='file:///callbacks.c').functionArguments.map(ref=>ref.name),['two']);
    const replay=await request({type:'derive',versions:callbacks}).result;
    assert.deepEqual(replay.versions,updated.versions,'unacknowledged argument edits are replayed');
    for(const [uri,stamp] of replay.versions)callbacks.find(entry=>entry[0]===uri)[2]=stamp;
    assert.equal((await request({type:'derive',versions:callbacks}).result).files.length,0);
    worker.postMessage({type:'remove',uri:'file:///slot.c'});
    const deleted=await request({type:'derive',versions:callbacks.slice(0,1)}).result;
    assert.deepEqual(deleted.files.find(file=>file.uri==='file:///callbacks.c').functionArguments??[],[],'dependency deletion clears argument targets');
  } finally { await worker.terminate(); }
});
