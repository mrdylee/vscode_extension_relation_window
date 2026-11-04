import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createAnalyzer } from '../src/analyzer';
import { BuildAnalysis } from '../src/build-analysis';
import { BuildProfile, normalizeCompileContext } from '../src/build-context';
import { RelationIndex } from '../src/relations';
import { AnalysisWorkBudget } from '../src/analysis-budget';
import { IncrementalAnalysis } from '../src/incremental-analysis';
import { FileAnalysis } from '../src/model';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { buildFixture } from './build-fixtures';
import { extractStaticBuildOptions } from '../src/build-options';

let parser: Awaited<ReturnType<typeof createAnalyzer>>;
before(async () => { parser = await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'), path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm')); });
test('RBMS Diab options and shared-prefix rules preserve callbacks through cold, warm and debug refreshes',async()=>{
  const make=(debug:boolean)=>'OBJS=out/\nSHARED=out/share/\nall: out/share/app/a.o\nout/share/app/a.o: CFLAGS := -tPPCE200Z4251N3VES:simple -g3 -Xsmall-data=0 -Xmake-dependency=4 -Xstop-on-warning -Iinc -DMODE='+(debug?'2 -DDEBUG_TEST':'1')+'\n$(OBJS)%.o $(SHARED)%.o: %.c\n\tdcc $(CFLAGS) -c $< -o $@\n';
  const source='#include <ops.h>\nvoid first(void){}void second(void){}\nvoid run(void){CB cb=TARGET;cb();}';
  const f=buildFixture({Makefile:make(false),'app/a.c':source,'inc/ops.h':'typedef void(*CB)(void);\n#if MODE==1\n#define TARGET first\n#else\n#define TARGET second\n#endif\n'});
  const raw=[...f.texts].filter(([uri])=>/\.(c|h)$/.test(uri)).map(([uri,text])=>parser.analyze(uri,text,true,{expandMacros:true,propagateCallbacks:true}));
  const entry={id:'rbms',rootUri:'file:///p',entryUri:'file:///p/Makefile',cwdUri:'file:///p',dialect:'make' as const,args:[],evidence:[]},build=new BuildAnalysis();
  for(const debug of [false,false,true]){
    f.texts.set('file:///p/Makefile',make(debug));
    const profile=await extractStaticBuildOptions(f.fs,entry,['file:///p/app/a.c'],{});
    assert.equal(profile.units[0].status,'resolved');
    assert.equal(profile.units[0].macroActions.some(a=>a.name==='DEBUG_TEST'),debug);
    const prepared=await build.prepare(parser,raw,profile,new AnalysisWorkBudget()),index=new RelationIndex();
    parser.derive(prepared).forEach(file=>index.update(file));
    const run=index.symbols().find(s=>s.name==='run'&&s.definition)!;
    assert.deepEqual(index.relations(run.id,'callees').filter(r=>r.callKind==='inferred').map(r=>r.name),[debug?'second':'first']);
  }
});
test('GCC and Diab Make target options select the correct callback cold, warm and after configuration edit',async()=>{
  for(const compiler of ['gcc','dcc']){
    const make=(mode:number)=>`CC=${compiler}\nOBJS := $(addprefix out/,a.o)\nall: $(OBJS)\nout/a.o: CFLAGS := -DMODE=${mode}\nout/%.o: %.c\n\t$(CC) $(CFLAGS) -c $< -o $@`;
    const f=buildFixture({Makefile:make(1),'a.c':'void first(void){}void second(void){}\n#if MODE==1\n#define TARGET first\n#else\n#define TARGET second\n#endif\nvoid run(void){void(*cb)(void)=TARGET;cb();}'});
    const raw=[parser.analyze('file:///p/a.c',f.texts.get('file:///p/a.c')!,true,{expandMacros:true,propagateCallbacks:true})];
    const entry={id:'x',rootUri:'file:///p',entryUri:'file:///p/Makefile',cwdUri:'file:///p',dialect:'make' as const,args:[],evidence:[]},build=new BuildAnalysis();
    for(const mode of [1,1,2]){
      f.texts.set('file:///p/Makefile',make(mode));const profile=await extractStaticBuildOptions(f.fs,entry,['file:///p/a.c'],{});
      assert.equal(profile.units[0].membership,'included');assert.equal(profile.units[0].status,'resolved');
      const prepared=await build.prepare(parser,raw,profile,new AnalysisWorkBudget()),index=new RelationIndex();parser.derive(prepared).forEach(file=>index.update(file));
      const run=index.symbols().find(s=>s.name==='run'&&s.definition)!;
      assert.deepEqual(index.relations(run.id,'callees').filter(r=>r.callKind==='inferred').map(r=>r.name),[mode===1?'first':'second']);
    }
  }
});
test('an unevaluated generated header cannot prune branches using an old disk copy',async()=>{
  const f=buildFixture({Makefile:'CC=gcc\nall: a.o\na.o: a.c | generated.h\n\t$(CC) -c $<\ngenerated.h:\n\tsh gen.sh > $@',
    'a.c':'#include "generated.h"\nvoid first(void){}void second(void){}\n#if MODE==1\n#define PICK() first()\n#else\n#define PICK() second()\n#endif\nvoid run(void){PICK();}', 'generated.h':'#define MODE 1'});
  const profile=await extractStaticBuildOptions(f.fs,{id:'x',rootUri:'file:///p',entryUri:'file:///p/Makefile',cwdUri:'file:///p',dialect:'make',args:[],evidence:[]},['file:///p/a.c'],{});
  const raw=[...f.texts].filter(([uri])=>/\.(?:c|h)$/.test(uri)).map(([uri,text])=>parser.analyze(uri,text,true,{expandMacros:true,propagateCallbacks:true}));
  const input=await new BuildAnalysis().prepare(parser,raw,profile,new AnalysisWorkBudget()),index=new RelationIndex();parser.derive(input).forEach(file=>index.update(file));
  const owner=index.symbols().find(s=>s.name==='run'&&s.definition)!;
  assert.deepEqual(index.relations(owner.id,'callees').filter(r=>r.callKind==='expanded').map(r=>r.name).sort(),['first','second']);
  assert.ok(input.some(file=>file.issues.some(issue=>/generated|unavailable|not found/i.test(issue))));
});
async function fixture() {
  const sources = {
    'a.c': '#include "ops.h"\nvoid run_a(void){invoke();}', 'b.c': '#include "ops.h"\nvoid run_b(void){invoke();}',
    'targets.c': 'void first(void){} void second(void){}',
    'inc/ops.h': 'typedef void(*CB)(void);void first(void);void second(void);\n#if MODE==1\nstatic CB saved=first;\n#else\nstatic CB saved=second;\n#endif\nstatic void invoke(void){saved();}'
  };
  const f = buildFixture(sources), raw = [...f.texts].map(([uri, text]) => parser.analyze(uri, text, true, { expandMacros: true, propagateCallbacks: true }));
  const entry = { id: 'A', rootUri: 'file:///p', entryUri: 'file:///p/Makefile', cwdUri: 'file:///p', dialect: 'make' as const, args: [], evidence: [] };
  const units = await Promise.all(['a.c', 'b.c', 'targets.c'].map((name, n) => normalizeCompileContext({ profileId: 'A', sourceUri: 'file:///p/' + name, cwdUri: 'file:///p', argv: ['gcc', '-DMODE=' + (n + 1), '-Iinc', '-c', name], dialect: 'posix', evidence: [] }, f.fs)));
  const profile: BuildProfile = { id: 'A', entry, fingerprint: 'A-config', units, coverage: 'partial', dependencies: [], relevantEnvironment: [], issues: [] };
  return { raw, profile };
}
test('same header has independent static storage and callback targets in each translation unit', async () => {
  const { raw, profile } = await fixture(), build = new BuildAnalysis();
  const input = await build.prepare(parser, raw, profile, new AnalysisWorkBudget());
  const derived = parser.derive(input), index = new RelationIndex(); derived.forEach(file => index.update(file));
  const invokes = index.symbols().filter(s => s.name === 'invoke' && s.definition);
  assert.equal(invokes.length, 2); assert.notEqual(invokes[0].id, invokes[1].id);
  assert.deepEqual(invokes.map(s => index.relations(s.id, 'callees').filter(r => r.callKind === 'inferred').map(r => r.name).sort()), [['first'], ['second']]);
  assert.ok(index.relations(invokes[0].id,'callees').filter(r=>r.callKind==='inferred').every(group=>group.sites.every(site=>site.inference?.incomplete&&site.inference.reasons.some(reason=>/link membership/i.test(reason)))));
  const owners = ['run_a', 'run_b'].map(name => index.symbols().find(s => s.name === name)!);
  const callees = owners.map(s => index.relations(s.id, 'callees').flatMap(r => r.symbol ? [r.symbol.id] : []));
  assert.deepEqual(callees, [[invokes[0].id], [invokes[1].id]]);
});
test('warm preparation reuses unchanged units and reparses only affected sources', async () => {
  const { raw, profile } = await fixture(), build = new BuildAnalysis();
  const first = await build.prepare(parser, raw, profile, new AnalysisWorkBudget());
  const warm = await build.prepare(parser, raw, profile, new AnalysisWorkBudget());
  assert.ok(first.every((file, n) => file === warm[n]));
  const changed = raw.map(file => file.uri.endsWith('/a.c') ? parser.analyze(file.uri, file.text + '\nvoid new_a(void){}', true, file.analysisPolicy) : file);
  const next = await build.prepare(parser, changed, profile, new AnalysisWorkBudget());
  const b = warm.find(file => file.uri.endsWith('/b.c'))!;
  assert.equal(next.find(file => file.uri.endsWith('/b.c')), b);
  assert.ok(next.some(file => file.symbols.some(s => s.name === 'new_a')));
});

