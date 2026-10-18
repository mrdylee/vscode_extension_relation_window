import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createAnalyzer } from '../src/analyzer';
import { RelationIndex } from '../src/relations';
import { inferPointerCalls } from '../src/pointer-targets';

let analyzer: Awaited<ReturnType<typeof createAnalyzer>>;
before(async () => { analyzer = await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'), path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm')); });
function project(sources: Record<string,string>) {
  const index = new RelationIndex();
  for (const file of analyzer.derive(Object.entries(sources).map(([name,text]) => analyzer.analyze('file:///demo/'+name,text)))) index.update(file);
  return index;
}
const prelude = 'typedef void (*CB)(void); void foo(void){} void bar(void){}\n';
const calls = (index: RelationIndex, name = 'run') => index.relations(index.symbols().find(s => s.name === name && s.kind === 'function' && s.definition)!.id, 'callees');
const inferred = (index: RelationIndex, name = 'run') => calls(index,name).filter(g => g.callKind === 'inferred');

test('callback memory pressure preserves literal arguments and retries propagation after recovery', () => {
  const raw = [analyzer.analyze('file:///demo/memory.c', prelude + 'void svc(CB);void run(void){CB fp=foo;svc(foo);fp();}')];
  const partial = inferPointerCalls(raw, () => true);
  assert.ok(partial[0].issues.some(issue => /Callback analysis memory budget/.test(issue)));
  assert.deepEqual(partial[0].functionArguments?.map(ref => ref.name), ['foo']);
  assert.equal(partial[0].references.some(ref => ref.callKind === 'inferred'), false);
  assert.equal(inferPointerCalls(raw, () => true)[0], partial[0]);
  const recovered = inferPointerCalls(raw, () => false);
  assert.ok(recovered[0].references.some(ref => ref.name === 'foo' && ref.callKind === 'inferred'));
  assert.equal(recovered[0].issues.some(issue => /memory budget/.test(issue)), false);
});

