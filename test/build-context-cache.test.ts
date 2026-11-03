import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BuildMetadataCache } from '../src/build-discovery';
import { discoverBuildEntries } from '../src/build-discovery';
import { extractStaticBuildOptions } from '../src/build-options';
import { buildFixture } from './build-fixtures';
import { AnalysisCache } from '../src/analysis-cache';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileAnalysis } from '../src/model';
import { canonicalBuildUri } from '../src/build-context';

test('Windows parent-folder invalidation matches encoded drives and path case aliases',async()=>{
  const name='file:///C:/Project/Cfg/flags.mk',f=buildFixture({[name]:'MODE=1'});
  const cache=new BuildMetadataCache({...f.fs,readText:async uri=>[...f.texts].find(([path])=>canonicalBuildUri(path)===canonicalBuildUri(uri))?.[1]});
  const encoded='file:///c%3A/Project/Cfg/flags.mk';
  assert.equal(await cache.readText(encoded),'MODE=1');
  f.texts.set(name,'MODE=2');
  assert.equal(cache.invalidate('file:///C:/project/cfg',true),true);
  assert.equal(await cache.readText(encoded),'MODE=2');
  assert.equal(await cache.readText('file:///c:/PROJECT/CFG/FLAGS.MK'),'MODE=2');
});

for(const nested of ['','nested/'])test(`creating or deleting the parent of ${nested||'direct '}prerequisites invalidates directory observations`,async()=>{
  const preferred='preferred/'+nested+'a.c';
  const f=buildFixture({Makefile:'all: a.o\n%.o: preferred/'+nested+'%.c\n\tdcc -DPREFERRED -c $<\n%.o: fallback/%.c\n\tdcc -DFALLBACK -c $<\n','fallback/a.c':''});
  const cache=new BuildMetadataCache(f.fs),entry={id:'parent-patterns',rootUri:'file:///p',entryUri:'file:///p/Makefile',cwdUri:'file:///p',dialect:'make' as const,args:[],evidence:[]};
  assert.equal((await cache.profile(entry,[],{})).units[0].sourceUri,'file:///p/fallback/a.c');
  f.texts.set('file:///p/'+preferred,'');
  assert.equal(cache.invalidate('file:///p/preferred',true),true);
  assert.equal((await cache.profile(entry,[],{})).units[0].sourceUri,'file:///p/'+preferred);
  f.texts.delete('file:///p/'+preferred);
  assert.equal(cache.invalidate('file:///p/preferred',true),true);
  assert.equal((await cache.profile(entry,[],{})).units[0].sourceUri,'file:///p/fallback/a.c');
});
test('parent-folder events invalidate cached included Makefile contents and missing reads',async()=>{
  const f=buildFixture({Makefile:'include cfg/flags.mk\na.o: a.c\n\tdcc $(FLAGS) -c $<\n','cfg/flags.mk':'FLAGS=-DMODE=1'});
  const cache=new BuildMetadataCache(f.fs),entry={id:'parent-includes',rootUri:'file:///p',entryUri:'file:///p/Makefile',cwdUri:'file:///p',dialect:'make' as const,args:[],evidence:[]};
  const sources=['file:///p/a.c'];
  assert.equal((await cache.profile(entry,sources,{})).units[0].macroActions[0].replacement,'1');
  f.texts.delete('file:///p/cfg/flags.mk');
  assert.equal(cache.invalidate('file:///p/cfg',true),true);
  const deleted=await cache.profile(entry,sources,{});
  assert.ok(deleted.issues.some(i=>i.code==='missing-build-input'));
  assert.equal(deleted.units[0].status,'partial');
  f.texts.set('file:///p/cfg/flags.mk','FLAGS=-DMODE=2');
  assert.equal(cache.invalidate('file:///p/cfg',true),true);
  const created=await cache.profile(entry,sources,{});
  assert.equal(created.units[0].status,'resolved');
  assert.equal(created.units[0].macroActions[0].replacement,'2');
});

test('creating or deleting an implicit-rule prerequisite invalidates cached pattern selection',async()=>{
  const f=buildFixture({Makefile:'all: a.o\n%.o: preferred/%.c\n\tdcc -DPREFERRED -c $<\n%.o: fallback/%.c\n\tdcc -DFALLBACK -c $<\n','fallback/a.c':''});
  const cache=new BuildMetadataCache(f.fs),entry={id:'patterns',rootUri:'file:///p',entryUri:'file:///p/Makefile',cwdUri:'file:///p',dialect:'make' as const,args:[],evidence:[]};
  const first=await cache.profile(entry,[],{});
  assert.equal(first.units[0].sourceUri,'file:///p/fallback/a.c');
  f.texts.set('file:///p/preferred/a.c','');
  assert.equal(cache.invalidate('file:///p/preferred/a.c',true),true);
  const second=await cache.profile(entry,[],{});
  assert.equal(second.units[0].sourceUri,'file:///p/preferred/a.c');
  assert.notEqual(second.fingerprint,first.fingerprint);
  f.texts.delete('file:///p/preferred/a.c');
  assert.equal(cache.invalidate('file:///p/preferred/a.c',true),true);
  assert.equal((await cache.profile(entry,[],{})).units[0].sourceUri,'file:///p/fallback/a.c');
});

