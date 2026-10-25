import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createAnalyzer } from '../src/analyzer';
import { RelationIndex } from '../src/relations';
import { MacroExpander } from '../src/macro-expansion';
import { tokenizeC, locationIn } from '../src/c-tokens';
import { outsideBranches } from '../src/preprocessor-branches';

let analyzer: Awaited<ReturnType<typeof createAnalyzer>>;
before(async () => { analyzer = await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'), path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm')); });
function project(sources: Record<string, string>) {
  const files = Object.entries(sources).map(([name, text]) => analyzer.analyze('file:///demo/' + name, text));
  const index = new RelationIndex();
  for (const file of analyzer.derive(files)) index.update(file);
  return index;
}
const calls = (index: RelationIndex, name = 'run') => index.relations(index.symbols().find(s => s.name === name && s.kind === 'function' && s.definition)!.id, 'callees');

test('conditional redefinitions retain exactly the old definition outside the update',()=>{
  const states=Array.from({length:27},(_,n)=>['A','B','C'].flatMap((key,i)=>{
    const value=Math.floor(n/3**i)%3;return value?[{key,value:value===2,condition:key}]:[];
  }));
  for(const current of states)for(const update of states){
    const outside=outsideBranches(current,update);
    for(let assignment=0;assignment<8;assignment++){
      const matches=(branches:typeof current)=>branches.every(branch=>branch.value===!!(assignment&(1<<['A','B','C'].indexOf(branch.key))));
      assert.equal(outside.some(matches),matches(current)&&!matches(update));
    }
  }
});

test('repeated conditional macro choices do not generate contradictory alternatives', () => {
  const source='#if BOARD\n#define PICK() first()\n#else\n#define PICK() second()\n#endif\nvoid first(void){}void second(void){}void run(void){'+'PICK();'.repeat(6)+'}';
  const index=project({'repeated.c':source});
  assert.ok([...index.files.values()].every(file=>!file.issues.some(issue=>/alternative limit/.test(issue))));
  assert.deepEqual(calls(index).map(group=>group.name).sort(),['first','second']);
  assert.ok(calls(index).every(group=>!group.sites.some(site=>site.conditions.includes('#if BOARD')&&site.conditions.includes('else of #if BOARD'))));
  const definitions=analyzer.analyze('file:///choices.c',source).preprocessor!.flatMap(event=>event.kind==='define'?[event.macro]:[]);
  const expander=new MacroExpander(name=>definitions.filter(macro=>macro.name===name).map(macro=>({macro,branches:macro.branches??[]})));
  const input='PICK();'.repeat(6);
  assert.equal(expander.expand(tokenizeC(input,locationIn(input,'file:///choices.c'))).length,2);
});

test('43 uses of one conditional numeric constant need only two reparses, including the undefined path',async()=>{
  const parser=await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'),path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm'));
  const source='#if FEATURE\n#define MACRO_0052 1\n#endif\nvoid sink(int);void run(void){'+'sink(MACRO_0052);'.repeat(43)+'}';
  const raw=parser.analyze('file:///repeated-constant.c',source),calls=parser.calls;let reparses=0;
  parser.calls=(...args)=>{reparses++;return calls(...args);};
  const [result]=parser.derive([raw]);
  assert.equal(raw.programs?.length,1);
  assert.equal(reparses,2);
  assert.equal(result.programs?.length,2);
  assert.ok(!result.issues.some(issue=>/alternative limit/.test(issue)));
  for(const program of result.programs!){
    const kinds=new Set(program.body.flatMap(statement=>statement.kind==='expression'&&statement.value.kind==='call'?statement.value.args.map(arg=>arg.kind):[]));
    assert.equal(kinds.size,1,'each program must keep a consistent defined or undefined choice at all 43 sites');
  }
  parser.derive([raw]);assert.equal(reparses,2,'warm analysis does not reparse unchanged alternatives');
});

test('repeated numeric macro indices preserve their correlated callback targets',()=>{
  const source='#if BOARD\n#define PICK 0\n#else\n#define PICK 1\n#endif\ntypedef void(*CB)(void);void first(void){}void wrongA(void){}void wrongB(void){}void last(void){}void run(void){CB table[2][2]={{first,wrongA},{wrongB,last}};table[PICK][PICK]();}';
  const index=project({'numeric-indices.c':source});
  assert.deepEqual(calls(index).filter(group=>group.callKind==='inferred').map(group=>group.name).sort(),['first','last']);
});
test('conditional programs share unchanged immutable statements without merging variant choices or local identities',()=>{
  const source='#if BOARD\n#define PICK 0\n#else\n#define PICK 1\n#endif\nint result;void sink(int);void target(void){}void run(void){result=7;int local=PICK;sink(local);}';
  const raw=analyzer.analyze('file:///shared-ir.c',source),[result]=analyzer.derive([raw]);
  const id=raw.symbols.find(symbol=>symbol.name==='run')!.id;
  const programs=result.programs!.filter(program=>program.id===id);
  assert.equal(programs.length,2);
  assert.equal(programs[0].body[0],programs[1].body[0],'unchanged statements reuse the same immutable structure');
  assert.notEqual(programs[0].body[1],programs[1].body[1],'alternative assignments remain separate');
  assert.notEqual(programs[0].locals[0].id,programs[1].locals[0].id,'variant local storage remains isolated');
});

