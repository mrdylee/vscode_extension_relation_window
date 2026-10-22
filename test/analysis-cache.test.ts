import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AnalysisCache, ANALYSIS_CACHE_VERSION } from '../src/analysis-cache';
import { FileAnalysis } from '../src/model';

const file = (uri: string, text: string): FileAnalysis => ({ uri, text, symbols: [], references: [], includes: [], issues: [],
  programs: [{ id: uri + '#0', locals: [], params: [], body: [] }] });
const entry = (uri = 'file:///main.c', text = 'void main(void){}') => {
  const raw = file(uri, text);
  return { raw, derived: { ...raw, programs: undefined, issues: ['Callback propagation limit: partial result'] }, skip: true, expandMacros: false };
};
async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), 'dynsight-cache-'));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('disk cache restores raw flow and partial derived notices after reopening', async () => temporary(async directory => {
  const first = await AnalysisCache.open(directory, 'workspace-v1');
  assert.equal(first.state, 'missing');
  assert.equal((await first.save([entry()])).saved, true);
  const second = await AnalysisCache.open(directory, 'workspace-v1');
  assert.equal(second.state, 'ready');
  const restored = await second.restore('file:///main.c', 'void main(void){}', true, false);
  assert.deepEqual(restored?.raw.programs, entry().raw.programs);
  assert.equal(restored?.raw.symbols, restored?.derived.symbols, 'unchanged symbol arrays are shared after hydration');
  assert.equal(restored?.derived.programs, undefined, 'raw flow does not leak into the host snapshot');
  assert.deepEqual(restored?.derived.issues, entry().derived.issues);
  assert.equal(restored?.derived.text, entry().raw.text);
  assert.equal(second.matches(['file:///main.c']), true);
  assert.equal(second.matches([]), false, 'deleting a dependency invalidates the derived generation');
  assert.equal(second.matches(['file:///main.c', 'file:///added.c']), false);
}));

test('content, file options and workspace configuration invalidate cached input', async () => temporary(async directory => {
  const cache = await AnalysisCache.open(directory, 'workspace-v1');
  await cache.save([entry()]);
  assert.equal(await cache.restore('file:///main.c', 'void changed(void){}', true, false), undefined);
  assert.equal(await cache.restore('file:///main.c', 'void main(void){}', false, false), undefined);
  assert.equal(await cache.restore('file:///main.c', 'void main(void){}', true, true), undefined);
  const different = await AnalysisCache.open(directory, 'workspace-v2');
  assert.equal(different.state, 'incompatible');
  assert.equal(different.reason, 'workspace-settings');
  assert.equal(await different.restore('file:///main.c', 'void main(void){}', true, false), undefined);
  assert.equal((await different.save([entry()])).saved, true, 'manual rebuild can replace incompatible data');
  assert.equal((await AnalysisCache.open(directory, 'workspace-v2')).state, 'ready');
}));

test('analysis compatibility changes are distinct from damage and manual rebuild adopts the new version', async () => temporary(async directory => {
  const old = await AnalysisCache.open(directory, 'same-settings');
  await old.save([entry()]);
  const next = await AnalysisCache.open(directory, 'same-settings', ANALYSIS_CACHE_VERSION + 1);
  assert.equal(next.state, 'incompatible');
  assert.equal(next.reason, 'analysis-version');
  assert.equal(next.savedVersion, ANALYSIS_CACHE_VERSION);
  assert.equal(await next.restore('file:///main.c', 'void main(void){}', true, false), undefined);
  assert.equal((await next.save([entry()])).saved, true);
  assert.equal(next.reason, undefined);
  assert.equal((await AnalysisCache.open(directory, 'same-settings', ANALYSIS_CACHE_VERSION + 1)).state, 'ready');
  assert.equal((await AnalysisCache.open(directory, 'same-settings')).reason, 'analysis-version', 'downgrades also need compatible analysis');
}));

