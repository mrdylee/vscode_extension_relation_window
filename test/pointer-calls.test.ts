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
const inferred = (index: RelationIndex, name = 'run') => calls(index,name).filter(g => g.callKind === 'inferred')
  .map(group => ({ ...group, sites: group.sites.filter(site => site.kind === 'call') }));

function callbackTableProject(withType: boolean, withRegistration = true, argumentPosition = 3) {
  const params = ['int ctx', 'void *data'], args = ['0', '0'];
  if (argumentPosition === 4) { params.push('int flags'); args.push('0'); }
  params.splice(argumentPosition - 1, 0, 'const struct Ops *ops');
  args.splice(argumentPosition - 1, 0, 'get_ops()');
  return {
    'api.h': (withType ? 'struct Ops{void(*pre)(void);void(*process)(void);};' : 'struct Ops;') +
      `const struct Ops *get_ops(void);void install(${params.join(',')});`,
    'table.c': '#include "api.h"\nstatic void prepare(void){}static void process(void){}' +
      'static const struct Ops table={.pre=prepare,.process=process};' +
      'const struct Ops *get_ops(void){return &table;}' +
      'static void unrelated(void){}static const struct Ops other={.pre=unrelated};',
    'stage.c': '#include "api.h"\nstatic const struct Ops *saved;' +
      `void install(${params.join(',')}){if(ops){saved=ops;}}` +
      'void run(void){if(saved && saved->pre){saved->pre();saved->process();}}',
    ...(withRegistration ? { 'start.c': `#include "api.h"\nvoid start(void){install(${args.join(',')});}` } : {})
  };
}
for (const withType of [true, false]) for (const position of [1, 2, 3, 4])
test(`callback table crosses getter, argument ${position} and stored pointer (type ${withType ? 'available' : 'unavailable'})`, () => {
  const index = project(callbackTableProject(withType, true, position));
  assert.deepEqual(inferred(index).map(group => group.name).sort(), ['prepare', 'process']);
  const run = index.symbols().find(symbol => symbol.name === 'run' && symbol.definition)!;
  assert.deepEqual(index.graph(run.id, 'both', 1)!.root.children.filter(node => node.symbolId).map(node => node.name).sort(), ['prepare', 'process']);
  for (const group of inferred(index)) assert.ok(index.relations(group.symbol!.id, 'callers').some(caller => caller.name === 'run'));
  assert.equal(inferred(index).some(group => group.name === 'unrelated'), false, 'same member name on another object must not match');
});
test('missing aggregate layout preserves explicit fields without guessing positional members', () => {
  const index = project({'main.c': prelude +
    'struct Missing;static const struct Missing table={.first=foo,bar,.last=bar};' +
    'void run(void){table.first();table.second();table.last();}'});
  assert.deepEqual(inferred(index).map(group => group.name), ['bar', 'foo']);
  assert.equal(inferred(index).some(group => group.sites.some(site => site.inference?.expression === 'table.second')), false);
  const missing = calls(index).find(group => group.name === 'table.second')!;
  assert.ok(missing.sites[0].inference?.reasons.some(reason => /Member value unavailable: table.second/.test(reason)));
});
test('callback diagnosis identifies the missing object connection when registration is outside the index', () => {
  const index = project(callbackTableProject(true, false));
  const source = index.files.get('file:///demo/stage.c')!.text;
  const callback = index.callbackAt('file:///demo/stage.c', source.indexOf('saved->pre();') + 7)!;
  assert.deepEqual(callback.targets, []);
  assert.ok(callback.reasons.some(reason => reason.includes('saved') || reason.includes('install')), callback.reasons.join('\n'));
});
test('callback diagnosis names missing getter and registration argument data', () => {
  const source = 'struct Ops{void(*pre)(void);};const struct Ops *get_ops(void);' +
    'void run(void){const struct Ops *p=get_ops();p->pre();}' +
    'static void install(const struct Ops *ops){ops->pre();}';
  const index = project({'main.c': source}), uri = 'file:///demo/main.c';
  assert.ok(index.callbackAt(uri, source.indexOf('p->pre();') + 3)!.reasons.some(reason => reason.includes('get_ops')));
  assert.ok(index.callbackAt(uri, source.indexOf('ops->pre();') + 5)!.reasons.some(reason => /Argument 1 to install/.test(reason)));
});
test('callback diagnosis distinguishes positional initialization with unavailable structure layout', () => {
  const source = prelude + 'struct Missing;const struct Missing table={foo};void run(void){table.pre();}';
  const index = project({'main.c': source});
  const result = index.callbackAt('file:///demo/main.c', source.indexOf('table.pre();') + 6)!;
  assert.deepEqual(result.targets, []);
  assert.ok(result.reasons.some(reason => /Structure layout unavailable/.test(reason)));
});

