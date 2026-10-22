import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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
function fixture(t, files = [], options = {}) {
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
    fs: { readFile: async file => Buffer.from(options.sources?.get(file.toString()) ?? '') }
  };
  const vscode = { EventEmitter: Emitter, Uri, RelativePattern: class {}, env: {}, version: 'test', workspace: adapter };
  const module = { exports: {} };
  runInNewContext(bundle, { module, exports: module.exports, process, Buffer, URL, setTimeout, clearTimeout, require: name => name === 'vscode' ? vscode : require(name) });
  const workspace = new module.exports.WorkspaceIndex(options.extensionPath ?? process.cwd(), options.storage);
  t.after(async () => { const worker = workspace.worker; workspace.dispose(); await worker.terminate(); });
  return { workspace, adapter, created, changed, deleted, closed, edited, configuration, folders };
}

test('disk cache restores unchanged startup without parses or relationship passes; one edit reparses one file', async t => {
  const storage = await mkdtemp(path.join(os.tmpdir(), 'dynsight-workspace-cache-'));
  t.after(() => rm(storage, { recursive: true, force: true }));
  const files = ['cached.c', 'other.c'].map(uri);
  const sources = new Map([[files[0].toString(), latest], [files[1].toString(), 'void other(void){}']]);
  const first = fixture(t, files, { storage, sources }).workspace;
  await first.ready; await bounded(first.whenIdle());
  first.dispose();
  const { workspace, changed } = fixture(t, files, { storage, sources });
  await workspace.ready; await bounded(workspace.whenIdle());
  assert.equal(workspace.diagnostics.index.sourceParses, 0);
  assert.equal(workspace.diagnostics.index.relationPasses, 0);
  assert.equal(workspace.diagnostics.index.rebuildCount, 0);
  assert.equal(workspace.index.files.size, 2);
  sources.set(files[0].toString(), latest.replaceAll('new_target', 'next_target'));
  changed.fire(files[0]); await bounded(workspace.whenIdle());
  assert.equal(workspace.diagnostics.index.sourceParses, 1);
  const task = workspace.index.symbols().find(symbol => symbol.name === 'task');
  assert.ok(workspace.index.relations(task.id, 'callees').some(group => group.name === 'next_target'));
});

test('cache startup validates content, additions and removals made while the editor was closed', async t => {
  const storage = await mkdtemp(path.join(os.tmpdir(), 'dynsight-offline-cache-'));
  t.after(() => rm(storage, { recursive: true, force: true }));
  const files = ['cached.c', 'removed.c'].map(uri);
  const sources = new Map([[files[0].toString(), latest], [files[1].toString(), 'void removed(void){}']]);
  const first = fixture(t, files, { storage, sources }).workspace;
  await first.ready; await bounded(first.whenIdle()); first.dispose();
  sources.set(files[0].toString(), latest.replaceAll('new_target', 'old_target'));
  const added = uri('added.c'); sources.set(added.toString(), 'void added(void){}');
  const { workspace } = fixture(t, [files[0], added], { storage, sources });
  await workspace.ready; await bounded(workspace.whenIdle());
  assert.equal(workspace.diagnostics.index.sourceParses, 2);
  assert.equal(workspace.index.files.has(files[1].toString()), false);
  const task = workspace.index.symbols().find(symbol => symbol.name === 'task');
  assert.ok(workspace.index.relations(task.id, 'callees').some(group => group.name === 'old_target'));
});

const latest = 'typedef void(*CB)(void);void new_target(void){}void task(void){CB cb=new_target;cb();}';
test('Stop reaches a busy Worker, keeps partial targets, and Retry reuses parsed sources', async t => {
  const file = uri('stop.c');
  const source = 'typedef void(*CB)(void);void target(void){}static CB cb=target;void run(void){cb();}void busy(void){int i=0;' + 'i++;'.repeat(20000) + '}';
  const { workspace } = fixture(t, [file], { sources: new Map([[file.toString(), source]]) });
  let stopped = false;
  const listener = workspace.diagnosticsChanged.event(() => {
    const analysis = workspace.diagnostics.index.callbackAnalysis;
    if (!stopped && analysis.running && analysis.progress?.symbol === 'busy') { stopped = true; workspace.stopAnalysis(); }
  });
  t.after(() => listener.dispose());
  await workspace.ready; await bounded(workspace.whenIdle());
  assert.equal(stopped, true);
  assert.match(workspace.status, /^Partial index: local analysis paused/);
  assert.equal(workspace.stable, false);
  assert.equal(workspace.copilotWaitReason, 'analysis-paused');
  const partial = workspace.index.callbackAt(file.toString(), source.indexOf('cb();') + 1);
  assert.deepEqual(Array.from(partial.targets, target => target.name), ['target']);
  assert.equal(partial.incomplete, true);
  assert.ok(workspace.index.files.get(file.toString()).callbackDiagnostics.some(detail => detail.kind === 'cancelled'));
  const parses = workspace.diagnostics.index.sourceParses;
  await bounded(workspace.resumeAnalysis()); await bounded(workspace.whenIdle());
  assert.equal(workspace.diagnostics.index.sourceParses, parses);
  assert.equal(workspace.status, 'Index ready');
  assert.equal(workspace.stable, true);
  assert.equal(workspace.index.callbackAt(file.toString(), source.indexOf('cb();') + 1).incomplete, false);
});

