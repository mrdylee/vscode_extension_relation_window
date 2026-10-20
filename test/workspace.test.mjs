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
  const created = new Emitter(), changed = new Emitter(), deleted = new Emitter(), closed = new Emitter(), edited = new Emitter();
  const configuration = new Emitter(), folders = new Emitter();
  const adapter = {
    workspaceFolders: [folder], textDocuments: [],
    getConfiguration: () => ({ get: (_key, fallback) => fallback }),
    getWorkspaceFolder: () => folder, asRelativePath: value => value.path.slice('/review/'.length),
    findFiles: async () => files,
    createFileSystemWatcher: () => ({ dispose() {}, onDidCreate: created.event, onDidChange: changed.event, onDidDelete: deleted.event }),
    onDidChangeTextDocument: edited.event, onDidCloseTextDocument: closed.event,
    onDidChangeConfiguration: configuration.event, onDidChangeWorkspaceFolders: folders.event,
    fs: { readFile: async () => Buffer.from('') }
  };
  const vscode = { EventEmitter: Emitter, Uri, RelativePattern: class {}, env: {}, version: 'test', workspace: adapter };
  const module = { exports: {} };
  runInNewContext(bundle, { module, exports: module.exports, process, Buffer, URL, setTimeout, clearTimeout, require: name => name === 'vscode' ? vscode : require(name) });
  const workspace = new module.exports.WorkspaceIndex(process.cwd());
  t.after(async () => { const worker = workspace.worker; workspace.dispose(); await worker.terminate(); });
  return { workspace, adapter, created, changed, deleted, closed, edited, configuration, folders };
}

const latest = 'typedef void(*CB)(void);void new_target(void){}void task(void){CB cb=new_target;cb();}';
test('analysis limits report a partial index while ordinary syntax notices retain ready status', async t => {
  const { workspace } = fixture(t);
  await workspace.ready;
  const file = uri('partial.c');
  await workspace.enqueue(file); await workspace.derive();
  const analysis = workspace.index.files.get(file.toString());
  for (const issue of ['Macro include traversal limit reached; call relationships may be incomplete',
    'Callback propagation limit: 12 project passes; targets may be incomplete',
    'Callback analysis budget: 10 seconds; targets may be incomplete. Narrow Include/Exclude scope.']) {
    workspace.index.update({ ...analysis, issues: [issue] });
    assert.match(workspace.completedStatus(), /Partial index: analysis limits reached/);
  }
  workspace.index.update({ ...analysis, issues: ['Line 1: incomplete or unsupported C syntax'] });
  assert.equal(workspace.completedStatus(), 'Index ready');
});

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
  assert.equal(workspace.diagnostics.index.rebuilds[0].files.discoveryComplete, false,
    'a file-limit stop must not claim complete discovery');
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

test('unchanged closes and watcher notifications reuse completed call analysis', async t => {
  const { workspace, adapter, closed, changed } = fixture(t);
  await workspace.ready;
  const file = uri('unchanged.c');
  adapter.fs.readFile = async () => Buffer.from(latest);
  await workspace.enqueue(file); await bounded(workspace.whenIdle());
  const revision = workspace.revision, indexed = workspace.index.files.get(file.toString());
  const messages = [], request = workspace.request;
  workspace.request = function (message) { messages.push(message); return request.call(this, message); };
  for (let i = 0; i < 3; i++) {
    closed.fire({ uri: file, isClosed: true });
    await bounded(workspace.whenIdle());
  }
  changed.fire(file); await bounded(workspace.whenIdle());
  assert.equal(messages.length, 0, 'unchanged source must not parse or derive again');
  assert.equal(workspace.revision, revision);
  assert.equal(workspace.index.files.get(file.toString()), indexed, 'retain derived callback results');
  assert.equal(workspace.status, 'Index ready');
});

test('edits, discarded unsaved edits and external disk changes update callers', async t => {
  const { workspace, adapter, closed, edited, changed } = fixture(t);
  await workspace.ready;
  const file = uri('discard.c');
  const original = 'void disk_target(void){}void task(void){disk_target();}';
  let disk = original;
  adapter.fs.readFile = async () => Buffer.from(disk);
  await workspace.enqueue(file); await bounded(workspace.whenIdle());
  const document = { uri: file, isClosed: false, getText: () => latest };
  adapter.textDocuments = [document];
  edited.fire({ document, contentChanges: [{}] }); await bounded(workspace.whenIdle());
  const callees = () => workspace.index.relations(workspace.index.symbols().find(s => s.name === 'task').id, 'callees').map(g => g.name);
  assert.ok(callees().includes('new_target'));
  document.isClosed = true; adapter.textDocuments = [];
  closed.fire(document); await bounded(workspace.whenIdle());
  assert.ok(callees().includes('disk_target'));
  assert.equal(callees().includes('new_target'), false);
  disk = original.replaceAll('disk_target', 'external_target');
  changed.fire(file); await bounded(workspace.whenIdle());
  assert.ok(callees().includes('external_target'));
  assert.equal(workspace.status, 'Index ready');
});