test('callback selection follows targets at each call site without changing variable resolution', () => {
  const source = prelude + 'void run(void){CB fp=foo;fp();fp=bar;fp();}';
  const index = project({'main.c': source}), uri = 'file:///demo/main.c';
  assert.deepEqual(index.callbackAt(uri, source.indexOf('fp();'))?.targets.map(s => s.name), ['foo']);
  assert.deepEqual(index.callbackAt(uri, source.lastIndexOf('fp();'))?.targets.map(s => s.name), ['bar']);
  assert.equal(index.callbackAt(uri, source.indexOf('fp=foo')), undefined, 'assignment is ordinary variable selection');
  assert.equal(index.resolveAt(uri, source.indexOf('fp();'))[0]?.name, 'fp');
});
test('callback selection retains member candidates, unknown targets and original call locations', () => {
  const source = prelude + 'struct Ops{CB cb;};void run(int c){struct Ops x={foo};if(c)x.cb=bar;x.cb();struct Ops *p=&x;p->cb();CB unknown;unknown();}';
  const index = project({'main.c': source}), uri = 'file:///demo/main.c';
  const offset = source.indexOf('x.cb();');
  const result = index.callbackAt(uri, offset + 2)!;
  assert.equal(index.callbackAt(uri, offset), undefined, 'object selection remains ordinary navigation');
  assert.deepEqual(result.targets.map(s => s.name).sort(), ['bar', 'foo']);
  assert.equal(result.location.start, offset);
  assert.equal(result.expression, 'x.cb');
  assert.deepEqual(index.callbackAt(uri, source.indexOf('p->cb()') + 3)?.targets.map(s => s.name).sort(), ['bar', 'foo']);
  const unknown = index.callbackAt(uri, source.indexOf('unknown();'))!;
  assert.deepEqual(unknown.targets, []);
  assert.equal(unknown.incomplete, true);
});
test('callback selection ignores direct calls, sizeof expressions and stale files', () => {
  const source = prelude + 'void run(void){CB fp=foo;foo();sizeof(fp());}';
  const index = project({'main.c': source}), uri = 'file:///demo/main.c';
  assert.equal(index.callbackAt(uri, source.indexOf('foo();')), undefined);
  assert.equal(index.callbackAt(uri, source.indexOf('fp());')), undefined);
  index.remove(uri);
  assert.equal(index.callbackAt(uri, source.indexOf('fp());')), undefined);
});
test('callback selection preserves object and index navigation in complex pointer expressions', () => {
  const source = prelude + 'struct Ops{CB cb;};void run(int i){struct Ops x={foo};(*x.cb)();CB table[]={foo,bar};table[i]();}';
  const index = project({'main.c': source}), uri = 'file:///demo/main.c';
  const member = source.indexOf('x.cb)()'), table = source.indexOf('table[i]()');
  assert.equal(index.callbackAt(uri, member), undefined);
  assert.deepEqual(index.callbackAt(uri, member + 2)?.targets.map(s => s.name), ['foo']);
  assert.equal(index.callbackAt(uri, table + 'table['.length), undefined);
  assert.deepEqual(index.callbackAt(uri, table)?.targets.map(s => s.name).sort(), ['bar', 'foo']);
});
test('callback selection reports unknown when only basic analysis is available', () => {
  const source = prelude + 'void run(void){CB fp=foo;fp();}';
  const index = new RelationIndex(), uri = 'file:///demo/main.c';
  const raw = analyzer.analyze(uri, source); index.update(raw);
  assert.deepEqual(index.callbackAt(uri, source.indexOf('fp();'))?.targets, []);
  assert.equal(index.callbackAt(uri, source.indexOf('fp();'))?.incomplete, true);
  analyzer.derive([raw]).forEach(file => index.update(file));
  assert.deepEqual(index.callbackAt(uri, source.indexOf('fp();'))?.targets.map(s => s.name), ['foo']);
});
test('callback selection does not steal a nested direct factory call', () => {
  const source = prelude + 'CB factory(void){return foo;}void run(void){factory()();}';
  const index = project({'main.c': source}), uri = 'file:///demo/main.c';
  assert.equal(index.callbackAt(uri, source.indexOf('factory()()')), undefined);
  assert.equal(index.resolveAt(uri, source.indexOf('factory()()'))[0]?.name, 'factory');
});

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
test('shared callback values keep separate assignments, numeric indices and evidence', () => {
  const source = prelude + 'void svc(CB);void run(int condition){CB a=foo,b=a;CB table[]={foo,bar};int i=0,j=i;if(condition){a=bar;i=1;}a();b();table[i]();table[j]();svc(b);}';
  const index = project({'main.c': source});
  const at = (call: string) => inferred(index).filter(group => group.sites.some(site => site.location.start === source.indexOf(call))).map(group => group.name).sort();
  assert.deepEqual(at('a();'), ['bar', 'foo']);
  assert.deepEqual(at('b();'), ['foo']);
  assert.deepEqual(at('table[i]();'), ['bar', 'foo']);
  assert.deepEqual(at('table[j]();'), ['foo']);
  const b = inferred(index).find(group => group.name === 'foo')!.sites.find(site => site.location.start === source.indexOf('b();'))!;
  assert.equal(b.inference!.evidence.some(frame => frame.location.start === source.indexOf('a=bar')), false);
  assert.deepEqual([...index.files.values()].flatMap(file => file.functionArguments ?? []).map(ref => ref.name), ['foo']);
});
test('sharing a single value preserves the 64-target candidate limit', () => {
  const functions = Array.from({length: 70}, (_, n) => `void target${n}(void){}`).join('');
  const source = 'typedef void(*CB)(void);' + functions + 'void run(int n){CB cb=target0;' +
    Array.from({length: 69}, (_, n) => `if(n==${n})cb=target${n+1};`).join('') + 'cb();}';
  const index = project({'main.c': source});
  assert.equal(inferred(index).length, 64);
  assert.ok(calls(index).some(group => group.callKind === 'indirect' && group.sites.some(site => site.inference?.incomplete)));
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
test('review: elapsed wall time does not turn completed calls into a partial index', () => {
  const raw=analyzer.analyze('file:///demo/budget.c',prelude+'void run(void){CB fp=foo;'+Array.from({length:1000},()=> 'fp=bar;').join('')+'fp();}');
  const descriptor=Object.getOwnPropertyDescriptor(performance,'now');let tick=0;
  Object.defineProperty(performance,'now',{configurable:true,value:()=>tick+=6000});
  try{
    const result=analyzer.derive([raw])[0];
    assert.equal(result.issues.some(issue=>issue.includes('analysis budget')),false);
    const index=new RelationIndex();index.update(result);
    assert.ok(calls(index).some(group=>group.name==='bar'&&group.callKind==='inferred'));
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

test('callback analysis toggles independently of direct calls and literal function arguments', () => {
  const uri = 'file:///demo/option.c';
  const raw = [analyzer.analyze(uri, prelude +
    'void submit(CB cb){} void run(void){CB fp=foo;fp();bar();submit(foo);}')];
  for (const enabled of [true, false, true, false]) {
    const index = new RelationIndex();
    analyzer.derive(raw, undefined, undefined, enabled).forEach(file => index.update(file));
    assert.equal(inferred(index).some(group => group.name === 'foo'), enabled);
    assert.ok(calls(index).some(group => group.name === 'bar' && group.callKind === 'direct'));
    const run = index.symbols().find(s => s.name === 'run')!;
    assert.ok(index.graph(run.id, 'both', 1, {}, 'all', 'name', true)!.root.children
      .some(node => node.name === 'foo' && node.sites.some(site => site.argument)), 'literal arguments remain available');
    assert.equal(index.files.get(uri)!.issues.some(issue => issue.startsWith('Callback ')), false);
  }
});

test('typedef callback members retain selection through getter, registration and stored pointer', () => {
  const sources = callbackTableProject(true);
  sources['api.h'] = sources['api.h'].replace('struct Ops{void(*pre)(void);void(*process)(void);};',
    'typedef void(*Pre)(void);typedef void(*Process)(void);struct Ops{Pre pre;Process process;};');
  const index = project(sources), uri = 'file:///demo/stage.c';
  assert.deepEqual(index.callbackAt(uri, sources['stage.c'].indexOf('saved->pre();') + 7)?.targets.map(s => s.name), ['prepare']);
});

test('callback member selection survives macro expansion elsewhere in the same function', () => {
  const sources = callbackTableProject(true);
  sources['api.h'] = sources['api.h'].replace('struct Ops{void(*pre)(void);void(*process)(void);};',
    'typedef void(*Pre)(void);typedef void(*Process)(void);struct Ops{Pre pre;Process process;};');
  sources['stage.c'] = '#define ERROR(x) (x)\n' + sources['stage.c'].replace('void run(void){', 'void run(void){if(!saved){int ret=ERROR(1);return;}');
  const index = project(sources), uri = 'file:///demo/stage.c';
  assert.deepEqual(index.callbackAt(uri, sources['stage.c'].indexOf('saved->pre();') + 7)?.targets.map(s => s.name), ['prepare']);
  assert.equal(index.callbackAt(uri, sources['stage.c'].indexOf('saved->pre();')), undefined, 'object selection remains ordinary navigation');
});

test('global initializer slots do not consume a function mutation summary', () => {
  const source = prelude + 'static int data[300]={' + Array.from({length:300},(_,n)=>n).join(',') + '};' +
    'static CB cb=foo;void run(void){cb();}';
  const index = project({'large.c':source});
  assert.equal([...index.files.values()].some(f=>f.issues.some(i=>i.includes('mutation limit'))), false);
  assert.ok(inferred(index).some(g=>g.name==='foo'));
});

test('callback mutation diagnostics identify the actual file and function instead of the first caller file', () => {
  const writes = Array.from({length:270},(_,n)=>`data[${n}]=foo;`).join('\n');
  const index = project({'first.c':'void unrelated(void){external();}',
    'actual.c':prelude+'CB data[300];\nvoid large_update(void){\n'+writes+'\n}\nvoid run(void){CB cb=foo;cb();}'});
  const file = index.files.get('file:///demo/actual.c')!;
  assert.equal(index.files.get('file:///demo/first.c')!.issues.some(i=>i.includes('mutation limit')), false);
  const detail = file.callbackDiagnostics?.find(d=>d.kind==='mutation');
  assert.ok(detail);
  assert.equal(detail.symbol, 'large_update');
  assert.equal(detail.location?.uri, file.uri);
  assert.ok(detail.location!.line>200);
  assert.equal(detail.stage,'propagation');
  assert.equal(detail.slots,256);
  assert.ok(detail.evaluations>0);
  assert.ok(detail.scopeEvaluations>0);
  assert.ok(inferred(index).some(g=>g.name==='foo'));
});

test('manual stop during setup does not blame an arbitrary function', () => {
  const raw = [analyzer.analyze('file:///demo/time.c', prelude+'void run(void){CB cb=foo;cb();}')];
  const files = inferPointerCalls(raw, undefined, {}, true, { shouldCancel: () => true });
  const detail = files.flatMap(f=>f.callbackDiagnostics ?? []).find(d=>d.kind==='cancelled')!;
  assert.ok(detail);
  assert.equal(detail.stage, 'setup');
  assert.equal(detail.location, undefined, 'pre-propagation stop must not blame the first function');
  assert.equal(detail.scopeEvaluations, 0);
});

test('callback diagnostic record count is bounded across many functions', () => {
  const writes = Array.from({length:260},(_,n)=>`data[${n}]=foo;`).join('');
  const functions = Array.from({length:70},(_,n)=>`void write_${n}(void){${writes}}`).join('\n');
  const index=project({'many.c':prelude+'CB data[300];'+functions+'void run(void){CB cb=foo;cb();}'});
  assert.ok([...index.files.values()].flatMap(f=>f.callbackDiagnostics ?? []).length<=64);
  assert.ok([...index.files.values()].some(f=>f.issues.some(i=>i.includes('mutation limit'))));
});

test('callback memory guard before inference has a project diagnostic without a blamed file', () => {
  const raw = [analyzer.analyze('file:///demo/memory.c', prelude+'void run(void){CB cb=foo;cb();}')];
  const files = inferPointerCalls(raw, () => true, {});
  const detail = files.flatMap(f=>f.callbackDiagnostics ?? [])[0];
  assert.equal(detail.kind, 'memory');
  assert.equal(detail.stage, 'setup');
  assert.equal(detail.location, undefined);
  assert.equal(detail.evaluations, 0);
});

test('mutation diagnostics in macro-containing functions retain original source locations', () => {
  const writes = Array.from({length:270},(_,n)=>`data[${n}]=VALUE(foo);`).join('\n');
  const index=project({'macro.c':'#define VALUE(x) (x)\n'+prelude+'CB data[300];\nvoid update(void){\n'+writes+
    '\n}\nvoid run(void){CB cb=foo;cb();}'});
  const file=index.files.get('file:///demo/macro.c')!, detail=file.callbackDiagnostics?.find(d=>d.kind==='mutation');
  assert.ok(detail);
  assert.equal(detail.symbol, 'update');
  assert.equal(detail.location?.uri, file.uri);
  assert.ok(detail.location!.line>200 && detail.location!.line<280);
});