test('startup migrates fixed-deadline derived cache without reparsing unchanged sources', async t => {
  const storage = await mkdtemp(path.join(os.tmpdir(), 'dynsight-manual-stop-cache-'));
  t.after(() => rm(storage, { recursive: true, force: true }));
  const file = uri('cached.c'), sources = new Map([[file.toString(), latest]]);
  const first = fixture(t, [file], { storage, sources }).workspace;
  await first.ready; await bounded(first.whenIdle()); first.dispose();
  const filename = path.join(storage, 'analysis-cache', 'manifest.json');
  const manifest = JSON.parse(await readFile(filename, 'utf8')); delete manifest.callbackPolicy;
  await writeFile(filename, JSON.stringify(manifest));
  const { workspace } = fixture(t, [file], { storage, sources });
  await workspace.ready; await bounded(workspace.whenIdle());
  assert.equal(workspace.diagnostics.index.sourceParses, 0);
  assert.equal(workspace.diagnostics.index.relationPasses, 1);
  assert.equal(workspace.status, 'Index ready');
});

test('Stop reaches registration postprocessing in the Worker and Retry completes the missing facts', async t => {
  const file = uri('stop-registrations.c'), count = 5000;
  const source = 'typedef void(*CB)(void);void target(void){}static CB cb;void setup(void){' + 'cb=target;'.repeat(count) + '}void run(void){cb();}';
  const { workspace } = fixture(t, [file], { sources: new Map([[file.toString(), source]]) });
  let stopped = false;
  const listener = workspace.diagnosticsChanged.event(() => {
    const analysis = workspace.diagnostics.index.callbackAnalysis;
    if (!stopped && analysis.running && analysis.progress?.stage === 'registrations' && analysis.progress.symbol === 'setup') {
      stopped = true; workspace.stopAnalysis();
    }
  });
  t.after(() => listener.dispose());
  await workspace.ready; await bounded(workspace.whenIdle());
  assert.equal(stopped, true);
  assert.match(workspace.status, /^Partial index: local analysis paused/);
  const partial = workspace.index.files.get(file.toString());
  assert.ok(partial.callbackDiagnostics.some(detail => detail.kind === 'cancelled' && detail.stage === 'registrations'));
  assert.ok((partial.callbackRegistrations?.length ?? 0) < count);
  assert.ok(partial.references.some(ref => ref.name === 'target' && ref.callKind === 'inferred'));
  const parses = workspace.diagnostics.index.sourceParses;
  await bounded(workspace.resumeAnalysis()); await bounded(workspace.whenIdle());
  assert.equal(workspace.diagnostics.index.sourceParses, parses);
  assert.equal(workspace.status, 'Index ready');
  assert.equal(workspace.index.files.get(file.toString()).callbackRegistrations.length, count);
});

test('an unchanged source notification cannot cancel a running relationship pass', async t => {
  const file = uri('duplicate.c');
  const { workspace } = fixture(t, [file], { sources: new Map([[file.toString(), latest]]) });
  await workspace.ready;
  const cancellation = new Int32Array(new SharedArrayBuffer(4));
  workspace.activeAnalysis = { id: -1, cancellation };
  await workspace.analyze(file);
  assert.equal(Atomics.load(cancellation, 0), 0);
  workspace.activeAnalysis = undefined;
});

