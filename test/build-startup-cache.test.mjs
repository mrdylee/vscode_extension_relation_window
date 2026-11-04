import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { Worker } from 'node:worker_threads';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const bundle = buildSync({ stdin: { contents: "export { WorkspaceIndex } from './src/workspace'; export { registerBuildConfigurations } from './src/build-service';", resolveDir: process.cwd() },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vscode', 'web-tree-sitter'] }).outputFiles[0].text;
const root = 'file:///startup';
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
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function gate() { return { entered: deferred(), released: deferred() }; }
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Startup operation did not settle')), 5000); })]); }
  finally { clearTimeout(timer); }
}
const source = 'void first(void){}\nvoid second(void){}\nvoid run(void){\n#if MODE==1\nfirst();\n#else\nsecond();\n#endif\n}\n';

async function scenario(t, options = {}) {
  const storage = await mkdtemp(path.join(os.tmpdir(), 'dynsight-build-startup-'));
  const files = new Map([[root + '/main.c', source], [root + '/makefile', 'all: main.o\n%.o: %.c\n\tgcc -DMODE=1 -c $< -o $@\n']]);
  const saved = new Map(), instances = [];
  const settings = new Map(options.unconfigured ? [] : [['smartAnalysis.include', ['**']]]);
  t.after(async () => { for (const item of instances) await item.close(); await rm(storage, { recursive: true, force: true }); });
  function open(overrides = {}) {
    const folder = { uri: Uri.parse(root), name: 'startup', index: 0 };
    const configuration = new Emitter(), folders = new Emitter(), sourceChanges = new Emitter();
    const commands = new Map(), messages = [], reads = [];
    let metadataWaited = false, discoveryWaited = false, discoveries = 0;
    const adapter = {
      workspaceFolders: [folder], textDocuments: [],
      getConfiguration: () => ({ get: (key, fallback) => settings.has(key) ? settings.get(key) : fallback,
        inspect: key => settings.has(key) ? { workspaceValue: settings.get(key) } : undefined }),
      getWorkspaceFolder: uri => adapter.workspaceFolders.find(item => uri.toString().startsWith(item.uri.toString() + '/')),
      asRelativePath: uri => uri.path.slice('/startup/'.length),
      findFiles: async () => {
        discoveries++;
        if (overrides.discoveryGate && !discoveryWaited) {
          discoveryWaited = true; overrides.discoveryGate.entered.resolve(); await overrides.discoveryGate.released.promise;
        }
        return [...files.keys()].filter(name => /\.[ch]$/i.test(name)).map(Uri.parse);
      },
      createFileSystemWatcher: () => ({ dispose() {}, onDidCreate: sourceChanges.event, onDidChange: sourceChanges.event, onDidDelete: () => disposable() }),
      onDidChangeTextDocument: () => disposable(), onDidCloseTextDocument: () => disposable(),
      onDidChangeConfiguration: configuration.event, onDidChangeWorkspaceFolders: folders.event,
      fs: {
        readFile: async uri => {
          const name = uri.toString(); reads.push(name);
          if (overrides.metadataGate && name === root + '/makefile' && !metadataWaited) {
            metadataWaited = true; overrides.metadataGate.entered.resolve(); await overrides.metadataGate.released.promise;
          }
          if (!files.has(name)) throw Object.assign(new Error('missing'), { code: 'FileNotFound' });
          return Buffer.from(files.get(name));
        },
        readDirectory: async uri => {
          if (options.hidePreferred && uri.toString() === root + '/preferred') return [];
          const prefix = uri.toString().replace(/\/$/, '') + '/', found = new Map();
          for (const name of files.keys()) if (name.startsWith(prefix)) {
            const rest = name.slice(prefix.length), slash = rest.indexOf('/');
            found.set(slash < 0 ? rest : rest.slice(0, slash), slash < 0 ? 1 : 2);
          }
          return [...found];
        }
      },
      openTextDocument: async () => ({})
    };
    const vscode = { EventEmitter: Emitter, Uri, RelativePattern: class {}, env: {}, version: 'test', FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
      workspace: adapter, window: { showQuickPick: async choices => choices.find(choice => choice.entry), showTextDocument: async () => {}, showErrorMessage: async () => {} },
      commands: { registerCommand: (name, callback) => { commands.set(name, callback); return disposable(); } } };
    class TracedWorker extends Worker {
      postMessage(message, ...args) { messages.push(message); return super.postMessage(message, ...args); }
    }
    const module = { exports: {} };
    const localRequire = Object.assign(name => name === 'vscode' ? vscode : name === 'node:worker_threads' ? { Worker: TracedWorker } : require(name), { resolve: require.resolve });
    runInNewContext(bundle, { module, exports: module.exports, process, Buffer, URL, performance, setTimeout, clearTimeout,
      __dirname: path.join(process.cwd(), 'src'), require: localRequire });
    const workspace = new module.exports.WorkspaceIndex(process.cwd(), storage);
    const context = { subscriptions: [], workspaceState: { get: key => saved.get(key), update: async (key, value) => saved.set(key, value) } };
    const service = module.exports.registerBuildConfigurations(context, workspace);
    let closed = false;
    const item = { workspace, service, adapter, configuration, folders, sourceChanges, commands, messages, reads,
      get discoveries() { return discoveries; },
      async settle() { await bounded(Promise.all([workspace.ready, service.ready])); await bounded(workspace.whenIdle()); },
      async close() { if (closed) return; closed = true; service.dispose(); const worker = workspace.worker; workspace.dispose(); await worker.terminate(); } };
    instances.push(item);
    return item;
  }
  async function seed() {
    if (options.legacy) {
      await mkdir(path.join(storage, 'analysis-cache'), { recursive: true });
      await writeFile(path.join(storage, 'analysis-cache', 'manifest.json'), JSON.stringify({ schema: 1, analysisVersion: 4, legacyRoots: [root], entries: [] }));
    }
    const first = open();
    await first.settle();
    if (options.legacy) { await first.workspace.reindex(); await first.workspace.whenIdle(); }
    await first.commands.get('dynsight.selectBuildConfiguration')();
    await first.workspace.whenIdle();
    const profile = first.workspace.buildProfile;
    assert.ok(profile, 'ordinary build selection must prepare a profile');
    await first.close();
    return profile;
  }
  const base = path.join(storage, 'analysis-cache', 'manifest.json');
  const profileManifest = id => path.join(storage, 'analysis-cache', 'profiles', id, 'manifest.json');
  return { storage, files, saved, settings, open, seed, base, profileManifest };
}
async function updateManifest(filename, mutate) {
  const data = JSON.parse(await readFile(filename, 'utf8')); mutate(data); await writeFile(filename, JSON.stringify(data)); return data;
}
function targetNames(workspace) {
  return [...workspace.index.files.values()].flatMap(file => Array.from(file.references).filter(ref => ref.kind === 'call' && ['first', 'second'].includes(ref.name)).map(ref => ref.name)).sort();
}

for (const state of ['version-14', 'damaged', 'missing', 'current']) test('selected cache restores independently of default cache: ' + state, async t => {
  const s = await scenario(t), profile = await s.seed(), manifest = s.profileManifest(profile.id);
  const before = await readFile(manifest, 'utf8');
  if (state === 'version-14') await updateManifest(s.base, data => { data.analysisVersion = 14; });
  if (state === 'damaged') await writeFile(s.base, 'damaged');
  if (state === 'missing') await rm(s.base);
  const next = s.open(); await next.settle();
  assert.equal(next.workspace.diagnostics.index.cache.state, 'restored');
  assert.equal(next.workspace.diagnostics.index.sourceParses, 0);
  assert.equal(next.workspace.diagnostics.index.rebuildCount, 0);
  assert.deepEqual(targetNames(next.workspace), ['first']);
  assert.equal(await readFile(manifest, 'utf8'), before, 'unchanged restart keeps the saved source generation');
});

for (const state of ['version', 'settings', 'manifest', 'record']) test('selected cache rejects incompatible or damaged data: ' + state, async t => {
  const s = await scenario(t), profile = await s.seed(), manifest = s.profileManifest(profile.id);
  if (state === 'version') await updateManifest(manifest, data => { data.analysisVersion = 14; });
  if (state === 'settings') await updateManifest(manifest, data => { data.key = 'different-settings'; });
  if (state === 'manifest') await writeFile(manifest, 'damaged');
  if (state === 'record') {
    const data = JSON.parse(await readFile(manifest, 'utf8'));
    await writeFile(path.join(path.dirname(manifest), data.generation, data.entries[0].name), 'damaged');
  }
  const before = await readFile(manifest, 'utf8'), next = s.open(); await next.settle();
  assert.match(next.workspace.status, state === 'version' ? /14.*19/ : state === 'settings' ? /settings changed/ : /damaged/);
  assert.equal(next.workspace.copilotWaitReason, 'cache-rebuild-required');
  assert.equal(next.workspace.diagnostics.index.sourceParses, 0);
  assert.equal(await readFile(manifest, 'utf8'), before, 'restoration must not replace rejected cache data');
  await next.workspace.reindex(); await next.workspace.whenIdle(); await next.close();
  const reopened = s.open(); await reopened.settle();
  assert.equal(reopened.workspace.diagnostics.index.cache.state, 'restored');
});

test('missing selected cache creates the selected projection instead of accepting the default snapshot', async t => {
  const s = await scenario(t), profile = await s.seed(), base = await readFile(s.base, 'utf8');
  await rm(path.dirname(s.profileManifest(profile.id)), { recursive: true });
  const next = s.open(); await next.settle();
  assert.deepEqual(targetNames(next.workspace), ['first']);
  assert.ok(JSON.parse(await readFile(s.profileManifest(profile.id), 'utf8')).entries.length);
  assert.equal(await readFile(s.base, 'utf8'), base);
  assert.ok(next.messages.filter(message => message.type === 'cache-init').every(message => message.directory.endsWith(profile.id)));
});

test('blocked startup retains source candidates through refresh, rebuild and immediate restart', async t => {
  const s = await scenario(t, { hidePreferred: true });
  s.files.delete(root + '/main.c');
  s.files.set(root + '/preferred/a.c', source); s.files.set(root + '/fallback/a.c', source);
  s.files.set(root + '/makefile', 'all: out/a.o\nout/%.o: preferred/%.c\n\tgcc -DMODE=1 -c $< -o $@\nout/%.o: fallback/%.c\n\tgcc -DMODE=2 -c $< -o $@\n');
  const profile = await s.seed();
  await updateManifest(s.profileManifest(profile.id), data => { data.analysisVersion = 14; });
  const next = s.open(); await next.settle();
  const fingerprint = next.workspace.buildProfile.fingerprint;
  await next.commands.get('dynsight.refreshBuildConfiguration')();
  assert.equal(next.workspace.buildProfile.fingerprint, fingerprint);
  assert.equal(next.workspace.buildProfile.units[0].sourceUri, root + '/preferred/a.c');
  await next.workspace.reindex(); await next.close();
  const reopened = s.open(); await reopened.settle();
  assert.equal(reopened.workspace.diagnostics.index.cache.state, 'restored');
  assert.equal(reopened.workspace.diagnostics.index.sourceParses, 0);
});

for (const state of ['missing', 'damaged']) test('selected inherited policy survives an unavailable default manifest: ' + state, async t => {
  const s = await scenario(t, { unconfigured: true, legacy: true }), profile = await s.seed();
  assert.deepEqual(JSON.parse(await readFile(s.profileManifest(profile.id), 'utf8')).legacyRoots, [root]);
  if (state === 'missing') await rm(s.base); else await writeFile(s.base, 'damaged');
  const next = s.open(); await next.settle();
  assert.equal(next.workspace.analyzeCallbacks, true);
  assert.equal(next.workspace.diagnostics.index.cache.state, 'restored');
  assert.equal(next.workspace.diagnostics.index.sourceParses, 0);
});

test('selected empty inherited policy overrides unrelated default legacy evidence', async t => {
  const s = await scenario(t, { unconfigured: true }), profile = await s.seed();
  assert.deepEqual(JSON.parse(await readFile(s.profileManifest(profile.id), 'utf8')).legacyRoots, []);
  await updateManifest(s.base, data => { data.legacyRoots = [root]; });
  const next = s.open(); await next.settle();
  assert.equal(next.workspace.analyzeCallbacks, false);
  assert.equal(next.workspace.diagnostics.index.cache.state, 'restored');
});

test('restoring selected policy does not accept an explicit user setting mismatch', async t => {
  const s = await scenario(t), profile = await s.seed(), filename = s.profileManifest(profile.id), before = await readFile(filename, 'utf8');
  await rm(s.base); s.settings.set('smartAnalysis.include', []);
  const next = s.open(); await next.settle();
  assert.match(next.workspace.status, /settings changed/);
  assert.equal(next.workspace.copilotWaitReason, 'cache-rebuild-required');
  assert.equal(await readFile(filename, 'utf8'), before);
});

for (const action of ['rebuild', 'scope', 'callbacks', 'folders']) test('slow build startup serializes ' + action, async t => {
  const s = await scenario(t), profile = await s.seed();
  await updateManifest(s.base, data => { data.analysisVersion = 14; });
  const base = await readFile(s.base, 'utf8'), pause = gate(), next = s.open({ metadataGate: pause });
  await bounded(pause.entered.promise);
  let pending;
  if (action === 'rebuild') pending = next.workspace.reindex();
  if (action === 'scope') { s.settings.set('include', ['**/*.c']); next.configuration.fire({ affectsConfiguration: key => key === 'dynsight.include' }); }
  if (action === 'callbacks') { s.settings.set('analyzeCallbacks', false); next.configuration.fire({ affectsConfiguration: key => key === 'dynsight.analyzeCallbacks' }); }
  if (action === 'folders') { next.adapter.workspaceFolders.push({ uri: Uri.parse('file:///other'), name: 'other', index: 1 }); next.folders.fire({}); }
  await Promise.resolve();
  assert.equal(next.workspace.diagnostics.index.sourceParses, 0);
  assert.equal(next.messages.filter(message => message.type === 'cache-init').length, 0, 'no basic cache is opened before build initialization');
  pause.released.resolve(); await next.settle(); if (pending) await bounded(pending); await bounded(next.workspace.whenIdle());
  assert.equal(next.workspace.buildProfile.id, profile.id);
  assert.doesNotMatch(next.workspace.status, /14.*19/);
  assert.equal(await readFile(s.base, 'utf8'), base);
});

for (const stage of ['discovery', 'metadata']) test('disposal during build ' + stage + ' prevents later analysis and cache writes', async t => {
  const s = await scenario(t), profile = await s.seed(), filename = s.profileManifest(profile.id), before = await readFile(filename, 'utf8');
  const pause = gate(), next = s.open(stage === 'discovery' ? { discoveryGate: pause } : { metadataGate: pause });
  await bounded(pause.entered.promise);
  const messages = next.messages.length;
  const pending = next.workspace.reindex();
  await next.close(); pause.released.resolve();
  await bounded(Promise.all([next.workspace.ready, next.service.ready, pending]));
  assert.equal(next.messages.length, messages);
  assert.equal(await readFile(filename, 'utf8'), before);
});

for (const action of ['scope', 'folders']) test('queued ' + action + ' changes cannot overwrite a rejected selected cache', async t => {
  const s = await scenario(t), profile = await s.seed(), filename = s.profileManifest(profile.id);
  await updateManifest(filename, data => { data.analysisVersion = 14; });
  const before = await readFile(filename, 'utf8'), pause = gate(), next = s.open({ metadataGate: pause });
  await bounded(pause.entered.promise);
  if (action === 'scope') { s.settings.set('include', ['**/*.c']); next.configuration.fire({ affectsConfiguration: key => key === 'dynsight.include' }); }
  else { next.adapter.workspaceFolders.push({ uri: Uri.parse('file:///other'), name: 'other', index: 1 }); next.folders.fire({}); }
  pause.released.resolve(); await next.settle();
  assert.equal(next.workspace.copilotWaitReason, 'cache-rebuild-required');
  assert.equal(next.workspace.diagnostics.index.sourceParses, 0);
  assert.equal(await readFile(filename, 'utf8'), before);
  await next.workspace.reindex(); await next.close();
  const reopened = s.open();
  if (action === 'folders') reopened.adapter.workspaceFolders.push({ uri: Uri.parse('file:///other'), name: 'other', index: 1 });
  await reopened.settle();
  assert.equal(reopened.workspace.diagnostics.index.cache.state, 'restored');
});

test('a queued rebuild after a startup scope change persists the final build fingerprint', async t => {
  const s = await scenario(t), profile = await s.seed();
  await updateManifest(s.profileManifest(profile.id), data => { data.analysisVersion = 14; });
  const pause = gate(), next = s.open({ metadataGate: pause }); await bounded(pause.entered.promise);
  s.settings.set('include', ['**/*.c']); next.configuration.fire({ affectsConfiguration: key => key === 'dynsight.include' });
  const pending = next.workspace.reindex(); pause.released.resolve(); await bounded(pending); await next.close();
  const reopened = s.open(); await reopened.settle();
  assert.equal(reopened.workspace.diagnostics.index.cache.state, 'restored');
  assert.equal(reopened.workspace.diagnostics.index.sourceParses, 0);
});

test('an unavailable saved build reports an error and restores the compatible basic cache', async t => {
  const s = await scenario(t); await s.seed();
  const before = await readFile(s.base, 'utf8');
  s.saved.set('buildConfiguration-v1', { ...s.saved.get('buildConfiguration-v1'), rootUri: 'file:///outside', entryUri: 'file:///outside/makefile', cwdUri: 'file:///outside' });
  const next = s.open(); await next.settle();
  assert.equal(next.workspace.buildProfile, undefined);
  assert.equal(next.workspace.buildStatus.state, 'error');
  assert.equal(next.workspace.diagnostics.index.cache.state, 'restored');
  assert.equal(next.workspace.diagnostics.index.sourceParses, 0);
  assert.equal(await readFile(s.base, 'utf8'), before);
});

test('partial selected metadata retains warnings and source navigation after restart', async t => {
  const s = await scenario(t);
  s.files.set(root + '/makefile', 'include missing.mk\nall: main.o\n%.o: %.c\n\tgcc -DMODE=1 -c $< -o $@\n');
  await s.seed(); await updateManifest(s.base, data => { data.analysisVersion = 14; });
  const next = s.open(); await next.settle();
  assert.equal(next.workspace.buildStatus.state, 'partial');
  assert.ok(next.workspace.buildProfile.issues.some(issue => issue.code === 'missing-build-input'));
  assert.equal(next.workspace.diagnostics.index.cache.state, 'restored');
  assert.equal(next.workspace.diagnostics.index.sourceParses, 0);
  assert.deepEqual(targetNames(next.workspace), ['first', 'second']);
});

test('unselected startup retains version checks without an extra source discovery', async t => {
  const s = await scenario(t), first = s.open(); await first.settle(); await first.close();
  await updateManifest(s.base, data => { data.analysisVersion = 14; });
  const next = s.open(); await next.settle();
  assert.match(next.workspace.status, /14.*19/);
  assert.equal(next.discoveries, 0);
  assert.equal(next.workspace.diagnostics.index.sourceParses, 0);
});