test('legacy unversioned generations require migration while malformed version metadata is damaged', async () => temporary(async directory => {
  const cache = await AnalysisCache.open(directory, 'settings'); await cache.save([entry()]);
  const filename = path.join(directory, 'manifest.json');
  const manifest = JSON.parse(await readFile(filename, 'utf8'));
  const { analysisVersion, ...legacy } = manifest;
  await writeFile(filename, JSON.stringify({ ...legacy, schema: 1 }));
  const old = await AnalysisCache.open(directory, 'settings');
  assert.equal(old.state, 'incompatible'); assert.equal(old.reason, 'legacy-format');
  await writeFile(filename, JSON.stringify({ ...manifest, analysisVersion: 'broken' }));
  assert.equal((await AnalysisCache.open(directory, 'settings')).state, 'invalid');
  await writeFile(filename, JSON.stringify({ ...manifest, key: 'different', entries: [{}] }));
  assert.equal((await AnalysisCache.open(directory, 'settings')).state, 'invalid', 'corruption is not hidden by a settings mismatch');
}));

test('truncated records are cache misses and corrupt manifests require rebuilding', async () => temporary(async directory => {
  const cache = await AnalysisCache.open(directory, 'workspace-v1');
  await cache.save([entry()]);
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  await writeFile(path.join(directory, manifest.generation, manifest.entries[0].name), '{');
  const reopened = await AnalysisCache.open(directory, 'workspace-v1');
  assert.equal(await reopened.restore('file:///main.c', 'void main(void){}', true, false), undefined);
  assert.equal(reopened.state, 'invalid', 'record corruption is distinct from an ordinary changed-file cache miss');
  await writeFile(path.join(directory, 'manifest.json'), '{');
  assert.equal((await AnalysisCache.open(directory, 'workspace-v1')).state, 'invalid');
}));

test('failed generation leaves the last complete manifest usable', async () => temporary(async directory => {
  const cache = await AnalysisCache.open(directory, 'workspace-v1');
  await cache.save([entry()]);
  function* interrupted() { yield entry('file:///new.c', 'void new(void){}'); throw new Error('interrupted'); }
  assert.equal((await cache.save(interrupted())).saved, false);
  const reopened = await AnalysisCache.open(directory, 'workspace-v1');
  assert.ok(await reopened.restore('file:///main.c', 'void main(void){}', true, false));
  assert.equal(await reopened.restore('file:///new.c', 'void new(void){}', true, false), undefined);
}));

test('each source has a separate record and completed generations remain bounded', async () => temporary(async directory => {
  const cache = await AnalysisCache.open(directory, 'workspace-v1');
  for (let revision = 0; revision < 4; revision++) {
    assert.equal((await cache.save([entry('file:///a.c', `void a${revision}(void){}`), entry('file:///b.c')])).saved, true);
  }
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.entries.length, 2);
  assert.ok((await readdir(directory)).filter(name => name.startsWith('generation-')).length <= 2);
  assert.equal(new Set(manifest.entries.map((record: { name: string }) => record.name)).size, 2);
}));

test('proven unchanged records are reused without serialization while affected derived data is rewritten', async () => temporary(async directory => {
  const cache = await AnalysisCache.open(directory, 'workspace-v1');
  const a = entry('file:///a.c'), b = entry('file:///b.c');
  await cache.save([a, b]);
  const before = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  const unchanged = { ...a, derived: new Proxy(a.derived, { ownKeys() { throw new Error('unchanged snapshot serialized'); } }) };
  const changed = { ...b, derived: { ...b.derived, issues: ['Changed dependent callback result'] } };
  assert.equal((await cache.save([unchanged, changed], new Set([a.raw.uri]))).saved, true);
  const after = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  assert.equal(before.entries[0].digest, after.entries[0].digest);
  assert.notEqual(before.entries[1].digest, after.entries[1].digest);
  assert.equal((await stat(path.join(directory, before.generation, before.entries[0].name))).ino,
    (await stat(path.join(directory, after.generation, after.entries[0].name))).ino, 'same-filesystem cache uses a hard link');
}));

test('cleanup never removes another window staging a generation', async () => temporary(async directory => {
  const cache = await AnalysisCache.open(directory, 'workspace-v1');
  await cache.save([entry()]);
  const staging = path.join(directory, 'generation-00000000-0000-0000-0000-000000000001');
  await mkdir(staging); await writeFile(path.join(staging, 'pending.json'), '{}');
  assert.equal((await cache.save([entry()])).saved, true);
  assert.equal(await readFile(path.join(staging, 'pending.json'), 'utf8'), '{}');
}));
