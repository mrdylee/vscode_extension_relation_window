import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const bundle = buildSync({ entryPoints: ['src/workspace.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vscode'] }).outputFiles[0].text;
const disposable = () => ({ dispose() {} });
class Emitter {
  listeners = new Set();
  event = listener => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; };
  fire(value) { for (const listener of this.listeners) listener(value); }
  dispose() { this.listeners.clear(); }
}
class Uri {
  constructor(value) { this.value = value; this.path = new URL(value).pathname; }
  toString() { return this.value; }
  static parse(value) { return new Uri(value); }
}
const uri = name => Uri.parse(`file:///review/${name}`);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Workspace operation did not settle')), 3000); })]); }
  finally { clearTimeout(timer); }
}
function fixture(t, files = []) {
  const folder = { uri: Uri.parse('file:///review'), name: 'review', index: 0 };
  const created = new Emitter(), changed = new Emitter(), deleted = new Emitter();
  const adapter = {
    workspaceFolders: [folder], textDocuments: [],
    getConfiguration: () => ({ get: (_key, fallback) => fallback }),
    getWorkspaceFolder: () => folder, asRelativePath: value => value.path.slice('/review/'.length),
    findFiles: async () => files,
    createFileSystemWatcher: () => ({ dispose() {}, onDidCreate: created.event, onDidChange: changed.event, onDidDelete: deleted.event }),
    onDidChangeTextDocument: disposable, onDidCloseTextDocument: disposable,
    onDidChangeConfiguration: disposable, onDidChangeWorkspaceFolders: disposable,
    fs: { readFile: async () => Buffer.from('') }
  };
  const vscode = { EventEmitter: Emitter, Uri, RelativePattern: class {}, env: {}, version: 'test', workspace: adapter };
  const module = { exports: {} };
  runInNewContext(bundle, { module, exports: module.exports, process, Buffer, URL, setTimeout, clearTimeout, require: name => name === 'vscode' ? vscode : require(name) });
  const workspace = new module.exports.WorkspaceIndex(process.cwd());
  t.after(async () => { const worker = workspace.worker; workspace.dispose(); await worker.terminate(); });
  return { workspace, adapter, created, changed, deleted };
}

const latest = 'typedef void(*CB)(void);void new_target(void){}void task(void){CB cb=new_target;cb();}';
test('a late disk read cannot replace a newer buffered edit in the real Worker', async t => {
  const { workspace, adapter } = fixture(t);
  await workspace.ready;
  const file = uri('edit.c'), read = deferred();
  adapter.fs.readFile = () => read.promise;
  const old = workspace.enqueue(file);
  adapter.textDocuments = [{ uri: file, isClosed: false, getText: () => latest }];
  await workspace.enqueue(file);
  read.resolve(Buffer.from('void old_target(void){}void task(void){old_target();}'));
  await old; await workspace.derive();
  const task = workspace.index.symbols().find(symbol => symbol.name === 'task');
  assert.equal(workspace.index.files.get(file.toString()).text, latest);
  assert.ok(workspace.index.relations(task.id, 'callees').some(group => group.name === 'new_target'), 'latest callback resolution must finish');
  assert.equal(workspace.status, 'Index ready');
  await bounded(workspace.whenIdle());
});

for (const action of ['delete', 'rebuild']) test(`a disk read pending across ${action} cannot re-enter the Worker`, async t => {
  const { workspace, adapter, deleted } = fixture(t);
  await workspace.ready;
  const file = uri('obsolete.c'), read = deferred();
  const request = workspace.request, parsed = [];
  workspace.request = function (message) { if (message.uri) parsed.push(message.uri); return request.call(this, message); };
  adapter.fs.readFile = () => read.promise;
  const old = workspace.enqueue(file);
  if (action === 'delete') deleted.fire(file); else await workspace.reindex();
  read.resolve(Buffer.from('void obsolete(void){}'));
  await old; await workspace.derive();
  assert.equal(workspace.index.files.has(file.toString()), false);
  assert.equal(parsed.length, 0, 'discarded reads must never reach the real Worker');
});

test('Worker termination during disk IO settles the pending file analysis', async t => {
  const { workspace, adapter } = fixture(t);
  await workspace.ready;
  const read = deferred(); adapter.fs.readFile = () => read.promise;
  const job = workspace.enqueue(uri('pending.c'));
  await workspace.worker.terminate();
  read.resolve(Buffer.from('void pending(void){}'));
  await bounded(job);
  assert.equal(workspace.requests.size, 0);
  assert.match(workspace.status, /Analysis unavailable/);
});