test('equivalent expansion states merge only when token provenance also agrees',()=>{
  const raw=analyzer.analyze('file:///origin.c','#define PICK() target()\n'),macro=raw.preprocessor!.flatMap(event=>event.kind==='define'?[event.macro]:[])[0];
  const input='PICK();',tokens=tokenizeC(input,locationIn(input,'file:///use.c'));
  const expand=(other:typeof macro)=>new MacroExpander(name=>name==='PICK'?[{macro,branches:[]},{macro:other,branches:[]}]:[]).expand(tokens);
  assert.equal(expand(macro).length,1);
  assert.equal(expand({...macro,location:{...macro.location,uri:'file:///other-origin.c'}}).length,2);
});

test('ambiguous include candidates preserve every header definition', () => {
  const index=project({'main.c':'#include "choice.h"\nvoid first(void){}void second(void){}void run(void){PICK();}', 'a/choice.h':'#define PICK() first()', 'b/choice.h':'#define PICK() second()'});
  assert.deepEqual(calls(index).map(group=>group.name).sort(),['first','second']);
});
test('multiple macros from seven header candidates retain mutually exclusive choices',()=>{
  const targets=Array.from({length:7},(_,a)=>Array.from({length:7},(_,b)=>`void f${a}_${b}(void){}`).join('')).join('');
  const sources:Record<string,string>={'main.c':'#define JOIN_(a,b) a##b\n#define JOIN(a,b) JOIN_(a,b)\n#include "choice.h"\n'+targets+'void run(void){JOIN(A,B)();}'};
  for(let n=0;n<7;n++)sources[`header${n}/choice.h`]=`#define A f${n}_\n#define B ${n}`;
  const index=project(sources);
  assert.deepEqual(calls(index).map(group=>group.name).sort(),Array.from({length:7},(_,n)=>`f${n}_${n}`));
  assert.ok([...index.files.values()].every(file=>!file.issues.some(issue=>/alternative limit/.test(issue))));
});
test('macro expansion retains split conditional statements and callback paths',()=>{
  for(const prefix of ['#if BOARD\nif(guard){SET(second);} else\n#endif\n{SET(third);}', '#if BOARD\nif(guard)\n#else\nif(other)\n#endif\n{SET(second);}']){
    const source='#define SET(value) cb=value\ntypedef void(*CB)(void);void first(void){}void second(void){}void third(void){}void run(int guard,int other){CB cb=first;\n'+prefix+'\ncb();}';
    const index=project({'split-macro.c':source});
    assert.ok([...index.files.values()].every(file=>!file.issues.some(issue=>/syntax|missing/.test(issue))));
    const targets=calls(index).filter(group=>group.callKind==='inferred').map(group=>group.name).sort();
    assert.deepEqual(targets,prefix.includes('else\n#endif')?['second','third']:['first','second']);
  }
});

test('different macros and argument prescan share one conditional choice', () => {
  const source='#define WRAP(x,y) x;y\n#if BOARD\n#define A() first()\n#define B() first()\n#else\n#define A() second()\n#define B() second()\n#endif\nvoid first(void){}void second(void){}void run(void){'+'WRAP(A(),B());'.repeat(6)+'}';
  const index=project({'arguments.c':source});
  assert.ok([...index.files.values()].every(file=>!file.issues.some(issue=>/alternative limit/.test(issue))));
  assert.deepEqual(calls(index).map(group=>group.name).sort(),['first','second']);
});

test('unchanged condition environments correlate separate directive groups',()=>{
  const definitions=Array.from({length:6},(_,n)=>`#if BOARD\n#define M${n}() first()\n#else\n#define M${n}() second()\n#endif\n`).join('');
  const source=definitions+'void first(void){}void second(void){}void run(void){'+Array.from({length:6},(_,n)=>`M${n}();`).join('')+'}';
  const raw=analyzer.analyze('file:///separate-groups.c',source),cold=analyzer.derive([raw]),warm=analyzer.derive([raw]);
  assert.ok(!cold[0].issues.some(issue=>/alternative limit/.test(issue)));
  assert.equal(warm[0],cold[0],'warm analysis reuses the same bounded expansion');
});

