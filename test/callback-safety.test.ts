import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createAnalyzer } from '../src/analyzer';
import { RelationIndex } from '../src/relations';

let analyzer: Awaited<ReturnType<typeof createAnalyzer>>;
before(async () => {
  analyzer = await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'), path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm'));
});
function project(source: string) {
  const index = new RelationIndex();
  for (const file of analyzer.derive([analyzer.analyze('file:///safety/main.c', source)])) index.update(file);
  return index;
}
function calls(index: RelationIndex) {
  return index.relations(index.symbols().find(symbol => symbol.name === 'run' && symbol.kind === 'function' && symbol.definition)!.id, 'callees');
}

function callerRegions(callers:number,depth:number){
  let source='typedef void(*CB)(void);typedef struct Node{CB cb;struct Node*next;}Node;void target(void){}void opaque(Node*);';
  for(let n=0;n<callers;n++)for(let d=depth-1;d>=0;d--)source+=`Node node${n}_${d}={target,${d===depth-1?'0':`&node${n}_${d+1}`}};`;
  source+='static void visit(Node*p){p->cb();opaque(p);}';
  for(let n=0;n<callers;n++)source+=`void run${n}(void){visit(&node${n}_0);}`;
  return source;
}
test('independent caller supplies do not consume a shared helper reachable-region limit',()=>{
  const raw=analyzer.analyze('file:///caller-regions.c',callerRegions(32,9),true,{expandMacros:false,propagateCallbacks:true});
  const [result]=analyzer.derive([raw]);
  assert.ok(!result.issues.some(issue=>/region limit|mutation limit/.test(issue)),result.issues.join('\n'));
  assert.ok(result.references.some(ref=>ref.callKind==='inferred'&&ref.name==='target'));
});
test('one actual call reaching 257 objects still reports the region limit',()=>{
  const raw=analyzer.analyze('file:///actual-regions.c',callerRegions(1,257),true,{expandMacros:false,propagateCallbacks:true});
  const [result]=analyzer.derive([raw]);
  assert.ok(result.issues.some(issue=>/region limit/.test(issue)));
});

test('compatible struct declarations in different files retain scalar selector effects', () => {
  const index = new RelationIndex();
  const files = [
    analyzer.analyze('file:///safety/write.c', 'struct Selector{unsigned index;};void select_second(struct Selector*p){p->index=1;}'),
    analyzer.analyze('file:///safety/read.c', `typedef void(*CB)(void);void foo(void){}void bar(void){}
      struct Selector{unsigned index;};void select_second(struct Selector*);
      static CB table[2]={foo,bar};
      void run(void){struct Selector s={0};select_second(&s);table[s.index]();}`)
  ];
  for (const file of analyzer.derive(files)) index.update(file);
  const inferred = calls(index).filter(group => group.callKind === 'inferred');
  assert.deepEqual(inferred.map(group => group.name), ['bar']);
  assert.ok(inferred.every(group => group.sites.every(site => site.inference?.incomplete === false)));
});

test('a limited no-argument callee invalidates an omitted global callback effect in caller state', () => {
  const declarations = Array.from({ length: 270 }, (_, n) => `static CB callback${n};`).join('');
  const writes = Array.from({ length: 270 }, (_, n) => `callback${n}=bar;`).join('');
  const index = project(`typedef void(*CB)(void);void foo(void){}void bar(void){}
    ${declarations}static CB selected;
    static void heavy(void){${writes}selected=bar;}
    void run(void){selected=foo;heavy();selected();}`);
  assert.ok([...index.files.values()].some(file => file.issues.some(issue => issue.includes('mutation limit'))));
  assert.ok(calls(index).some(group => group.callKind === 'indirect'), 'omitted global mutation must retain an unknown target');
  assert.ok(calls(index).filter(group => group.callKind === 'inferred').every(group => group.sites.filter(site => site.kind === 'call').every(site => site.inference?.incomplete)));
});

test('a conditional opaque helper preserves the untouched callback as an incomplete candidate', () => {
  const index = project(`typedef void(*CB)(void);void foo(void){}struct Ops{CB cb;};
    void opaque(void*);
    static void maybe(struct Ops*x,int condition){if(condition)opaque(x);}
    void run(int condition){struct Ops x={foo};maybe(&x,condition);x.cb();}`);
  const inferred = calls(index).filter(group => group.callKind === 'inferred');
  assert.deepEqual(inferred.map(group => group.name), ['foo']);
  assert.ok(inferred.every(group => group.sites.every(site => site.inference?.incomplete)));
  assert.ok(calls(index).some(group => group.callKind === 'indirect'));
});