test('a persistent Worker version mismatch is reported instead of Index ready', async t => {
  const { workspace } = fixture(t);
  await workspace.ready;
  const request = workspace.request;
  workspace.request = function (message) {
    return message.type === 'derive' ? { promise: Promise.resolve({ stale: true }) } : request.call(this, message);
  };
  workspace.revision++;
  await workspace.derive();
  assert.equal(workspace.failures.has('derived'), true);
  assert.match(workspace.status, /Partial index: call analysis failed/);
  await bounded(workspace.whenIdle());
  workspace.request = request;
  await workspace.reindex(); await bounded(workspace.whenIdle());
  assert.equal(workspace.failures.has('derived'), false);
  assert.equal(workspace.status, 'Index ready');
});

test('watcher events respect the file limit while existing files can update and deletion frees capacity', async t => {
  const files = Array.from({ length: 10001 }, (_, n) => uri(`f${n}.h`));
  const { workspace, adapter, created, changed, deleted } = fixture(t, files);
  await workspace.ready;
  assert.equal(workspace.index.files.size, 10000);
  const extra = uri('extra.h');
  created.fire(extra); changed.fire(files[10000]); await bounded(workspace.whenIdle());
  assert.equal(workspace.index.files.size, 10000);
  assert.equal(workspace.index.files.has(extra.toString()), false);
  assert.match(workspace.status, /10,000 file limit/);
  // Finish a current edit while the last watcher event is still debounced.
  const timer = setTimeout(() => {}, 10000);
  workspace.timers.set(extra.toString(), timer);
  adapter.fs.readFile = async () => Buffer.from(latest);
  await workspace.enqueue(files[0]);
  clearTimeout(timer); workspace.timers.delete(extra.toString());
  await workspace.enqueue(extra);
  const task = workspace.index.symbols().find(symbol => symbol.name === 'task');
  assert.ok(workspace.index.relations(task.id, 'callees').some(group => group.name === 'new_target'), 'a rejected final event must still finish the pending callback analysis');
  adapter.fs.readFile = async () => Buffer.from('void updated(void){}');
  changed.fire(files[0]); await bounded(workspace.whenIdle());
  assert.ok(workspace.index.symbols().some(symbol => symbol.name === 'updated'));
  deleted.fire(files[0]); created.fire(extra); await bounded(workspace.whenIdle());
  assert.equal(workspace.index.files.size, 10000);
  assert.equal(workspace.index.files.has(extra.toString()), true);
  adapter.findFiles = async () => [];
  await workspace.reindex();
  created.fire(uri('after-rebuild.c')); await bounded(workspace.whenIdle());
  assert.equal(workspace.index.files.size, 1);
  assert.equal(workspace.status, 'Index ready');
});

test('in-flight new files reserve capacity and a failed read frees its slot', async t => {
  const files = Array.from({ length: 9999 }, (_, n) => uri(`f${n}.h`));
  const { workspace, adapter } = fixture(t, files);
  await workspace.ready;
  const read = deferred(), reads = [];
  adapter.fs.readFile = file => { reads.push(file.toString()); return read.promise; };
  const first = uri('first.h'), second = uri('second.h');
  const one = workspace.enqueue(first), two = workspace.enqueue(second);
  // A buffered update supersedes the pending read but keeps that file's slot.
  adapter.textDocuments = [{ uri: first, isClosed: false, getText: () => latest }];
  await workspace.enqueue(first);
  await workspace.enqueue(second);
  assert.equal(reads.length, 1, 'pending IO counts toward the file limit');
  read.reject(new Error('Stale read failed')); await Promise.all([one, two]);
  await workspace.enqueue(second);
  assert.equal(reads.length, 1, 'a superseded failure cannot free a newer file slot');
  workspace.remove(first);
  const failed = workspace.enqueue(second);
  await failed;
  assert.equal(workspace.index.files.size, 9999, 'a current failed read frees its slot');
  adapter.fs.readFile = async () => Buffer.from('void recovered(void){}');
  await workspace.enqueue(second); await bounded(workspace.whenIdle());
  assert.equal(workspace.index.files.size, 10000);
  assert.ok(workspace.index.symbols().some(symbol => symbol.name === 'recovered'));
});