test('new wildcard sources invalidate the cached directory and profile without source execution',async()=>{
  const f=buildFixture({Makefile:'all: $(patsubst %.c,%.o,$(wildcard app/*.c))\n%.o: %.c\n\tgcc -c $<','app/a.c':''});
  const cache=new BuildMetadataCache(f.fs),entry=(await cache.discover({rootUri:'file:///p',sourceUris:['file:///p/app/a.c']})).entries[0];
  assert.equal((await cache.profile(entry,['file:///p/app/a.c'],{})).units.length,1);
  f.texts.set('file:///p/app/b.c','');assert.equal(cache.invalidate('file:///p/app/b.c',true),true);
  assert.equal((await cache.profile(entry,['file:///p/app/a.c'],{})).units.length,2);
  f.texts.delete('file:///p/app/a.c');f.texts.delete('file:///p/app/b.c');
  assert.equal(cache.invalidate('file:///p/app',true),true);
  assert.equal((await cache.profile(entry,['file:///p/app/a.c'],{})).units.length,0);
});

test('warm source indexing reuses directory, file reads and resolved profile', async () => {
  const f = buildFixture({ Makefile: 'CC=gcc\na.o: a.c\n\t$(CC) -DMODE=1 -c $<' });
  const cache = new BuildMetadataCache(f.fs), request = { rootUri: 'file:///p', sourceUris: ['file:///p/a.c'] };
  const first = await cache.discover(request), entry = first.entries[0];
  const profile = await cache.profile(entry, request.sourceUris, {});
  const reads = f.reads.length, lists = f.lists.length;
  assert.equal(await cache.discover(request), first);
  assert.equal(await cache.profile(entry, request.sourceUris, {}), profile);
  assert.equal(f.reads.length, reads); assert.equal(f.lists.length, lists);
  f.texts.set('file:///p/Makefile', 'CC=gcc\na.o: a.c\n\t$(CC) -DMODE=2 -c $<');
  assert.equal(cache.invalidate('file:///p/Makefile'), true);
  const updated = await cache.profile(entry, request.sourceUris, {});
  assert.equal(updated.units[0].macroActions[0].replacement, '2');
  assert.notEqual(updated.fingerprint, profile.fingerprint);
});
test('batch metadata overlay is cached read-only and invalidates after script or source config edits',async()=>{
  const f=buildFixture({'build.bat':'cd source\ndel make.cfg\necho MODE := 1 >> make.cfg\nmake',
    'source/make.cfg':'MODE := 9','source/Makefile':'include make.cfg\nCC=gcc\na.o: a.c\n\t$(CC) -DMODE=$(MODE) -c $<'}),cache=new BuildMetadataCache(f.fs);
  const entry={id:'x',rootUri:'file:///p',entryUri:'file:///p/build.bat',cwdUri:'file:///p',dialect:'cmd' as const,args:[],evidence:[]},sources=['file:///p/source/a.c'];
  const first=await cache.profile(entry,sources,{}),reads=f.reads.length;
  assert.equal(first.units[0].macroActions[0].replacement,'1');assert.equal(await cache.profile(entry,sources,{}),first);assert.equal(f.reads.length,reads);
  f.texts.set(entry.entryUri,'cd source\ndel make.cfg\necho MODE := 2 >> make.cfg\nmake');assert.equal(cache.invalidate(entry.entryUri),true);
  const second=await cache.profile(entry,sources,{});assert.equal(second.units[0].macroActions[0].replacement,'2');assert.notEqual(second.fingerprint,first.fingerprint);
  assert.equal(f.texts.get('file:///p/source/make.cfg'),'MODE := 9');assert.equal(cache.invalidate('file:///p/source/make.cfg'),true);
});
test('a new nearby mk invalidates negative directory dependencies; unrelated C edits do not', async () => {
  const f = buildFixture({ Makefile: '' }), cache = new BuildMetadataCache(f.fs);
  const request = { rootUri: 'file:///p', sourceUris: ['file:///p/App/a.c'] };
  await cache.discover(request);
  assert.equal(cache.invalidate('file:///p/App/a.c'), false);
  f.texts.set('file:///p/App/module.mk', 'CFLAGS=-DX');
  assert.equal(cache.invalidate('file:///p/App/module.mk'), true);
  assert.ok((await cache.discover(request)).candidates.includes('file:///p/App/module.mk'));
});

test('persistent analysis cache keeps two facts for the same source URI', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dynsight-build-cache-'));
  try {
    const record = (key: string): FileAnalysis => ({ uri: 'file:///p/ops.h', text: 'void invoke(void){}', symbols: [], references: [], includes: [], issues: [],
      context: { profileId: 'A', unitId: key, key, prepared: { key, uri: 'file:///p/ops.h', text: 'void invoke(void){}', maskedText: 'void invoke(void){}', entryEnvironmentFingerprint: key, inactive: [], timeline: [], resolvedIncludes: [] } } });
    const cache = await AnalysisCache.open(directory, 'A');
    const a = record('a-header'), b = record('b-header');
    assert.equal((await cache.save([a, b].map(raw => ({ raw, derived: raw, skip: true, expandMacros: true })))).saved, true);
    const reopened = await AnalysisCache.open(directory, 'A');
    assert.equal((await reopened.restore('a-header', a.text, true, true))?.raw.context?.unitId, 'a-header');
    assert.equal((await reopened.restore('b-header', b.text, true, true))?.raw.context?.unitId, 'b-header');
    assert.ok(reopened.matches(['a-header', 'b-header']));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