test('opaque helper summaries do not invalidate other call sites actual objects', () => {
  const index = project(`typedef void(*CB)(void);void foo(void){}void bar(void){}struct Ops{CB cb;};
    void opaque(void*);
    static void erase(struct Ops*x){opaque(x);}
    void run(void){struct Ops x={foo},y={bar};erase(&x);y.cb();erase(&y);}`);
  const inferred = calls(index).filter(group => group.callKind === 'inferred');
  assert.deepEqual(inferred.map(group => group.name), ['bar']);
  assert.ok(inferred.every(group => group.sites.every(site => site.inference?.incomplete === false)));
  assert.equal(calls(index).some(group => group.callKind === 'indirect'), false);
});

for (const type of ['int', 'CB']) for (const count of [256, 257, 270]) test(`unrelated ${count} opaque ${type} regions preserve the getter callback chain`, () => {
  const fields = Array.from({ length: count }, (_, n) => `${type} status${n};`).join('');
  const escapes = Array.from({ length: count }, (_, n) => `opaque(&data.status${n});`).join('');
  const index = project(`typedef void(*CB)(void);static void target(void){}struct Ops{CB cb;};
    static const struct Ops registered={.cb=target};static const struct Ops *active;
    static const struct Ops* get_ops(void){return &registered;}
    static void init(const struct Ops*p){active=p;}void setup(void){init(get_ops());}
    struct Data{${fields}};static struct Data data;void opaque(void*);
    static void heavy(void){${escapes}}
    void run(void){heavy();active->cb();}`);
  assert.equal([...index.files.values()].some(file => file.issues.some(issue => issue.includes('region limit'))), type === 'CB' && count > 256);
  assert.deepEqual(calls(index).filter(group => group.callKind === 'inferred').map(group => group.name), ['target']);
  assert.ok(calls(index).filter(group => group.callKind === 'inferred').every(group => group.sites.every(site => site.inference?.incomplete === false)));
  assert.equal(calls(index).some(group => group.callKind === 'indirect'), false);
});

for (const conditional of [false, true]) test(`a region-limited no-argument helper retains its omitted global callback invalidation (conditional=${conditional})`, () => {
  const fields = Array.from({ length: 257 }, (_, n) => `CB status${n};`).join('');
  const escapes = Array.from({ length: 257 }, (_, n) => `opaque(&data.status${n});`).join('');
  const index = project(`typedef void(*CB)(void);void foo(void){}struct Ops{CB cb;};
    struct Data{${fields}};static struct Data data;static struct Ops selected;void opaque(void*);
    static int condition;static void heavy(void){${conditional ? 'if(condition){' : ''}${escapes}opaque(&selected);${conditional ? '}' : ''}}
    void run(void){selected.cb=foo;heavy();selected.cb();}`);
  assert.ok([...index.files.values()].some(file => file.issues.some(issue => issue.includes('region limit'))));
  assert.ok(calls(index).some(group => group.callKind === 'indirect'));
});

for (const conditional of [false, true]) test(`region-limited parameter helpers preserve unrelated objects (conditional=${conditional})`, () => {
  const fields = Array.from({ length: 257 }, (_, n) => `CB status${n};`).join('');
  const escapes = Array.from({ length: 257 }, (_, n) => `opaque(&data.status${n});`).join('');
  const index = project(`typedef void(*CB)(void);void foo(void){}void bar(void){}struct Ops{CB cb;};
    struct Data{${fields}};static struct Data data;void opaque(void*);
    static void heavy(struct Ops*p,int condition){${escapes}${conditional ? 'if(condition)' : ''}opaque(p);}
    static void wrapper(struct Ops*p,int condition){heavy(p,condition);}
    void run(int condition){struct Ops x={foo},y={bar};wrapper(&x,condition);x.cb();y.cb();}`);
  assert.ok([...index.files.values()].some(file => file.issues.some(issue => issue.includes('region limit'))));
  const bar = calls(index).find(group => group.callKind === 'inferred' && group.name === 'bar');
  assert.ok(bar?.sites.every(site => site.inference?.incomplete === false));
  assert.ok(calls(index).some(group => group.callKind === 'indirect' && group.sites.some(site => site.inference?.expression === 'x.cb')));
});