test('returning to indexed text while a changed Worker response is pending restores raw input', async t => {
  const { workspace, adapter } = fixture(t);
  await workspace.ready;
  const file = uri('pending-revert.c');
  const original = 'void disk_target(void){}void task(void){disk_target();}';
  adapter.fs.readFile = async () => Buffer.from(original);
  await workspace.enqueue(file); await bounded(workspace.whenIdle());
  const request = workspace.request, parsed = deferred(), release = deferred();
  let delayed = false;
  workspace.request = function (message) {
    const result = request.call(this, message);
    if (message.uri && !delayed) {
      delayed = true;
      return { ...result, promise: result.promise.then(async value => { parsed.resolve(); await release.promise; return value; }) };
    }
    return result;
  };
  adapter.textDocuments = [{ uri: file, isClosed: false, getText: () => latest }];
  const old = workspace.enqueue(file); await bounded(parsed.promise);
  adapter.textDocuments = [];
  await workspace.enqueue(file);
  release.resolve(); await old; await bounded(workspace.whenIdle());
  // The host can look correct while the Worker still holds the superseded text.
  // An unrelated update must also derive successfully with the restored input.
  adapter.fs.readFile = async () => Buffer.from('void unrelated(void){}');
  await workspace.enqueue(uri('unrelated.c')); await bounded(workspace.whenIdle());
  assert.equal(workspace.index.files.get(file.toString()).text, original);
  assert.equal(workspace.status, 'Index ready');
  const task = workspace.index.symbols().find(s => s.name === 'task');
  assert.ok(workspace.index.relations(task.id, 'callees').some(g => g.name === 'disk_target'));
  assert.equal(workspace.failures.size, 0);
});

test('diagnostics distinguish startup, automatic and manual rebuilds with bounded history', async t => {
  const { workspace, configuration, folders } = fixture(t);
  await workspace.ready;
  assert.ok(workspace.diagnostics.index, 'rebuild diagnostics must be available without Worker errors');
  let data = workspace.diagnostics.index;
  assert.equal(data.rebuildCount, 1);
  assert.equal(data.rebuilds[0].reason, 'startup');
  assert.equal(data.rebuilds[0].outcome, 'completed');
  configuration.fire({ affectsConfiguration: key => key === 'dynsight.include' });
  await bounded(workspace.whenIdle());
  data = workspace.diagnostics.index;
  assert.equal(data.rebuilds.at(-1).reason, 'configuration');
  assert.deepEqual(Array.from(data.rebuilds.at(-1).settings), ['include']);
  folders.fire({}); await bounded(workspace.whenIdle());
  assert.equal(workspace.diagnostics.index.rebuilds.at(-1).reason, 'workspace-folders');
  await workspace.reindex('toolbar');
  assert.equal(workspace.diagnostics.index.rebuilds.at(-1).reason, 'toolbar');
  for (let i = 0; i < 4; i++) await workspace.reindex();
  data = workspace.diagnostics.index;
  assert.equal(data.rebuildCount, 8);
  assert.equal(data.rebuilds.length, 5);
  assert.equal(data.rebuilds.at(-1).reason, 'command');
  assert.equal(data.sessionStartedAt, workspace.diagnostics.index.sessionStartedAt);
});

test('unchanged document events do not increase source or relation counters; edits do', async t => {
  const { workspace, adapter, closed, edited } = fixture(t);
  await workspace.ready;
  const file = uri('navigation.c');
  let source = 'void original(void){}';
  adapter.fs.readFile = async () => Buffer.from(source);
  await workspace.enqueue(file); await bounded(workspace.whenIdle());
  assert.ok(workspace.diagnostics.index, 'index activity counters must be available');
  const initial = workspace.diagnostics.index;
  closed.fire({ uri: file }); await bounded(workspace.whenIdle());
  const unchanged = workspace.diagnostics.index;
  assert.equal(unchanged.sourceParses, initial.sourceParses);
  assert.equal(unchanged.relationPasses, initial.relationPasses);
  assert.equal(unchanged.rebuildCount, initial.rebuildCount);
  assert.equal(unchanged.lastSourceEvent.kind, 'editor-close');
  source = 'void changed(void){}';
  edited.fire({ document: { uri: file }, contentChanges: [{}] }); await bounded(workspace.whenIdle());
  const changed = workspace.diagnostics.index;
  assert.equal(changed.sourceParses, initial.sourceParses + 1);
  assert.equal(changed.relationPasses, initial.relationPasses + 1);
  assert.equal(changed.lastSourceEvent.kind, 'editor-change');
});