test('genuinely independent conditions still report the 32-alternative bound',()=>{
  const definitions=Array.from({length:6},(_,n)=>`#if BOARD${n}\n#define M${n}() first()\n#else\n#define M${n}() second()\n#endif\n`).join('');
  const source=definitions+'void first(void){}void second(void){}void run(void){'+Array.from({length:6},(_,n)=>`M${n}();`).join('')+'}';
  const [result]=analyzer.derive([analyzer.analyze('file:///independent-groups.c',source)]);
  assert.ok(result.issues.some(issue=>/alternative limit/.test(issue)));
});

for(const alias of ['#define BOARD FEATURE\n', '#define ENABLED(x) (x)\n#define BOARD ENABLED(FEATURE)\n'])
  test(`unchanged transitive condition dependencies share alternatives: ${alias.trim()}`,()=>{
    const definitions=Array.from({length:6},(_,n)=>`#if BOARD\n#define M${n}() first()\n#else\n#define M${n}() second()\n#endif\n`).join('');
    const source=alias+definitions+'void first(void){}void second(void){}void run(void){'+Array.from({length:6},(_,n)=>`M${n}();`).join('')+'}';
    const raw=analyzer.analyze('file:///alias-groups.c',source),[result]=analyzer.derive([raw]);
    const id=raw.symbols.find(symbol=>symbol.name==='run')!.id;
    assert.ok(!result.issues.some(issue=>/alternative limit/.test(issue)));
    assert.equal(result.programs!.filter(program=>program.id===id).length,2);
    const index=new RelationIndex();index.update(result);
    assert.deepEqual(calls(index).map(group=>group.name).sort(),['first','second']);
    assert.equal(analyzer.derive([raw])[0],result);
  });

test('alias condition correlation preserves callback pairs and invalidates after header edits',()=>{
  const source='#include "flags.h"\n#if BOARD\n#define ROW 0\n#else\n#define ROW 1\n#endif\n#if BOARD\n#define COL 0\n#else\n#define COL 1\n#endif\n'+
    'typedef void(*CB)(void);void first(void){}void crossA(void){}void crossB(void){}void last(void){}void run(void){CB table[2][2]={{first,crossA},{crossB,last}};table[ROW][COL]();}';
  const raw=analyzer.analyze('file:///alias-pairs/main.c',source);
  for(const [body,expected] of [
    ['#define BOARD FEATURE\n',['first','last']],
    ['#define BOARD __COUNTER__\n',['crossA','crossB','first','last']],
    ['#define BOARD FEATURE\n',['first','last']]
  ] as const){
    const header=analyzer.analyze('file:///alias-pairs/flags.h',body);
    const result=analyzer.derive([raw,header]),index=new RelationIndex();result.forEach(file=>index.update(file));
    assert.deepEqual(calls(index).filter(group=>group.callKind==='inferred').map(group=>group.name).sort(),expected);
    assert.ok(result.every(file=>!file.issues.some(issue=>/limit|budget/.test(issue))));
  }
});

test('unused conditional definitions do not consume expansion alternatives',()=>{
  const definitions=Array.from({length:40},(_,n)=>`#if FLAG${n}\n#define UNUSED ${n}\n#endif\n`).join('');
  const index=project({'unused.c':definitions+'void target(void){}void run(void){target();}'});
  assert.ok([...index.files.values()].every(file=>!file.issues.some(issue=>/alternative limit/.test(issue))));
  assert.deepEqual(calls(index).map(group=>group.name),['target']);
});

test('unindexed includes keep later condition environments independent',()=>{
  const source='#define JOIN_(a,b) a##b\n#define JOIN(a,b) JOIN_(a,b)\n#if BOARD\n#define A first\n#else\n#define A second\n#endif\n#include "unavailable.h"\n#if BOARD\n#define B One\n#else\n#define B Two\n#endif\nvoid firstOne(void){}void firstTwo(void){}void secondOne(void){}void secondTwo(void){}void run(void){JOIN(A,B)();}';
  const index=project({'unknown-include.c':source});
  assert.deepEqual(calls(index).map(group=>group.name).sort(),['firstOne','firstTwo','secondOne','secondTwo']);
});

test('changed or opaque condition dependencies are not treated as an unchanged build choice',()=>{
  for(const [prefix,between,condition] of [
    ['#define BOARD 1\n','#undef BOARD\n#define BOARD 0\n','BOARD'],
    ['#define BOARD FLAG\n','#define FLAG 0\n','BOARD'],
    ['#define BOARD ENABLED\n#define ENABLED FLAG\n','#define FLAG 0\n','BOARD'],
    ['#define BOARD FLAG\n','#if CHANGE\n#undef FLAG\n#define FLAG 0\n#endif\n','BOARD'],
    ['#define JOIN_(a,b) a##b\n#define BOARD JOIN_(FLAG,_VALUE)\n','#define FLAG_VALUE 0\n','BOARD'],
    ['#define BOARD __COUNTER__\n','','BOARD'],
    ['','','__COUNTER__'],
    ['','#pragma pop_macro("BOARD")\n','BOARD']
  ]){
    const source=prefix+'#define JOIN_(a,b) a##b\n#define JOIN(a,b) JOIN_(a,b)\n'+`#if ${condition}\n#define A first\n#else\n#define A second\n#endif\n`+between+`#if ${condition}\n#define B One\n#else\n#define B Two\n#endif\n`+'void firstOne(void){}void firstTwo(void){}void secondOne(void){}void secondTwo(void){}void run(void){JOIN(A,B)();}';
    const index=project({'changed-condition.c':source});
    assert.deepEqual(calls(index).map(group=>group.name).sort(),['firstOne','firstTwo','secondOne','secondTwo']);
  }
});