test('a genuinely truncated pointee traversal retains project uncertainty', () => {
  const fields = Array.from({ length: 257 }, (_, n) => `struct Ops *p${n};`).join('');
  const init = Array.from({ length: 257 }, (_, n) => `.p${n}=&slots[${n}]`).join(',');
  const index = project(`typedef void(*CB)(void);void foo(void){}struct Ops{CB cb;};
    struct Holder{${fields}};static struct Ops slots[257];void opaque(void*);
    void run(void){CB saved=foo;struct Holder holder={${init}};opaque(&holder);saved();}`);
  assert.ok([...index.files.values()].some(file => file.issues.some(issue => issue.includes('region limit'))));
  assert.ok(calls(index).some(group => group.callKind === 'indirect'));
  assert.ok(calls(index).filter(group => group.callKind === 'inferred').every(group => group.sites.filter(site => site.kind === 'call').every(site => site.inference?.incomplete)));
});

test('exhausting omitted-region bookkeeping retains conservative project uncertainty', () => {
  const fields = Array.from({ length: 514 }, (_, n) => `CB status${n};`).join('');
  const escapes = Array.from({ length: 514 }, (_, n) => `opaque(&data.status${n});`).join('');
  const index = project(`typedef void(*CB)(void);void foo(void){}struct Data{${fields}};static struct Data data;
    void opaque(void*);void heavy(void){${escapes}}void run(void){CB cb=foo;heavy();cb();}`);
  assert.ok([...index.files.values()].some(file => file.issues.some(issue => issue.includes('region limit'))));
  assert.ok(calls(index).some(group => group.callKind === 'indirect'));
});

for (const wrapper of [false, true]) test(`a limited callback mutator preserves its unused pointer argument (wrapper=${wrapper})`, () => {
  const declarations = Array.from({ length: 270 }, (_, n) => `static CB callback${n};`).join('');
  const writes = Array.from({ length: 270 }, (_, n) => `callback${n}=bar;`).join('');
  const index = project(`typedef void(*CB)(void);void foo(void){}void bar(void){}struct Ops{CB cb;};
    ${declarations}static void heavy(struct Ops*unused,struct Ops*changed){${writes}changed->cb=bar;}
    ${wrapper ? 'static void wrapper(struct Ops*unused,struct Ops*changed){heavy(unused,changed);}' : ''}
    void run(void){struct Ops x={foo},y={foo};${wrapper ? 'wrapper' : 'heavy'}(&x,&y);x.cb();y.cb();}`);
  assert.ok([...index.files.values()].some(file => file.issues.some(issue => issue.includes('mutation limit'))));
  const inferred = calls(index).filter(group => group.callKind === 'inferred');
  assert.ok(inferred.find(group => group.name === 'foo')?.sites.some(site => site.inference?.expression === 'x.cb' && !site.inference.incomplete));
  assert.equal(calls(index).some(group => group.callKind === 'indirect' && group.sites.some(site => site.inference?.expression === 'x.cb')), false);
  assert.ok(calls(index).some(group => group.callKind === 'indirect' && group.sites.some(site => site.inference?.expression === 'y.cb')));
});

for (const wrapper of [false, true]) test(`expanding helper effects past the budget preserves unused pointer arguments (wrapper=${wrapper})`, () => {
  const fields = Array.from({ length: 135 }, (_, n) => `CB callback${n};`).join('');
  const writes = Array.from({ length: 135 }, (_, n) => `changed->callback${n}=bar;`).join('');
  const index = project(`typedef void(*CB)(void);void foo(void){}void bar(void){}
    struct Wide{${fields}};struct Ops{CB cb;};static struct Wide a,b;
    static void heavy(struct Wide*changed,struct Ops*unused){${writes}}
    ${wrapper ? 'static void wrapper(struct Wide*changed,struct Ops*unused){heavy(changed,unused);}' : ''}
    void run(int choose){struct Ops x={foo};struct Wide*p=choose?&a:&b;
      ${wrapper ? 'wrapper' : 'heavy'}(p,&x);x.cb();a.callback134();b.callback134();}`);
  assert.ok([...index.files.values()].some(file => file.issues.some(issue => issue.includes('mutation limit'))));
  const inferred = calls(index).filter(group => group.callKind === 'inferred');
  assert.ok(inferred.find(group => group.name === 'foo')?.sites.some(site => site.kind === 'call' && site.inference?.expression === 'x.cb' && !site.inference.incomplete));
  assert.equal(calls(index).some(group => group.callKind === 'indirect' && group.sites.some(site => site.inference?.expression === 'x.cb')), false);
  for (const expression of ['a.callback134', 'b.callback134']) {
    assert.ok(calls(index).some(group => group.callKind === 'indirect' && group.sites.some(site => site.inference?.expression === expression)));
  }
});