test('incremental derivation does not overwrite same-URI header variants', async () => {
  const { raw, profile } = await fixture(), build = new BuildAnalysis(), incremental = new IncrementalAnalysis();
  const input = await build.prepare(parser, raw, profile, new AnalysisWorkBudget());
  const derived = incremental.derive(input, files => parser.derive(files));
  const headers = derived.filter(file => file.uri.endsWith('/ops.h'));
  assert.equal(headers.length, 2); assert.notEqual(headers[0], headers[1]);
  const warm = incremental.derive(input, () => { throw new Error('Unexpected warm derive'); });
  assert.ok(warm.every((file, n) => file === derived[n]));
});

test('saving one unit does not reanalyze private callbacks in another unit using the same header', async () => {
  const texts = new Map([
    ['file:///p/a.c', 'static void target(void){}\n#include "ops.h"\nvoid run_a(void){invoke();}'],
    ['file:///p/b.c', 'static void target(void){}\n#include "ops.h"\nvoid run_b(void){invoke();}'],
    ['file:///p/inc/ops.h', 'typedef void(*CB)(void);struct Ops{CB cb;};static struct Ops saved={target};static void invoke(void){saved.cb();}']
  ]);
  const f = buildFixture(Object.fromEntries([...texts].map(([uri, text]) => [uri.slice('file:///p/'.length), text])));
  const profile = (await fixture()).profile;
  profile.units = await Promise.all(['a.c', 'b.c'].map(name => normalizeCompileContext({ profileId: 'A', sourceUri: 'file:///p/' + name, cwdUri: 'file:///p', argv: ['gcc', '-Iinc', '-c', name], dialect: 'posix', evidence: [] }, f.fs)));
  const build = new BuildAnalysis(), incremental = new IncrementalAnalysis(), batches: FileAnalysis[][] = [];
  const raw = [...texts].map(([uri, text]) => parser.analyze(uri, text, true, { expandMacros: true, propagateCallbacks: true }));
  const derive = (inputs: FileAnalysis[]) => {
    const expanded = parser.expand(inputs);
    return incremental.derive(inputs, dirty => { batches.push(dirty); return parser.derive(dirty, undefined, undefined, true, {}, dirty.map(file => expanded[inputs.indexOf(file)])); }, true, expanded);
  };
  const first = derive(await build.prepare(parser, raw, profile, new AnalysisWorkBudget()));
  const changed = raw.map(file => file.uri.endsWith('/a.c') ? parser.analyze(file.uri, file.text.replace('invoke();', 'invoke();int edited=1;'), true, file.analysisPolicy) : file);
  const prepared = await build.prepare(parser, changed, profile, new AnalysisWorkBudget()), next = derive(prepared);
  const otherUnit = profile.units[1].id;
  assert.ok(batches[1].every(file => file.context?.unitId !== otherUnit));
  for (const file of first.filter(file => file.context?.unitId === otherUnit)) assert.equal(next.find(current => current.context?.key === file.context!.key), file);
  assert.deepEqual(next, parser.derive(prepared));
});