test('local pointer assignments are flow sensitive and retain original call sites', () => {
  const source = prelude + 'void run(void){CB fp=foo;fp();fp=bar;fp();}';
  const index = project({'main.c': source});
  assert.deepEqual(inferred(index).map(g => g.name), ['bar','foo']);
  assert.equal(inferred(index).find(g => g.name==='foo')!.sites[0].location.start, source.indexOf('fp();'));
  assert.equal(inferred(index).find(g => g.name==='bar')!.sites[0].location.start, source.lastIndexOf('fp();'));
  assert.ok(inferred(index).every(g => g.sites[0].ambiguous && g.sites[0].inference!.evidence.length));
  assert.equal(index.relations(inferred(index)[0].symbol!.id,'callers').find(g => g.name==='run')!.sites[0].callKind,'inferred');
});
test('pointer copies, address taking and writes through pointer aliases are followed', () => {
  const index=project({'main.c':prelude+'void run(void){CB fp=foo;CB copy=fp;CB *pp=&fp;copy();(*pp)();*pp=bar;fp();}'});
  assert.equal(inferred(index).find(g=>g.name==='foo')!.sites.length,2);
  assert.equal(inferred(index).find(g=>g.name==='bar')!.sites.length,1);
});
test('branch and loop joins retain possible targets without pretending a direct call', () => {
  const index=project({'main.c':prelude+'void run(int condition){CB fp=foo;if(condition){fp=bar;}while(condition){fp=foo;}fp();}'});
  assert.deepEqual(inferred(index).map(g=>g.name),['bar','foo']);
});
test('callback arguments propagate through direct and indirect forwarding functions', () => {
  const source=prelude+'static void invoke(CB cb){cb();} static void forward(CB cb){invoke(cb);} void run(void){void (*dispatch)(CB)=forward;dispatch(foo);}';
  const index=project({'main.c':source});
  assert.deepEqual(inferred(index).map(g=>g.name),['forward']);
  assert.deepEqual(inferred(index,'invoke').map(g=>g.name),['foo']);
  assert.equal(inferred(index).some(g=>g.name==='foo'),false,'passing a callback does not execute it in the forwarding caller');
});
test('registration functions propagate callback values into globals across files', () => {
  const index=project({'api.h':'typedef void (*CB)(void); extern CB installed; void register_cb(CB cb);',
    'install.c':'#include "api.h"\nCB installed; void register_cb(CB cb){installed=cb;}',
    'main.c':'#include "api.h"\nvoid foo(void){} void start(void){register_cb(foo);} void run(void){installed();}'});
  assert.deepEqual(inferred(index).map(g=>g.name),['foo']);
});
test('callback table instances and constant versus unknown array indices stay separate', () => {
  const source=prelude+'struct Ops {CB run;}; struct Ops a={.run=foo},b={.run=bar}; CB table[]={foo,bar}; void run(int i){struct Ops *p=&a;p->run();b.run();table[0]();table[i]();}';
  const index=project({'main.c':source});
  assert.equal(inferred(index).find(g=>g.name==='foo')!.sites.length,3);
  assert.equal(inferred(index).find(g=>g.name==='bar')!.sites.length,2);
});
test('positional and nested designated aggregate callback initializers resolve', () => {
  const source=prelude+'struct Ops {CB run;CB stop;}; struct Device {struct Ops ops;}; struct Ops table[]={{foo,bar},{.run=bar,.stop=foo}}; struct Device dev={.ops={.run=foo}};void run(void){table[0].stop();table[1].run();dev.ops.run();}';
  const index=project({'main.c':source});
  assert.equal(inferred(index).find(g=>g.name==='bar')!.sites.length,2);
  assert.equal(inferred(index).find(g=>g.name==='foo')!.sites.length,1);
});
test('unknown overwrites and opaque address mutations do not retain stale local targets', () => {
  for(const operation of ['fp=get_unknown();','opaque(&fp);']) {
    const index=project({'main.c':prelude+`void run(void){CB fp=foo;${operation}fp();}`});
    assert.deepEqual(inferred(index),[]);
    assert.ok(calls(index).some(g=>g.callKind==='indirect'));
  }
});
test('known pointer mutators apply their effects to the caller local slot', () => {
  const index=project({'main.c':prelude+'static void set(CB *p){*p=bar;}void run(void){CB fp=foo;set(&fp);fp();}'});
  assert.deepEqual(inferred(index).map(g=>g.name),['bar']);
});
test('function-pointer return values and casts preserve known candidate targets', () => {
  const index=project({'main.c':prelude+'static CB factory(int x){if(x)return foo;return bar;} void run(int x){CB fp=(CB)factory(x);fp();}'});
  assert.deepEqual(inferred(index).map(g=>g.name),['bar','foo']);
});
test('macro-expanded pointer calls and initializer aliases use effective C expressions', () => {
  const index=project({'main.c':prelude+'#define TARGET foo\n#define INVOKE(cb) cb()\nCB table[]={TARGET}; void run(void){CB fp=TARGET;INVOKE(fp);table[0]();}'});
  assert.equal(inferred(index).find(g=>g.name==='foo')!.sites.length,2);
  assert.ok(inferred(index).find(g=>g.name==='foo')!.sites.some(site=>site.expansion));
});
test('same-named callback fields and local shadows do not leak targets', () => {
  const source=prelude+'struct A {CB run;}; struct B {CB run;}; void run(void){struct A a={foo};struct B b={bar};{CB fp=bar;fp();} a.run();}';
  const index=project({'main.c':source});
  assert.equal(inferred(index).find(g=>g.name==='foo')!.sites.length,1);
  assert.equal(inferred(index).find(g=>g.name==='bar')!.sites.length,1);
});