test('Copilot readiness identifies blockers without blocking stable partial results', async t => {
  const { workspace, adapter } = fixture(t);
  await workspace.ready; await bounded(workspace.whenIdle());
  assert.equal(workspace.copilotWaitReason, undefined);
  adapter.textDocuments = [{ uri: uri('dirty.c'), isClosed: false, isDirty: true }];
  assert.equal(workspace.copilotWaitReason, 'unsaved-sources');
  adapter.textDocuments[0].isDirty = false;
  workspace.indexing = true; assert.equal(workspace.copilotWaitReason, 'indexing'); workspace.indexing = false;
  workspace.jobs.add('pending'); assert.equal(workspace.copilotWaitReason, 'source-update'); workspace.jobs.clear();
  workspace.derivedRevision--;
  assert.equal(workspace.copilotWaitReason, 'relations'); workspace.derivedRevision = workspace.revision;
  workspace.failures.set('derived', 'failed'); assert.equal(workspace.copilotWaitReason, 'analysis-failed'); workspace.failures.clear();
  workspace.workerError = new Error('stopped'); assert.equal(workspace.copilotWaitReason, 'worker-unavailable'); workspace.workerError = undefined;
  workspace.cacheBlocked = true; assert.equal(workspace.copilotWaitReason, 'cache-rebuild-required'); workspace.cacheBlocked = false;
  assert.equal(workspace.copilotWaitReason, undefined);
});
test('Copilot waiting diagnostics reflect a Worker failure after the wait began', async t => {
  const { workspace, adapter } = fixture(t);
  await workspace.ready;
  adapter.textDocuments = [{ uri: uri('dirty.c'), isClosed: false, isDirty: true }];
  workspace.copilotDiagnostics = { state: 'waiting-for-saved-index', waitReason: 'unsaved-sources',
    requests: 0, cacheHits: 0, remaining: 0, failures: 0, candidates: 0, notFound: 0, contextLimited: 0 };
  assert.equal(workspace.diagnostics.copilot.waitReason, 'unsaved-sources');
  await workspace.worker.terminate();
  assert.ok(workspace.workerError);
  assert.equal(workspace.copilotWaitReason, 'worker-unavailable');
  assert.equal(workspace.diagnostics.copilot.waitReason, 'worker-unavailable');
});

test('a Worker failure raised while dispatching derive retains the fatal status', async t => {
  const { workspace } = fixture(t);
  await workspace.ready;
  const original = workspace.request, worker = workspace.worker;
  let injected = false;
  workspace.request = function(message) {
    const request = original.call(this, message);
    if (message.type === 'derive' && !injected) {
      injected = true;
      worker.emit('error', Object.assign(new Error('Worker ran out of memory'), { code: 'ERR_WORKER_OUT_OF_MEMORY' }));
      void worker.terminate();
    }
    return request;
  };
  await workspace.reindex();
  assert.equal(injected, true);
  assert.match(workspace.status, /memory/i);
  assert.ok(workspace.failures.has('worker'));
});

test('saving an already indexed dirty buffer clears the Copilot blocker without changing generation', async t => {
  const file = uri('save.c'), { workspace, adapter, edited } = fixture(t, [file]);
  await workspace.ready;
  const document = { uri: file, isClosed: false, isDirty: true, getText: () => 'void updated(void) {}' };
  adapter.textDocuments = [document];
  edited.fire({ document, contentChanges: [{}] });
  await bounded(workspace.whenIdle());
  assert.equal(workspace.stable, true);
  assert.equal(workspace.copilotWaitReason, 'unsaved-sources');
  const generation = workspace.generation;
  document.isDirty = false;
  workspace.schedule(file, 'editor-save');
  await bounded(workspace.whenIdle());
  assert.equal(workspace.generation, generation);
  assert.equal(workspace.copilotWaitReason, undefined);
});