test('known build choices reduce macro variants while preserving expanded calls and registrations', async () => {
  const source = Array.from({ length: 6 }, (_, n) => `#if F${n}\n#define PICK${n}() yes${n}()\n#else\n#define PICK${n}() no${n}()\n#endif\n`).join('') +
    Array.from({ length: 6 }, (_, n) => `void yes${n}(void){}void no${n}(void){}`).join('') + 'void run(void){' + Array.from({ length: 6 }, (_, n) => `PICK${n}();`).join('') + '}';
  const f = buildFixture({ 'a.c': source });
  const unit = await normalizeCompileContext({ profileId: 'A', sourceUri: 'file:///p/a.c', cwdUri: 'file:///p', argv: ['gcc', ...Array.from({ length: 6 }, (_, n) => `-DF${n}=1`), '-c', 'a.c'], dialect: 'posix', evidence: [] }, f.fs);
  const profile = (await fixture()).profile; profile.units = [unit];
  const raw = [parser.analyze('file:///p/a.c', source, true, { expandMacros: true, propagateCallbacks: true })];
  const input = await new BuildAnalysis().prepare(parser, raw, profile, new AnalysisWorkBudget());
  const derived = parser.derive(input), index = new RelationIndex(); derived.forEach(file => index.update(file));
  const owner = index.symbols().find(s => s.name === 'run')!;
  assert.deepEqual(index.relations(owner.id, 'callees').filter(r => r.callKind === 'expanded').map(r => r.name).sort(), ['yes0', 'yes1', 'yes2', 'yes3', 'yes4', 'yes5']);
  assert.ok(derived.every(file => !file.issues.some(issue => /alternative limit/.test(issue))));
});