test('conditional undef and later redefinitions preserve the complementary definition', () => {
  const source='#define PICK() first()\n#if BOARD\n#undef PICK\n#define PICK() second()\n#endif\nvoid first(void){}void second(void){}void third(void){}void run(void){PICK();\n#undef PICK\n#define PICK() third()\nPICK();}';
  const index=project({'redefined.c':source});
  assert.deepEqual(calls(index).map(group=>group.name).sort(),['first','second','third']);
  const third=calls(index).find(group=>group.name==='third')!;
  assert.ok(third.sites.every(site=>site.location.start===source.lastIndexOf('PICK();')));
});

test('complementary condition paths do not duplicate a macro definition reference',()=>{
  const index=project({'definition-reference.c':'#define PICK() first()\n#if A\n#if B\n#define PICK() second()\n#endif\n#endif\nvoid first(void){}void second(void){}void run(void){PICK();}'});
  const reference=[...index.files.values()].flatMap(file=>file.references).find(ref=>ref.name==='PICK'&&ref.macroIds?.length)!;
  assert.equal(reference.macroIds!.length,2);
  assert.equal(new Set(reference.macroIds).size,2);
});

test('Stop interrupts macro expansion without retaining a cancelled macro cache', () => {
  const text = '#define CALL target()\nvoid target(void){}void run(void){' + 'CALL;'.repeat(800) + '}';
  const raw = analyzer.analyze('file:///manual-stop/macros.c', text);
  let checks = 0;
  const stopped = analyzer.derive([raw], undefined, undefined, true, { shouldCancel: () => ++checks > 8 });
  assert.ok(stopped[0].issues.some(issue => issue.startsWith('Macro analysis cancelled')));
  assert.ok(stopped[0].callbackDiagnostics?.some(detail => detail.kind === 'cancelled'));
  const retried = analyzer.derive([raw]);
  assert.ok(!retried[0].issues.some(issue => /cancelled/.test(issue)));
  assert.ok(retried[0].references.some(ref => ref.kind === 'call' && ref.name === 'target' && ref.callKind === 'expanded'));
});

test('expanded local declarations with GNU attributes retain callback initialization and source mapping', () => {
  const source = '#define LOCAL static struct Ops slot __attribute__((section(".data")))={target}\n' +
    'struct Ops{void(*cb)(void);};void target(void){}void run(void){LOCAL;slot.cb();}';
  const index = project({ 'attribute.c': source });
  assert.ok([...index.files.values()].every(file => file.issues.length === 0));
  const target = calls(index).find(group => group.name === 'target' && group.callKind === 'inferred');
  assert.ok(target);
  assert.ok(target.sites.every(site => site.location.start === source.indexOf('slot.cb()')));
});

test('disabled callback analysis skips initializer expansion while toggles retain ordinary macro and argument relations', () => {
  const text = '#define CHOSEN target\n#define INVOKE() direct();submit(target)\n' +
    'typedef void(*CB)(void);void target(void){}void direct(void){}void submit(CB cb){}' +
    'static CB saved=CHOSEN;void run(void){static CB local=CHOSEN;saved();local();INVOKE();}';
  const raw = [analyzer.analyze('file:///demo/initializer-mode.c', text)];
  const rawInitializers = raw[0].initializers, parseInitializer = analyzer.initializer;
  let parsed = 0;
  analyzer.initializer = (...args) => { parsed++; return parseInitializer(...args); };
  try {
    for (const enabled of [false, true, false, true]) {
      const before = parsed, files = analyzer.derive(raw, undefined, undefined, enabled), index = new RelationIndex();
      files.forEach(file => index.update(file));
      assert.equal(parsed > before, enabled, 'only enabled inference expands initializer expressions');
      assert.equal(calls(index).some(group => group.name === 'target' && group.callKind === 'inferred'), enabled);
      assert.ok(calls(index).some(group => group.name === 'direct' && group.callKind === 'expanded'));
      assert.ok(files[0].functionArguments?.some(ref => ref.name === 'target' && !ref.argument?.inferred));
      assert.ok(files[0].references.some(ref => ref.name === 'saved'), 'ordinary variable references remain');
      if (!enabled) assert.equal(files[0].initializers?.length ?? 0, 0, 'expanded static/local initializer IR is not retained');
      assert.equal(raw[0].initializers, rawInitializers, 'raw initializer facts remain available for re-enabling');
      const after = parsed;
      assert.equal(analyzer.derive(raw, undefined, undefined, enabled)[0], files[0], 'unchanged mode reuses its derived result');
      assert.equal(parsed, after);
    }
  } finally { analyzer.initializer = parseInitializer; }
});