test('review: conditional declarations keep outer pointer candidates and scopes', () => {
  const source=prelude+'void run(void){CB fp=foo;{\n#if BOARD\nCB fp=bar;\n#endif\nfp();}fp();}';
  const index=project({'main.c':source});
  assert.equal(inferred(index).find(g=>g.name==='foo')!.sites.length,2);
  assert.equal(inferred(index).find(g=>g.name==='bar')!.sites.length,1);
});
test('review: passing a struct by value does not let a callee overwrite its callback fields', () => {
  for(const definition of ['void mutate(struct Ops value){value.run=bar;}','void mutate(struct Ops value);']) {
    const index=project({'main.c':prelude+'struct Ops {CB run;};'+definition+'void run(void){struct Ops ops={foo};mutate(ops);ops.run();}'});
    assert.deepEqual(inferred(index).map(g=>g.name),['foo']);
  }
});
test('review: function-form callback parameters are adjusted to pointers', () => {
  const index=project({'main.c':prelude+'static void invoke(void cb(void)){cb();} void run(void){invoke(foo);}'});
  assert.deepEqual(inferred(index,'invoke').map(g=>g.name),['foo']);
});
test('review: static callback tables in transitive headers are visible to consumers', () => {
  const index=project({'types.h':'typedef void (*CB)(void);void foo(void);static CB table[]={foo};','api.h':'#include "types.h"',
    'main.c':'#include "api.h"\nvoid foo(void){} void run(void){table[0]();}'});
  assert.deepEqual(inferred(index).map(g=>g.name),['foo']);
});
test('review: struct copies keep independent callback storage', () => {
  const index=project({'main.c':prelude+'struct Ops{CB run;};void run(void){struct Ops a={foo};struct Ops b=a;b.run=bar;a.run();b.run();}'});
  assert.equal(inferred(index).find(g=>g.name==='foo')!.sites.length,1);
  assert.equal(inferred(index).find(g=>g.name==='bar')!.sites.length,1);
});
test('review: a conditional pointer mutator preserves the target on the no-write path', () => {
  const index=project({'main.c':prelude+'static void set(CB *p,int condition){if(condition)*p=bar;}void run(int c){CB fp=foo;set(&fp,c);fp();}'});
  assert.deepEqual(inferred(index).map(g=>g.name),['bar','foo']);
});
test('review: loop call sites include first and later iteration targets', () => {
  const index=project({'main.c':prelude+'void run(int c){CB fp=foo;while(c){fp();fp=bar;}}'});
  assert.deepEqual(inferred(index).map(g=>g.name),['bar','foo']);
});
test('review: unknown pointer leaves preserve variable icons and source selection', () => {
  const source=prelude+'void run(void){CB fp;fp();}';const index=project({'main.c':source});
  assert.equal(calls(index).find(g=>g.callKind==='indirect')!.kind,'variable');
  assert.equal(index.resolveAt('file:///demo/main.c',source.indexOf('fp();'))[0]?.kind,'variable');
});
test('review: nested aggregate copies and returns do not alias the source object', () => {
  const source=prelude+'struct Ops{CB run;};struct Device{struct Ops ops;};static struct Ops make(void){struct Ops x={foo};return x;}void run(void){struct Device a={{foo}},b; b.ops=a.ops;b.ops.run=bar; a.ops.run();b.ops.run();struct Ops c=make();c.run();}';
  const index=project({'main.c':source});
  assert.equal(inferred(index).find(g=>g.name==='foo')!.sites.length,2);
  assert.equal(inferred(index).find(g=>g.name==='bar')!.sites.length,1);
});
test('review: static local callback state persists across invocations', () => {
  const index=project({'main.c':prelude+'void run(int c){static CB fp=foo;fp();if(c)fp=bar;}'});
  assert.deepEqual(inferred(index).map(g=>g.name),['bar','foo']);
});
test('review: conditional aggregate layouts retain both positional initializer interpretations', () => {
  const source=prelude+'#if BOARD\nstruct Ops{CB run;CB stop;};\n#else\nstruct Ops{CB stop;CB run;};\n#endif\nstruct Ops ops={foo,bar};void run(void){ops.run();}';
  const index=project({'main.c':source});
  assert.deepEqual(inferred(index).map(g=>g.name),['bar','foo']);
});
test('review: hexadecimal designated indices do not become writes to every entry', () => {
  const index=project({'main.c':prelude+'CB table[3]={[0x1]=foo,[2]=bar};void run(void){table[2]();}'});
  assert.deepEqual(inferred(index).map(g=>g.name),['bar']);
});
test('review: object pointer writes after opaque allocation retain field targets', () => {
  const index=project({'main.c':prelude+'struct Ops{CB run;};void *allocate(void);void run(void){struct Ops *p=allocate();p->run=foo;p->run();}'});
  assert.deepEqual(inferred(index).map(g=>g.name),['foo']);
});
test('review: opaque struct-by-value calls may mutate pointees but not callback fields', () => {
  const index=project({'main.c':prelude+'struct Holder{CB *slot;CB callback;};void opaque(struct Holder h);void run(void){CB fp=foo;struct Holder h={&fp,bar};opaque(h);fp();h.callback();}'});
  assert.deepEqual(inferred(index).map(g=>g.name),['bar']);
});
test('review: switch branches and conditional expression side effects are retained', () => {
  const index=project({'main.c':prelude+'void run(int c){CB fp=foo;switch(c){case 1:fp=bar;break;default:fp=foo;}fp();(fp(),c)?0:1;}'});
  assert.equal(inferred(index).find(g=>g.name==='foo')!.sites.length,2);
  assert.equal(inferred(index).find(g=>g.name==='bar')!.sites.length,2);
});
test('review: macro-expanded static callback initializers persist and rederive after edits', () => {
  const source=prelude+'#define TARGET foo\nvoid run(int c){static CB fp=TARGET;fp();if(c)fp=bar;}';
  const raw=analyzer.analyze('file:///demo/main.c',source),first=analyzer.derive([raw]);
  assert.equal(analyzer.derive([raw])[0],first[0],'unchanged project keeps result identity');
  const index=new RelationIndex();first.forEach(file=>index.update(file));
  assert.deepEqual(inferred(index).map(g=>g.name),['bar','foo']);
  analyzer.derive([analyzer.analyze(raw.uri,source.replace('TARGET foo','TARGET bar'))]).forEach(file=>index.update(file));
  assert.deepEqual(inferred(index).map(g=>g.name),['bar']);
});
test('review: assignments in conditional expressions join memory rather than overwrite the other arm', () => {
  const index=project({'main.c':prelude+'void run(int c){CB fp;c?(fp=foo):(fp=bar);fp();}'});
  assert.deepEqual(inferred(index).map(g=>g.name),['bar','foo']);
});
test('review: recursive callback forwarding terminates and retains its concrete target', () => {
  const index=project({'main.c':prelude+'static void invoke(CB cb,int n){if(n)invoke(cb,n-1);else cb();}void run(void){invoke(foo,2);}'});
  assert.deepEqual(inferred(index,'invoke').map(g=>g.name),['foo']);
});
test('review: one macro invocation can introduce distinct static locals with the same name', () => {
  const index=project({'main.c':prelude+'#define BOTH() do{{static CB fp=foo;fp();}{static CB fp=bar;fp();}}while(0)\nvoid run(void){BOTH();}'});
  assert.equal(inferred(index).find(g=>g.name==='foo')!.sites.length,1);
  assert.equal(inferred(index).find(g=>g.name==='bar')!.sites.length,1);
});
test('review: conditional callback parameter types retain callable alternatives', () => {
  const index=project({'main.c':prelude+'#if BOARD\ntypedef int Handle;\n#else\ntypedef void (*Handle)(void);\n#endif\nstatic void invoke(Handle cb){cb();}void run(void){invoke(foo);}'});
  assert.deepEqual(inferred(index,'invoke').map(g=>g.name),['foo']);
});
test('review: same-offset calls in different macro bodies retain local and global bindings', () => {
  const index=project({'main.c':prelude+'void fp(void){}\n#if BOARD\n#define DECL CB fp=foo;\n#else\n#define DECL CB xy=bar;\n#endif\nvoid run(void){DECL fp();}'});
  assert.deepEqual(calls(index).filter(g=>g.symbol?.kind==='function').map(g=>g.name).sort(),['foo','fp']);
  const fp=index.symbols().find(symbol=>symbol.name==='fp'&&symbol.kind==='function')!;
  assert.equal(index.relations(fp.id,'references').find(group=>group.name==='run')!.sites.length,1,'macro-local callback use is not a reference to the same-named global function');
});
test('review: wide mutation summaries report their bound and retain unknown leaves', () => {
  const fields=Array.from({length:270},(_,n)=>'CB slot'+n+';').join('');
  const writes=Array.from({length:270},(_,n)=>'p->slot'+n+'=bar;').join('');
  const index=project({'main.c':prelude+'struct Wide{'+fields+'};static void set(struct Wide *p){'+writes+'}void run(void){struct Wide s={.slot269=foo};set(&s);s.slot269();}'});
  assert.ok([...index.files.values()].some(file=>file.issues.some(issue=>issue.includes('mutation limit'))));
  assert.ok(calls(index).some(group=>group.callKind==='indirect'&&group.sites[0].inference?.incomplete));
});
test('review: partial wildcard array writes remain visible at concrete multidimensional indices', () => {
  const index=project({'main.c':prelude+'CB table[2][2];void run(int i){table[i][0]=bar;table[1][0]();}'});
  assert.deepEqual(inferred(index).map(group=>group.name),['bar']);
});
test('review: interactive time budget leaves calls unknown and reports partial analysis', () => {
  const raw=analyzer.analyze('file:///demo/budget.c',prelude+'void run(void){CB fp=foo;'+Array.from({length:1000},()=> 'fp=bar;').join('')+'fp();}');
  const descriptor=Object.getOwnPropertyDescriptor(performance,'now');let tick=0;
  Object.defineProperty(performance,'now',{configurable:true,value:()=>tick+=6000});
  try{
    const result=analyzer.derive([raw])[0];
    assert.ok(result.issues.some(issue=>issue.includes('analysis budget')));
    const index=new RelationIndex();index.update(result);
    assert.ok(calls(index).some(group=>group.callKind==='indirect'));
  }finally{if(descriptor)Object.defineProperty(performance,'now',descriptor);else Reflect.deleteProperty(performance,'now');}
});
test('review: unrelated macro alternatives do not duplicate the same direct call site', () => {
  const index=project({'main.c':prelude+'#if BOARD\n#define DECL int xx=1;\n#else\n#define DECL int yy=2;\n#endif\nvoid run(void){DECL foo();}'});
  assert.equal(calls(index).find(group=>group.name==='foo')!.sites.length,1);
});
test('review: macro reparsing preserves conditionally compiled assignments and returns', () => {
  const source=prelude+'#define MARK() do{}while(0)\nstatic CB factory(void){MARK();\n#if BOARD\nreturn foo;\n#else\nreturn bar;\n#endif\n}void run(void){CB fp=foo;MARK();\n#if BOARD\nfp=bar;\n#else\nfp=foo;\n#endif\nfp();CB next=factory();next();}';
  const index=project({'main.c':source});
  assert.equal(inferred(index).find(group=>group.name==='bar')!.sites.length,2);
});
test('review: generated literal returns and dereference writes retain source branch conditions', () => {
  const source=prelude+'#define MARK() do{}while(0)\nstatic CB factory(void){MARK();\n#if BOARD\nreturn 0;\n#else\nreturn bar;\n#endif\n}void run(void){CB fp=foo;CB *p=&fp;MARK();\n#if BOARD\n*p=bar;\n#else\n*p=foo;\n#endif\nfp();CB next=factory();next();}';
  const index=project({'main.c':source});
  assert.equal(inferred(index).find(group=>group.name==='bar')!.sites.length,2);
});
