import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createAnalyzer } from '../src/analyzer';
import { BuildAnalysis } from '../src/build-analysis';
import { BuildProfile, normalizeCompileContext } from '../src/build-context';
import { RelationIndex } from '../src/relations';
import { AnalysisWorkBudget } from '../src/analysis-budget';
import { IncrementalAnalysis } from '../src/incremental-analysis';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { buildFixture } from './build-fixtures';

let parser: Awaited<ReturnType<typeof createAnalyzer>>;
before(async () => { parser = await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'), path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm')); });
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