test('selected sources expand unchecked header macros while unchecked bodies retain source relations', () => {
  const sources = {
    'SDK/api.h': '#define API() target()\nvoid plain(void);void svc(void (*cb)(void));',
    'SDK/vendor.c': '#include "api.h"\nvoid target(void){}void changed(void){}void callback(void){}void vendor(void){API();plain();svc(callback);void(*p)(void)=callback;p();}',
    'App/main.c': '#include "../SDK/api.h"\nvoid app(void){API();vendor();}'
  };
  const raw = Object.entries(sources).map(([name,text]) => ({...analyzer.analyze('file:///demo/'+name,text),expandMacros:name.startsWith('App/')}));
  const derived = analyzer.derive(raw), index = new RelationIndex();
  derived.forEach(file => index.update(file));
  const vendor = derived.find(file => file.uri.endsWith('/vendor.c'))!;
  assert.equal(vendor.references.some(ref => ref.expansion),false,'unchecked bodies must not expand');
  assert.ok(calls(index,'app').some(group => group.name==='target' && group.callKind==='expanded'));
  assert.ok(calls(index,'vendor').some(group => group.name==='plain' && group.callKind==='direct'));
  assert.ok(vendor.functionArguments?.some(ref => ref.name==='callback'),'literal arguments remain');
  assert.ok(calls(index,'vendor').some(group => group.name==='callback' && group.callKind==='inferred'),'ordinary pointer inference remains');
  const updated = raw.map(file => file.uri.endsWith('/api.h') ? {...analyzer.analyze(file.uri,sources['SDK/api.h'].replace('target()','changed()')),expandMacros:false} : file);
  const changed = new RelationIndex(); analyzer.derive(updated).forEach(file => changed.update(file));
  assert.ok(calls(changed,'app').some(group => group.name==='changed' && group.callKind==='expanded'));
  assert.equal(calls(changed,'app').some(group => group.name==='target'),false);
  const enabled = new RelationIndex(); analyzer.derive(raw.map(file=>({...file,expandMacros:true}))).forEach(file=>enabled.update(file));
  assert.ok(calls(enabled,'vendor').some(group=>group.name==='target' && group.callKind==='expanded'));
  const disabled = analyzer.derive(raw);
  assert.equal(disabled.find(file=>file.uri.endsWith('/vendor.c'))!.references.some(ref=>ref.expansion),false);
});

test('disabled macro expansion skips expensive include traversal and keeps basic calls', () => {
  const sources: Record<string,string> = {'main.c':'#define CALL() target()\n#include "h18.h"\nvoid target(void){}void run(void){CALL();target();}','h0.h':''};
  for(let n=1;n<=18;n++) sources[`h${n}.h`]=`#include "h${n-1}.h"\n#include "h${n-1}.h"\n`;
  const raw=Object.entries(sources).map(([name,text])=>({...analyzer.analyze('file:///demo/'+name,text),expandMacros:false}));
  const disabled=analyzer.derive(raw), index=new RelationIndex();disabled.forEach(file=>index.update(file));
  assert.equal(disabled[0].issues.some(issue=>/Macro include/.test(issue)),false);
  assert.ok(calls(index).some(group=>group.name==='target' && group.callKind==='direct'));
  assert.equal(disabled[0].references.some(ref=>ref.expansion),false);
  const enabled=analyzer.derive(raw.map(file=>({...file,expandMacros:true})));
  assert.ok(enabled[0].issues.some(issue=>/Macro include.*limit/.test(issue)));
});

test('memory-limited preprocessing retains source arguments and retries when pressure clears', () => {
  const raw = [analyzer.analyze('file:///demo/memory.c', '#define SUBMIT(cb) svc(cb)\nvoid target(void){}void svc(void (*)(void));void run(void){SUBMIT(target);}')];
  const partial = analyzer.derive(raw, () => true);
  assert.ok(partial[0].issues.some(issue => /memory budget/.test(issue)));
  assert.ok(partial[0].functionArguments?.some(ref => ref.name === 'target' && ref.inference?.incomplete));
  assert.equal(partial[0].references.some(ref => ref.expansion), false);
  assert.equal(analyzer.derive(raw, () => true)[0], partial[0], 'unchanged limited results reuse identity');
  const recovered = analyzer.derive(raw, () => false);
  assert.equal(recovered[0].issues.some(issue => /memory budget/.test(issue)), false);
  assert.ok(recovered[0].references.some(ref => ref.name === 'svc' && ref.expansion));
});