test('analysis limits report a partial index while ordinary syntax notices retain ready status', async t => {
  const { workspace } = fixture(t);
  await workspace.ready;
  const file = uri('partial.c');
  await workspace.enqueue(file); await workspace.derive();
  const analysis = workspace.index.files.get(file.toString());
  for (const issue of ['Macro include traversal limit reached; call relationships may be incomplete',
    'Callback region limit: 256 reachable objects; targets may be incomplete',
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

test('configuration reconciles files without a full rebuild and manual rebuild history stays bounded', async t => {
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
  assert.equal(data.rebuildCount, 1);
  folders.fire({}); await bounded(workspace.whenIdle());
  assert.equal(workspace.diagnostics.index.rebuildCount, 1);
  await workspace.reindex('toolbar');
  assert.equal(workspace.diagnostics.index.rebuilds.at(-1).reason, 'toolbar');
  for (let i = 0; i < 4; i++) await workspace.reindex();
  data = workspace.diagnostics.index;
  assert.equal(data.rebuildCount, 6);
  assert.equal(data.rebuilds.length, 5);
  assert.equal(data.rebuilds.at(-1).reason, 'command');
  assert.equal(data.sessionStartedAt, workspace.diagnostics.index.sessionStartedAt);
});

test('damaged manifest waits for explicit Rebuild and does not silently analyze', async t => {
  const storage = await mkdtemp(path.join(os.tmpdir(), 'dynsight-damaged-cache-'));
  t.after(() => rm(storage, { recursive: true, force: true }));
  const files = [uri('cached.c')], sources = new Map([[files[0].toString(), latest]]);
  const first = fixture(t, files, { storage, sources }).workspace;
  await first.ready; await bounded(first.whenIdle()); first.dispose();
  await writeFile(path.join(storage, 'analysis-cache', 'manifest.json'), 'damaged');
  const { workspace, changed } = fixture(t, files, { storage, sources });
  await workspace.ready;
  assert.equal(workspace.diagnostics.index.cache.state, 'invalid');
  assert.match(workspace.status, /damaged/);
  assert.match(workspace.status, /Rebuild Index/);
  changed.fire(files[0]); await bounded(workspace.whenIdle());
  assert.equal(workspace.diagnostics.index.sourceParses, 0);
  await workspace.reindex(); await bounded(workspace.whenIdle());
  assert.equal(workspace.status, 'Index ready');
  assert.equal(workspace.index.files.size, 1);
});

test('extension version changes reuse compatible disk analysis and the AI settings key', async t => {
  const storage = await mkdtemp(path.join(os.tmpdir(), 'dynsight-compatible-update-'));
  t.after(() => rm(storage, { recursive: true, force: true }));
  const files = [uri('cached.c')], sources = new Map([[files[0].toString(), latest]]);
  const first = fixture(t, files, { storage, sources }).workspace;
  await first.ready; await bounded(first.whenIdle());
  const key = first.analysisKey; first.dispose();
  // Use the real built Worker with an independent package manifest to simulate
  // an installed extension update, without changing the checkout's version.
  const extensionPath = path.join(storage, 'updated-extension');
  const { mkdir, symlink } = await import('node:fs/promises');
  await mkdir(extensionPath);
  await symlink(path.join(process.cwd(), 'dist'), path.join(extensionPath, 'dist'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(path.join(extensionPath, 'package.json'), JSON.stringify({ version: '999.0.0' }));
  const next = fixture(t, files, { storage, sources, extensionPath }).workspace;
  await next.ready; await bounded(next.whenIdle());
  assert.equal(next.analysisKey, key);
  assert.equal(next.diagnostics.index.cache.state, 'restored');
  assert.equal(next.diagnostics.index.sourceParses, 0);
  assert.equal(next.diagnostics.index.relationPasses, 0);
  assert.equal(next.diagnostics.index.rebuildCount, 0);
  assert.equal(next.index.files.size, 1);
});

for (const reason of ['analysis-version', 'workspace-settings', 'legacy-format']) test(`startup distinguishes ${reason} from damaged data and rebuild recovers`, async t => {
  const storage = await mkdtemp(path.join(os.tmpdir(), 'dynsight-incompatible-cache-'));
  t.after(() => rm(storage, { recursive: true, force: true }));
  const files = [uri('cached.c')], sources = new Map([[files[0].toString(), latest]]);
  const first = fixture(t, files, { storage, sources }).workspace;
  await first.ready; await bounded(first.whenIdle()); first.dispose();
  const filename = path.join(storage, 'analysis-cache', 'manifest.json');
  const manifest = JSON.parse(await readFile(filename, 'utf8'));
  if (reason === 'analysis-version') manifest.analysisVersion++;
  if (reason === 'workspace-settings') manifest.key = 'other-settings';
  if (reason === 'legacy-format') { manifest.schema = 1; delete manifest.analysisVersion; }
  await writeFile(filename, JSON.stringify(manifest));
  const next = fixture(t, files, { storage, sources }).workspace;
  await next.ready;
  assert.equal(next.diagnostics.index.cache.state, 'incompatible');
  assert.equal(next.diagnostics.index.cache.reason, reason);
  assert.doesNotMatch(next.status, /damaged/);
  assert.match(next.status, /Rebuild Index/);
  assert.match(next.status, reason === 'analysis-version' ? /analysis version changed/ : reason === 'workspace-settings' ? /settings changed/ : /cache format/);
  assert.equal(next.diagnostics.index.sourceParses, 0);
  assert.equal(next.copilotWaitReason, 'cache-rebuild-required');
  await next.reindex(); await bounded(next.whenIdle());
  assert.equal(next.status, 'Index ready');
  assert.equal(next.diagnostics.index.cache.reason, undefined);
  next.dispose();
  const reopened = fixture(t, files, { storage, sources }).workspace;
  await reopened.ready; await bounded(reopened.whenIdle());
  assert.equal(reopened.diagnostics.index.cache.state, 'restored');
  assert.equal(reopened.diagnostics.index.sourceParses, 0);
});

test('dirty editor overlays cannot replace the persisted saved generation', async t => {
  const storage = await mkdtemp(path.join(os.tmpdir(), 'dynsight-dirty-cache-'));
  t.after(() => rm(storage, { recursive: true, force: true }));
  const file = uri('cached.c'), sources = new Map([[file.toString(), latest]]);
  const first = fixture(t, [file], { storage, sources });
  await first.workspace.ready; await bounded(first.workspace.whenIdle());
  const document = { uri: file, isClosed: false, isDirty: true, getText: () => latest.replaceAll('new_target', 'unsaved_target') };
  first.adapter.textDocuments = [document]; first.edited.fire({ document, contentChanges: [{}] });
  await bounded(first.workspace.whenIdle()); first.workspace.dispose();
  const second = fixture(t, [file], { storage, sources }).workspace;
  await second.ready; await bounded(second.whenIdle());
  assert.equal(second.diagnostics.index.sourceParses, 0);
  assert.ok(second.index.symbols().some(s => s.name === 'new_target'));
  assert.equal(second.index.symbols().some(s => s.name === 'unsaved_target'), false);
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
  const pending = deferred(), entered = deferred(); let first = true;
  adapter.findFiles = () => first ? (first = false, entered.resolve(), pending.promise) : Promise.resolve([]);
  const previous = workspace.reindex('toolbar');
  assert.equal(workspace.diagnostics.index.rebuilds.at(-1).outcome, 'running');
  await bounded(entered.promise);
  await bounded(workspace.reindex('configuration', ['exclude']));
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
  const search = deferred(), entered = deferred(); let first = true;
  adapter.findFiles = async () => first ? (first = false, entered.resolve(), search.promise) : [uri('current.c')];
  const old = workspace.reindex();
  await bounded(entered.promise);
  await bounded(workspace.reindex());
  search.resolve([uri('obsolete.c')]); await old;
  const records = workspace.diagnostics.index.rebuilds;
  assert.equal(records.at(-2).outcome, 'superseded');
  assert.equal(records.at(-2).files.indexed, undefined);
  assert.equal(records.at(-1).files.indexed, 1);
});

test('callback setting changes reuse source facts and discard in-flight results from the old mode', async t => {
  const { workspace, adapter, configuration } = fixture(t);
  await workspace.ready;
  const file = uri('callbacks.c');
  adapter.fs.readFile = async () => Buffer.from(latest);
  await workspace.enqueue(file); await workspace.derive();
  const parses = workspace.diagnostics.index.sourceParses;
  const task = workspace.index.symbols().find(s => s.name === 'task');
  const targetKind = () => workspace.index.relations(task.id, 'callees').find(g => g.name === 'new_target')?.callKind;
  assert.equal(targetKind(), 'inferred');
  let enabled = false;
  adapter.getConfiguration = () => ({ get: (key, fallback) => key === 'analyzeCallbacks' ? enabled : fallback });
  const event = { affectsConfiguration: key => key === 'dynsight.analyzeCallbacks' };
  configuration.fire(event); await bounded(workspace.whenIdle());
  assert.equal(targetKind(), 'registered', 'simple assignments remain available with full analysis disabled');
  assert.equal(workspace.diagnostics.index.sourceParses, parses);
  const request = workspace.request, held = deferred(), entered = deferred();
  workspace.request = function (message) {
    const result = request.call(this, message);
    if (message.type === 'derive' && message.analyzeCallbacks === true) {
      entered.resolve(); return { ...result, promise: result.promise.then(async value => { await held.promise; return value; }) };
    }
    return result;
  };
  enabled = true; configuration.fire(event); await bounded(entered.promise);
  enabled = false; configuration.fire(event); held.resolve();
  await bounded(workspace.whenIdle());
  assert.equal(targetKind(), 'registered', 'an obsolete enabled result must never replace disabled relationships');
  workspace.request = request;
  enabled = true; configuration.fire(event); await bounded(workspace.whenIdle());
  assert.equal(targetKind(), 'inferred');
  assert.equal(workspace.diagnostics.index.sourceParses, parses);
});

test('Worker transfers located callback diagnostics and clears them when callback analysis is disabled', async t => {
  const {workspace,adapter,configuration}=fixture(t);
  await workspace.ready;
  const file=uri('limits.c');
  adapter.fs.readFile=async()=>Buffer.from('typedef void(*CB)(void);void target(void){}CB data[300];void update(void){'+
    Array.from({length:270},(_,n)=>`data[${n}]=target;`).join('')+'}void run(void){CB cb=target;cb();}');
  await workspace.enqueue(file);await workspace.derive();
  const analysis=workspace.index.files.get(file.toString());
  assert.equal(analysis.callbackDiagnostics.find(d=>d.kind==='mutation').symbol,'update');
  assert.equal(analysis.programs,undefined,'flow programs remain Worker-only');
  assert.match(workspace.status,/Partial index: analysis limits/);
  adapter.getConfiguration=()=>({get:(key,fallback)=>key==='analyzeCallbacks'?false:fallback});
  configuration.fire({affectsConfiguration:key=>key==='dynsight.analyzeCallbacks'});
  await bounded(workspace.whenIdle());
  assert.equal(workspace.index.files.get(file.toString()).callbackDiagnostics,undefined);
  assert.equal(workspace.status,'Index ready');
});

test('standard integer fields, byte writes and memcpy do not make the Worker index partial', async t => {
  const {workspace,adapter}=fixture(t);
  await workspace.ready;
  const file=uri('codec.c');
  const fields=Array.from({length:270},(_,n)=>`uint32_t status${n};`).join('');
  const writes=Array.from({length:270},(_,n)=>`data.status${n}=0;dst[${n}]=0;`).join('');
  adapter.fs.readFile=async()=>Buffer.from(`typedef unsigned int uint32_t;typedef void(*CB)(void);void target(void){}
    struct Data{${fields}};static struct Data data;struct Ops{CB cb;};static struct Ops source={target},destination;
    void *memcpy(void*,const void*,unsigned long);static unsigned char bytes[270];
    void pack(unsigned char*dst){${writes}memcpy(&destination,&source,sizeof(source));}
    void run(void){pack(bytes);source.cb();}`);
  await workspace.enqueue(file);await workspace.derive();
  const analysis=workspace.index.files.get(file.toString());
  assert.equal(analysis.callbackDiagnostics,undefined);
  assert.equal(workspace.status,'Index ready');
  const run=workspace.index.symbols().find(symbol=>symbol.name==='run'&&symbol.kind==='function');
  const target=workspace.index.relations(run.id,'callees').find(group=>group.name==='target'&&group.callKind==='inferred');
  assert.ok(target?.sites.every(site=>!site.inference.incomplete));
});

test('offset packing, corrected callback addresses and GNU declarations survive the Worker boundary', async t => {
  const {workspace,adapter}=fixture(t);
  await workspace.ready;
  const file=uri('offset-codec.c');
  const writes=Array.from({length:400},(_,n)=>`regs[${n}]=${n};`).join('');
  const source=`typedef void(*CB)(void);void first(void){}void second(void){}static CB table[3]={first,first,first};
    struct Config{unsigned value;};static struct Config config __attribute__((section(".os_data_nc")));
    static unsigned short buffer[2048];static void pack(unsigned short*regs){${writes}}
    static void set(CB*p){p[1]=second;}
    void run(unsigned offset){pack(&buffer[offset]);pack(&buffer[0]);set(&table[1]);table[2]();}`;
  adapter.fs.readFile=async()=>Buffer.from(source);
  await workspace.enqueue(file);await workspace.derive();
  const analysis=workspace.index.files.get(file.toString());
  assert.deepEqual(analysis.issues,[]);
  assert.equal(analysis.callbackDiagnostics,undefined);
  assert.equal(workspace.status,'Index ready');
  assert.equal(analysis.text,source);
  const run=workspace.index.symbols().find(symbol=>symbol.name==='run'&&symbol.kind==='function');
  const inferred=workspace.index.relations(run.id,'callees').filter(group=>group.callKind==='inferred');
  assert.deepEqual(Array.from(inferred,group=>group.name),['second']);
  assert.ok(inferred.every(group=>group.sites.every(site=>!site.inference.incomplete)));
});

test('a superseded rebuild waiting on save cannot erase a newer reconciliation', async t => {
  const firstFile=uri('first.c'), nextFile=uri('next.c');
  const {workspace,adapter,configuration}=fixture(t,[firstFile]);
  await workspace.ready;
  const saving=deferred(); workspace.saving=saving.promise;
  const stale=workspace.reindex();
  adapter.findFiles=async()=>[nextFile];
  configuration.fire({affectsConfiguration:key=>key==='dynsight.include'});
  const current=workspace.reconciling;
  for(let i=0;i<100 && !workspace.index.files.has(nextFile.toString());i++) await new Promise(r=>setTimeout(r,2));
  assert.equal(workspace.index.files.has(nextFile.toString()),true,'new reconciliation reached source acceptance');
  workspace.saving=undefined; saving.resolve();
  await stale; await current; await bounded(workspace.whenIdle());
  assert.equal(workspace.index.files.has(nextFile.toString()),true,'superseded rebuild must not clear newer source');
});

test('scope reconciliation removes failures belonging to newly excluded files',async t=>{
 const bad=uri('bad.c'),good=uri('good.c');
 const sources=new Map([[bad.toString(),' '.repeat(2_000_001)],[good.toString(),'void good(void){}']]);
 const {workspace,adapter,configuration}=fixture(t,[bad,good],{sources});
 await workspace.ready;
 assert.equal(workspace.failures.has(bad.toString()),true);
 adapter.getConfiguration=()=>({get:(key,fallback)=>key==='include'?['good.c']:fallback});
 adapter.findFiles=async()=>[good];
 configuration.fire({affectsConfiguration:key=>key==='dynsight.include'});
 await bounded(workspace.whenIdle());
 assert.equal(workspace.failures.has(bad.toString()),false);
 assert.equal(workspace.status,'Index ready');
});

test('a delete during disk-cache validation must not enqueue the now absent source as a failure',async t=>{
 const storage=await mkdtemp(path.join(os.tmpdir(),'dynsight-delete-review-'));
 t.after(()=>rm(storage,{recursive:true,force:true}));
 const file=uri('deleted.c'),sources=new Map([[file.toString(),'void target(void){}']]);
 const initial=fixture(t,[file],{storage,sources}).workspace;
 await initial.ready;await bounded(initial.whenIdle());initial.dispose();
 const {workspace,adapter,deleted}=fixture(t,[file],{storage,sources});
 const read=deferred(),entered=deferred();let reads=0;
 adapter.fs.readFile=()=>{ if(reads++===0){entered.resolve();return read.promise;} throw new Error('ENOENT'); };
 await bounded(entered.promise);
 adapter.findFiles=async()=>[];deleted.fire(file);read.resolve(Buffer.from(sources.get(file.toString())));
 await workspace.ready;await bounded(workspace.whenIdle());
 assert.equal(workspace.index.files.size,0);
 assert.equal(workspace.failures.size,0,'deleted file must not become a read failure');
 assert.equal(workspace.status,'Index ready');
});

test('failed scope discovery cannot later report excluded old source as a ready current index',async t=>{
 const first=uri('old.c'),next=uri('new.c');
 const sources=new Map([[first.toString(),'void old_function(void){}'],[next.toString(),'void new_function(void){}']]);
 const {workspace,adapter,configuration,changed}=fixture(t,[first,next],{sources});
 await workspace.ready;
 adapter.getConfiguration=()=>({get:(key,fallback)=>key==='include'?['new.c']:fallback});
 adapter.findFiles=async()=>{throw new Error('discovery unavailable');};
 configuration.fire({affectsConfiguration:key=>key==='dynsight.include'});
 await workspace.reconciling;
 assert.match(workspace.status,/Index error/);
 sources.set(next.toString(),'void changed_function(void){}');changed.fire(next);await bounded(workspace.whenIdle());
 assert.equal(workspace.index.files.has(first.toString()) && workspace.status==='Index ready',false,
  'excluded source must not silently remain in a current index after failed scope change');
});
