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
  assert.deepEqual(await second.request({ type: 'cache-init', directory, key: 'v1' }).promise, { state: 'ready' });
  const restored = [], actual = [];
  for (const [uri, text] of sources) {
    const job = second.request({ type: 'cache-restore', uri, text, skip: true, expandMacros: false });
    const result = await job.promise; assert.equal(result.hit, true);
    restored.push([uri, job.id, result.stamp]); actual.push(result.file);
  }
  assert.equal((await second.request({ type: 'cache-validate', versions: restored }).promise).valid, true);
  assert.ok(actual[0].references.some(reference => reference.name === 'one' && reference.callKind === 'inferred'));
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

test('corrupt cache record requests manual recovery instead of masquerading as a source edit', async () => temporary(async (directory, spawn) => {
  const first = spawn(); await first.request({ type: 'cache-init', directory, key: 'v1' }).promise;
  const versions = await build(first); await first.request({ type: 'cache-save', versions }).promise;
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  await writeFile(path.join(directory, manifest.generation, manifest.entries[0].name), '{}');
  const second = spawn(); await second.request({ type: 'cache-init', directory, key: 'v1' }).promise;
  const result = await second.request({ type: 'cache-restore', uri: sources[0][0], text: sources[0][1], skip: true, expandMacros: false }).promise;
  assert.deepEqual(result, { hit: false, invalid: true });
}));