test('include traversal is bounded even when repeated headers produce no macro events', () => {
  const sources: Record<string, string> = { 'main.c': '#include "h18.h"\nvoid target(void){} void run(void){target();}', 'h0.h': '' };
  for (let n = 1; n <= 18; n++) sources[`h${n}.h`] = `#include "h${n-1}.h"\n#include "h${n-1}.h"\n`;
  const index = project(sources), file = index.files.get('file:///demo/main.c')!;
  assert.ok(file.issues.some(issue => /Macro include.*limit/.test(issue)));
  const target = calls(index).find(group => group.name === 'target'); assert.ok(target);
  assert.ok(target.sites.every(site => site.ambiguous && site.inference?.incomplete));
});

test('incomplete include environments retain source calls without fabricated expansions', () => {
  const sources: Record<string, string> = { 'main.c': '#define CALL() stale_target()\n#include "h18.h"\n#undef CALL\n#define CALL() actual_target()\nvoid stale_target(void){}void actual_target(void){}void run(void){CALL();}', 'h0.h': '' };
  for (let n = 1; n <= 18; n++) sources[`h${n}.h`] = `#include "h${n-1}.h"\n#include "h${n-1}.h"\n`;
  const index = project(sources), file = index.files.get('file:///demo/main.c')!;
  assert.ok(file.issues.some(issue => /Macro include.*limit/.test(issue)));
  assert.equal(file.references.some(ref => ref.expansion), false);
  assert.ok(file.references.some(ref => ref.name === 'CALL' && ref.kind === 'call' && ref.inference?.incomplete));
});

test('limited include results reuse cache identity and recover after header edits', () => {
  const sources: Record<string, string> = { 'main.c': '#define CALL() target()\n#include "h18.h"\nvoid target(void){}void run(void){CALL();}', 'h0.h': '' };
  for (let n = 1; n <= 18; n++) sources[`h${n}.h`] = `#include "h${n-1}.h"\n#include "h${n-1}.h"\n`;
  const raw = Object.entries(sources).map(([name, text]) => analyzer.analyze('file:///demo/' + name, text));
  const limited = analyzer.derive(raw);
  assert.ok(limited[0].issues.some(issue => /Macro include.*limit/.test(issue)));
  assert.equal(analyzer.derive(raw)[0], limited[0]);
  const edited = raw.map(file => file.uri.endsWith('/h18.h') ? analyzer.analyze(file.uri, '') : file);
  const recovered = analyzer.derive(edited)[0];
  assert.equal(recovered.issues.some(issue => /Macro include.*limit/.test(issue)), false);
  assert.ok(recovered.references.some(ref => ref.name === 'target' && ref.expansion));
});

test('existing include-depth limits preserve previously supported macro expansions', () => {
  const sources: Record<string, string> = { 'main.c': '#define CALL() target()\n#include "h65.h"\nvoid target(void){}void run(void){CALL();}', 'h0.h': '' };
  for (let n = 1; n <= 65; n++) sources[`h${n}.h`] = `#include "h${n-1}.h"\n`;
  const index = project(sources), file = index.files.get('file:///demo/main.c')!;
  assert.ok(file.issues.some(issue => /Macro include\/event limit/.test(issue)));
  assert.ok(calls(index).some(group => group.name === 'target' && group.callKind === 'expanded'));
});

test('source sorting interleaves expanded, direct and inferred calls at their original sites', () => {
  const source = '#define EARLY() zulu()\ntypedef void (*CB)(void); void alpha(void){} void beta(void){} void zulu(void){} void run(void){EARLY();beta();CB cb=alpha;cb();zulu();EARLY();}';
  const index = project({ 'main.c': source });
  const run = index.symbols().find(s => s.name === 'run')!;
  const groups = index.relations(run.id, 'callees', 'all', 'source');
  assert.deepEqual(groups.map(g => g.name), ['zulu', 'beta', 'alpha']);
  assert.deepEqual(groups[0].sites.map(s => s.location.start), [source.indexOf('EARLY();'), source.indexOf('zulu();'), source.lastIndexOf('EARLY();')]);
  assert.equal(groups[2].callKind, 'inferred');
});