test('unknown elif choices and repeated correlated conditions retain every feasible expansion', async () => {
  for (const prefix of [
    '#if FLAG\n#define PICK() one()\n#elif OTHER\n#define PICK() two()\n#else\n#define PICK() three()\n#endif\n',
    Array.from({length:6},(_,n)=>`#if FLAG\n#define P${n}() one()\n#else\n#define P${n}() two()\n#endif\n`).join('')
  ]) {
    const body = prefix.includes('PICK') ? 'PICK();' : Array.from({length:6},(_,n)=>`P${n}();`).join('');
    const source = prefix + 'void one(void){}void two(void){}void three(void){}void run(void){' + body + '}';
    const f=buildFixture({'a.c':source}),unit=await normalizeCompileContext({profileId:'A',sourceUri:'file:///p/a.c',cwdUri:'file:///p',argv:['gcc','-c','a.c'],dialect:'posix',evidence:[]},f.fs);
    const profile=(await fixture()).profile;profile.units=[unit];
    const input=await new BuildAnalysis().prepare(parser,[parser.analyze(unit.sourceUri,source,true,{expandMacros:true,propagateCallbacks:true})],profile,new AnalysisWorkBudget());
    const derived=parser.derive(input),index=new RelationIndex();derived.forEach(file=>index.update(file));
    const owner=index.symbols().find(s=>s.name==='run')!;
    assert.deepEqual([...new Set(index.relations(owner.id,'callees').filter(r=>r.callKind==='expanded').map(r=>r.name))].sort(),prefix.includes('PICK')?['one','three','two']:['one','two']);
    assert.ok(derived.every(file=>!file.issues.some(issue=>/alternative limit/.test(issue))));
  }
});
test('preprocessing limits cannot produce a silently empty ready build', async()=>{
  const {raw,profile}=await fixture();
  await assert.rejects(new BuildAnalysis().prepare(parser,raw,profile,new AnalysisWorkBudget({functionWork:1,projectWork:1})),/work limit/i);
});
test('build-aware macro registrations stay available with callback propagation off',async()=>{
  const source='typedef void(*CB)(void);struct S{CB cb;};struct S s;void handler(void){}\n#if ENABLE\n#define REG(x) s.cb=(x)\n#else\n#define REG(x) ((void)0)\n#endif\nvoid run(void){REG(handler);}';
  const f=buildFixture({'a.c':source}),unit=await normalizeCompileContext({profileId:'A',sourceUri:'file:///p/a.c',cwdUri:'file:///p',argv:['gcc','-DENABLE=1','-c','a.c'],dialect:'posix',evidence:[]},f.fs);
  const profile=(await fixture()).profile;profile.units=[unit];const budget=new AnalysisWorkBudget();
  const raw=[parser.analyze(unit.sourceUri,source,true,{expandMacros:true,propagateCallbacks:false})];
  const input=await new BuildAnalysis().prepare(parser,raw,profile,budget);
  const derived=parser.derive(input,undefined,undefined,false,{workBudget:budget});
  assert.ok(derived.some(file=>file.callbackRegistrations?.some(ref=>ref.name==='handler'&&ref.callKind==='registered')));
  assert.equal(budget.usage().callbacks,0);
  assert.ok(derived.every(file=>!file.references.some(ref=>ref.callKind==='inferred')));
});
test('forced headers are visible and macro-only inputs do not add C definitions',async()=>{
  const {raw,profile}=await fixture();
  const main=raw.find(file=>file.uri.endsWith('/a.c'))!,unit=profile.units[0];
  const source=parser.analyze(main.uri,'void run_a(void){invoke();}',true,main.analysisPolicy);
  unit.forcedInputs=[{kind:'header',uri:'file:///p/inc/ops.h'}];profile.units=[unit];
  const input=await new BuildAnalysis().prepare(parser,raw.map(file=>file===main?source:file),profile,new AnalysisWorkBudget());
  const index=new RelationIndex();parser.derive(input).forEach(file=>index.update(file));
  const run=index.symbols().find(s=>s.name==='run_a')!;
  assert.deepEqual(index.relations(run.id,'callees').map(group=>group.name),['invoke']);
  unit.forcedInputs=[{kind:'macros',uri:'file:///p/inc/ops.h'}];
  const macroOnly=await new BuildAnalysis().prepare(parser,raw.map(file=>file===main?source:file),profile,new AnalysisWorkBudget());
  assert.ok(!macroOnly.some(file=>file.symbols.some(s=>s.name==='invoke'&&s.definition)));
});
test('unavailable build dependencies remain explicit uncertainty on inferred targets',async()=>{
  const source='#include "missing.h"\ntypedef void(*CB)(void);void target(void){}CB cb=target;void run(void){cb();}';
  const {profile}=await fixture(),f=buildFixture({'a.c':source});
  const unit=await normalizeCompileContext({profileId:'A',sourceUri:'file:///p/a.c',cwdUri:'file:///p',argv:['gcc','-c','a.c'],dialect:'posix',evidence:[]},f.fs);profile.units=[unit];
  const input=await new BuildAnalysis().prepare(parser,[parser.analyze(unit.sourceUri,source,true,{expandMacros:true,propagateCallbacks:true})],profile,new AnalysisWorkBudget());
  const derived=parser.derive(input),inferred=derived.flatMap(file=>file.references).filter(ref=>ref.callKind==='inferred');
  assert.ok(inferred.length);assert.ok(inferred.every(ref=>ref.inference?.incomplete));
});
test('Windows encoded drive URIs match absolute compiler include paths without changing navigation URIs',async()=>{
  const uri='file:///c%3A/Project/main.c',header='file:///c%3A/Project/Inc/ops.h';
  const raw=[parser.analyze(uri,'#include <ops.h>\nvoid run(void){CALL();}',true,{expandMacros:true,propagateCallbacks:true}),parser.analyze(header,'#define CALL() target()\nstatic void target(void){}',true,{expandMacros:true,propagateCallbacks:true})];
  const {profile}=await fixture(),f=buildFixture({});
  const unit=await normalizeCompileContext({profileId:'A',sourceUri:uri,cwdUri:'file:///c%3A/Project',argv:['gcc','-IC:\\Project\\Inc','-c','main.c'],dialect:'windows',evidence:[]},f.fs);profile.units=[unit];
  const input=await new BuildAnalysis().prepare(parser,raw,profile,new AnalysisWorkBudget());
  const derived=parser.derive(input),main=derived.find(file=>file.uri===uri)!;
  assert.ok(derived.some(file=>file.uri===header));assert.ok(main.references.some(ref=>ref.callKind==='expanded'&&ref.name==='target'));
  assert.ok(main.references.every(ref=>ref.location.uri===uri));
});
test('real contextual raw and derived facts restore after reopening and reject an edited source',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'dynsight-context-restart-')),original=parser.analyze;
  try{
    const {raw,profile}=await fixture(),first=new BuildAnalysis();await first.setCache(directory,profile.fingerprint);
    const input=await first.prepare(parser,raw,profile,new AnalysisWorkBudget()),derived=parser.derive(input);await first.save(input,derived);
    const second=new BuildAnalysis();await second.setCache(directory,profile.fingerprint);let parses=0;
    parser.analyze=(...args)=>{parses++;return original(...args);};
    const restored=await second.prepare(parser,raw,profile,new AnalysisWorkBudget());
    assert.equal(parses,0);assert.ok(second.cachedDerived(restored));
    const changed=raw.map(file=>file.uri.endsWith('/a.c')?original(file.uri,file.text+'\nvoid fresh(void){}',true,file.analysisPolicy):file);
    const updated=await second.prepare(parser,changed,profile,new AnalysisWorkBudget());
    assert.ok(parses>0);assert.equal(second.cachedDerived(updated),undefined);assert.ok(updated.some(file=>file.symbols.some(s=>s.name==='fresh')));
  }finally{parser.analyze=original;await rm(directory,{recursive:true,force:true});}
});