test('overlapping rebuilds keep a completed latest record and mark obsolete runs superseded', async t => {
  const { workspace, adapter } = fixture(t);
  await workspace.ready;
  const pending = deferred(); let first = true;
  adapter.findFiles = () => first ? (first = false, pending.promise) : Promise.resolve([]);
  const previous = workspace.reindex('toolbar');
  assert.equal(workspace.diagnostics.index.rebuilds.at(-1).outcome, 'running');
  await workspace.reindex('configuration', ['exclude']);
  pending.resolve([]); await previous;
  assert.equal(workspace.diagnostics.index.rebuilds.at(-2).outcome, 'superseded');
  assert.equal(workspace.diagnostics.index.rebuilds.at(-1).outcome, 'completed');
});

test('failed source discovery appears as a failed rebuild', async t => {
  const { workspace, adapter } = fixture(t);
  await workspace.ready;
  adapter.findFiles = async () => { throw new Error('offline filesystem'); };
  await workspace.reindex();
  assert.equal(workspace.diagnostics.index.rebuilds.at(-1).outcome, 'failed');
});

test('unexpected rebuild setup errors are recorded as failures', async t => {
  const { workspace } = fixture(t);
  await workspace.ready;
  const original = workspace.worker.postMessage;
  workspace.worker.postMessage = () => { throw new Error('worker unavailable'); };
  try { await assert.rejects(workspace.reindex(), /worker unavailable/); }
  finally { workspace.worker.postMessage = original; }
  assert.equal(workspace.diagnostics.index.rebuilds.at(-1).outcome, 'failed');
});

test('failed source reads and oversized files cannot report a complete index', async t => {
  const { workspace, adapter, changed } = fixture(t);
  await workspace.ready;
  const files = ['good.c', 'unreadable.h', 'oversized.h'].map(uri);
  adapter.findFiles = async () => files;
  adapter.fs.readFile = async file => {
    if (file.toString() === files[1].toString()) throw new Error('EACCES: read denied');
    return Buffer.from(file.toString() === files[2].toString() ? ' '.repeat(2_000_001) : 'void target(void){}');
  };
  await workspace.reindex();
  assert.equal(workspace.index.files.size, 1);
  assert.match(workspace.status, /Partial index: 2 file.*failed/);
  assert.equal(workspace.diagnostics.index.rebuilds.at(-1).outcome, 'partial');
  adapter.fs.readFile = async () => Buffer.from('');
  changed.fire(files[1]); changed.fire(files[2]);
  await bounded(workspace.whenIdle());
  assert.equal(workspace.index.files.size, 3);
  assert.equal(workspace.status, 'Index ready', 'recovered files clear the partial status');
});

test('rebuild file counts distinguish search results, filtering and failed analysis', async t => {
  const { workspace, adapter } = fixture(t);
  await workspace.ready;
  const files = ['good.c', 'bad.h', 'node_modules/ignored.h', 'readme.txt'].map(uri);
  adapter.findFiles = async () => [...files, files[0]];
  adapter.fs.readFile = async file => {
    if (file.toString() === files[1].toString()) throw new Error('EACCES');
    return Buffer.from('');
  };
  await workspace.reindex();
  const first = workspace.diagnostics.index.rebuilds.at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(first.files)), {
    searchResults: 5, selected: 2, discoveryComplete: true, indexed: 1, failed: 1, missing: 0
  });
  adapter.findFiles = async () => [files[0]];
  await workspace.reindex();
  const second = workspace.diagnostics.index.rebuilds.at(-1);
  assert.equal(second.files.searchResults, 1);
  assert.equal(second.files.selected, 1);
  assert.equal(second.files.indexed, 1);
  assert.equal(first.files.failed, 1, 'old rebuild counts must remain a snapshot');
  second.files.indexed = 99;
  assert.equal(workspace.diagnostics.index.rebuilds.at(-1).files.indexed, 1, 'diagnostic readers cannot mutate the record');
});

test('unfinished discovery and superseded rebuilds do not claim analyzed file counts', async t => {
  const { workspace, adapter } = fixture(t);
  await workspace.ready;
  adapter.findFiles = async () => { throw new Error('search unavailable'); };
  await workspace.reindex();
  assert.equal(workspace.diagnostics.index.rebuilds.at(-1).files.discoveryComplete, false);
  const search = deferred(); let first = true;
  adapter.findFiles = async () => first ? (first = false, search.promise) : [uri('current.c')];
  const old = workspace.reindex();
  await workspace.reindex();
  search.resolve([uri('obsolete.c')]); await old;
  const records = workspace.diagnostics.index.rebuilds;
  assert.equal(records.at(-2).outcome, 'superseded');
  assert.equal(records.at(-2).files.indexed, undefined);
  assert.equal(records.at(-1).files.indexed, 1);
});