test('macro expansion creates outgoing and incoming calls at the original invocation', () => {
  const source = '#define CALL(x) foo(x)\nvoid foo(int x){} void run(void){CALL(1);}';
  const index = project({ 'main.c': source });
  const call = calls(index).find(g => g.name === 'foo')!;
  assert.ok(call); assert.equal(call.callKind, 'expanded');
  assert.equal(call.sites[0].location.start, source.indexOf('CALL(1)'));
  assert.equal(call.sites[0].expansion!.chain[0].name, 'CALL');
  assert.equal(index.relations(call.symbol!.id, 'callers')[0].name, 'run');
});
test('nested macros, aliases and repeated invocation sites expand without duplicate raw calls', () => {
  const source = '#define INNER(x) foo(x)\n#define OUTER(x) INNER(x)\n#define ALIAS OUTER\nvoid foo(int x){} void run(void){ALIAS(1);OUTER(2);}';
  const index = project({ 'main.c': source });
  const call = calls(index).find(g => g.name === 'foo')!;
  assert.equal(call.sites.length, 2);
  assert.equal(call.sites[0].expansion!.chain.map(s => s.name).join(' → '), 'ALIAS → OUTER → INNER');
});
test('discarded, stringized and unevaluated macro arguments are not executed calls', () => {
  const source = '#define IGNORE(x) 0\n#define STR(x) #x\n#define SIZE(x) sizeof(x)\n#define EXEC(x) sink(x)\nvoid foo(void){} void sink(int x){} void run(void){IGNORE(foo());STR(foo());SIZE(foo());EXEC(foo());}';
  const index = project({ 'main.c': source });
  const call = calls(index).find(g => g.name === 'foo')!;
  assert.equal(call.sites.length, 1);
  assert.equal(call.sites[0].location.start, source.lastIndexOf('foo()'));
  assert.ok(calls(index).some(g => g.name === 'sink'));
});