test('saving build facts rewrites changed records and reuses unrelated records on disk', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dynsight-build-reuse-'));
  try {
    const build = new BuildAnalysis(); await build.setCache(directory, 'A');
    const a = parser.analyze('file:///a.c', 'int alpha(void){return 1;}'), b = parser.analyze('file:///b.c', 'int beta(void){return 2;}');
    const before = parser.derive([a, b]); assert.equal((await build.save([a, b], before))?.saved, true);
    const previous = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
    const changed = parser.analyze(a.uri, 'int alpha(void){return 3;}'), next = parser.derive([changed, b]);
    assert.equal(next[1], before[1], 'the unrelated derived result is reusable');
    assert.equal((await build.save([changed, b], next))?.saved, true);
    const current = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
    const oldEntry = previous.entries.find((entry: { uri: string }) => entry.uri === b.uri), newEntry = current.entries.find((entry: { uri: string }) => entry.uri === b.uri);
    assert.equal(newEntry.digest, oldEntry.digest);
    assert.equal((await stat(path.join(directory, previous.generation, oldEntry.name))).ino,
      (await stat(path.join(directory, current.generation, newEntry.name))).ino, 'unchanged build facts use the existing record instead of serializing it again');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('GCC and Diab build contexts preserve short-circuit callback alternatives across refreshes', async () => {
  for(const compiler of ['gcc','dcc']) {
    const make=(mode:number)=>`CC=${compiler}\na.o: a.c\n\t$(CC) -DMODE=${mode} -c $<`;
    const source='typedef void(*CB)(void);void first(void){}void second(void){}void third(void){}\n#if MODE==1\n#define TARGET second\n#else\n#define TARGET third\n#endif\nvoid run(int enabled){CB cb=first;enabled && (cb=TARGET);cb();}';
    const f=buildFixture({Makefile:make(1),'a.c':source});
    const raw=[parser.analyze('file:///p/a.c',source,true,{expandMacros:true,propagateCallbacks:true})];
    const entry={id:'short-circuit',rootUri:'file:///p',entryUri:'file:///p/Makefile',cwdUri:'file:///p',dialect:'make' as const,args:[],evidence:[]};
    const build=new BuildAnalysis();
    for(const mode of [1,1,2]) {
      f.texts.set('file:///p/Makefile',make(mode));
      const profile=await extractStaticBuildOptions(f.fs,entry,['file:///p/a.c'],{});
      const prepared=await build.prepare(parser,raw,profile,new AnalysisWorkBudget()),index=new RelationIndex();
      parser.derive(prepared).forEach(file=>index.update(file));
      const run=index.symbols().find(s=>s.name==='run'&&s.definition)!;
      assert.deepEqual(index.relations(run.id,'callees').filter(r=>r.callKind==='inferred').map(r=>r.name).sort(),['first',mode===1?'second':'third']);
    }
  }
});