test('token pasting, stringizing, variadics and nested argument prescan follow C token rules', () => {
  const source = '#define CAT(a,b) a##b\n#define CALL(n, ...) CAT(do_,n)(__VA_ARGS__)\n#define LOG(...) sink(0 __VA_OPT__(,) __VA_ARGS__)\nvoid do_work(int x){} void sink(int x,...){} void run(void){CALL(work,1);LOG();LOG(2,3);}';
  const index = project({ 'main.c': source });
  assert.ok(calls(index).some(g => g.name === 'do_work'));
  assert.equal(calls(index).find(g => g.name === 'sink')!.sites.length, 2);
});
test('header definitions, undef and redefinitions obey source order', () => {
  const source = '#include "api.h"\nvoid run(void){CALL();}\n#undef CALL\n#define CALL() bar()\nvoid second(void){CALL();}';
  const index = project({ 'main.c': source, 'api.h': '#include "types.h"', 'types.h': '#define CALL() foo()\nvoid foo(void){} void bar(void){}' });
  assert.deepEqual(calls(index).map(g => g.name), ['foo']);
  assert.deepEqual(calls(index, 'second').map(g => g.name), ['bar']);
  const before = project({ 'main.c': 'void foo(void){} void run(void){CALL();}\n#define CALL() foo()' });
  assert.equal(calls(before).some(g => g.name === 'foo'), false);
});
test('multiline macros parse statements without inventing prototype or sizeof calls', () => {
  const source = '#define CALL() do { \\\n void declared(void); \\\n foo(); sizeof(hidden()); \\\n } while(0)\nvoid foo(void){} void run(void){CALL();}';
  const index = project({ 'main.c': source });
  assert.deepEqual(calls(index).map(g => g.name), ['foo']);
});
test('unknown macro branches remain candidates and inactive branches stay excluded', () => {
  const source = '#if BOARD\n#define CALL() foo()\n#else\n#define CALL() bar()\n#endif\nvoid foo(void){} void bar(void){} void run(void){CALL();\n#if 0\nCALL();hidden();\n#endif\n}';
  const index = project({ 'main.c': source });
  const known = calls(index).filter(g => ['foo','bar'].includes(g.name));
  assert.deepEqual(known.map(g => g.name).sort(), ['bar', 'foo']);
  assert.ok(known.every(g => g.sites.length === 1 && g.sites[0].conditions.length));
  assert.equal(calls(index).some(g => g.name === 'hidden'), false);
});
test('macro arguments retain nested comma expressions and comments or string literals do not call', () => {
  const source = '#define CALL(x) foo(x)\n#define TEXT "fake()" /* ghost() */\nvoid foo(int x){} void nested(int a,int b){} void run(void){CALL((nested(1,2),3));TEXT;}';
  const index = project({ 'main.c': source });
  assert.deepEqual(calls(index).map(g => g.name), ['foo','nested']);
});
test('self-recursive and mutually recursive macros terminate with explicit leaves', () => {
  const source = '#define A() B()\n#define B() A()\nvoid run(void){A();}';
  const index = project({ 'main.c': source });
  assert.equal(calls(index).length, 1);
  assert.equal(calls(index)[0].callKind, 'unresolved');
  assert.ok(calls(index)[0].sites[0].expansion);
});
test('re-derivation reflects header edits and removals without stale expanded targets', () => {
  const main = analyzer.analyze('file:///demo/main.c', '#include "api.h"\nvoid foo(void){} void bar(void){} void run(void){CALL();}');
  for (const name of ['foo','bar']) {
    const header = analyzer.analyze('file:///demo/api.h', `#define CALL() ${name}()`);
    const value = new RelationIndex(); for (const file of analyzer.derive([main, header])) value.update(file);
    assert.deepEqual(calls(value).map(g => g.name), [name]);
  }
  const value = new RelationIndex(); for (const file of analyzer.derive([main])) value.update(file);
  assert.equal(calls(value).some(g => ['foo','bar'].includes(g.name)), false);
});
test('ordinary include guards do not create exponential undefined macro alternatives', () => {
  const defines = Array.from({length: 8}, (_, n) => `#define M${n}() foo()`).join('\n');
  const source = '#include "api.h"\nvoid foo(void){} void run(void){' + Array.from({length: 8}, (_, n) => `M${n}();`).join('') + '}';
  const index = project({ 'main.c': source, 'api.h': '#ifndef API_H\n#define API_H\n' + defines + '\n#endif' });
  assert.equal(calls(index).find(g => g.name === 'foo')!.sites.length, 8);
  assert.ok([...index.files.values()].every(file => !file.issues.some(issue => /alternative limit/.test(issue))));
});
test('effective direct calls are not duplicated in References after unrelated macro expansion', () => {
  const source = '#define VALUE 1\nvoid foo(void){} void run(void){int x=VALUE;foo();}';
  const index = project({ 'main.c': source });
  const foo = index.symbols().find(s => s.name === 'foo' && s.definition)!;
  assert.equal(index.relations(foo.id, 'references')[0].sites.length, 1);
});
test('GNU variadic comma removal and exponential numeric literals remain valid expanded C', () => {
  const source = '#define LOG(fmt, ...) sink(fmt, ##__VA_ARGS__)\nvoid sink(int x,...){} void run(void){LOG(1);LOG(2,1e+3);}';
  const index = project({ 'main.c': source });
  assert.equal(calls(index).find(g => g.name === 'sink')!.sites.length, 2);
  assert.equal(index.files.get('file:///demo/main.c')!.issues.length, 0);
});
test('spliced strings containing a hash are not mistaken for directives', () => {
  const source = '#define CALL() foo()\nvoid foo(void){} void run(void){char *s="abc\\\n#fake()";CALL();}';
  const index = project({ 'main.c': source });
  assert.deepEqual(calls(index).map(g => g.name), ['foo']);
  assert.equal(index.files.get('file:///demo/main.c')!.issues.length, 0);
});
test('unchanged translation units reuse derived results when an unrelated file changes', () => {
  const main = analyzer.analyze('file:///demo/main.c', '#include "api.h"\nvoid foo(void){} void run(void){CALL();}');
  const header = analyzer.analyze('file:///demo/api.h', '#define CALL() foo()');
  const first = analyzer.derive([main, header, analyzer.analyze('file:///demo/other.c', 'void unrelated(void){}')]);
  const next = analyzer.derive([main, header, analyzer.analyze('file:///demo/other.c', 'void unrelated(void){missing();}')]);
  assert.equal(next[0], first[0]);
});
test('undefined and not-yet-defined macros do not mask real functions or become active leaves', () => {
  const source = '#define CALL foo\n#undef CALL\nvoid CALL(void){} void run(void){CALL();LATER();}\n#define LATER() foo()';
  const index = project({ 'main.c': source });
  assert.deepEqual(calls(index).map(g => [g.name,g.callKind]), [['CALL','direct'], ['LATER','unresolved']]);
});
test('unrelated translation-unit macro definitions do not resolve another files calls', () => {
  const index = project({ 'main.c': 'void run(void){OTHER();}', 'other.c': '#define OTHER() foo()\n' });
  assert.deepEqual(calls(index).map(g => [g.name,g.callKind]), [['OTHER','unresolved']]);
});
test('self-wrapping macros call the real same-named function after rescan suppression', () => {
  const source = 'void foo(int x){}\n#define foo(x) foo(x)\nvoid run(void){foo(1);}';
  const index = project({ 'main.c': source });
  assert.deepEqual(calls(index).map(g => [g.name,g.callKind]), [['foo','expanded']]);
});
test('source selection retains conditional macro definitions even when an unexpanded alternative remains', () => {
  const source = '#if BOARD\n#include "a.h"\n#else\n#include "b.h"\n#endif\nvoid run(void){READY();}';
  const index = project({ 'main.c': source, 'a.h': '#define READY() 1', 'b.h': '#define READY() 2' });
  assert.equal(index.resolveAt('file:///demo/main.c', source.indexOf('READY()')).length, 2);
});
test('bounded expansion reports a limit instead of silently claiming all targets', () => {
  const definitions = Array.from({length: 36}, (_, n) => `#define A${n}() ${n === 35 ? 'foo()' : `A${n + 1}()`}`).join('\n');
  const index = project({ 'main.c': definitions + '\nvoid foo(void){} void run(void){A0();}' });
  assert.ok(index.files.get('file:///demo/main.c')!.issues.some(issue => /Macro expansion limit/.test(issue)));
  assert.equal(calls(index).some(g => g.name === 'foo'), false);
});
