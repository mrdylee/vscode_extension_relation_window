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

for (const count of [256, 257, 270]) test(`unrelated ${count} opaque regions preserve the getter callback chain`, () => {
  const fields = Array.from({ length: count }, (_, n) => `int status${n};`).join('');
  const escapes = Array.from({ length: count }, (_, n) => `opaque(&data.status${n});`).join('');
  const index = project(`typedef void(*CB)(void);static void target(void){}struct Ops{CB cb;};
    static const struct Ops registered={.cb=target};static const struct Ops *active;
    static const struct Ops* get_ops(void){return &registered;}
    static void init(const struct Ops*p){active=p;}void setup(void){init(get_ops());}
    struct Data{${fields}};static struct Data data;void opaque(void*);
    static void heavy(void){${escapes}}
    void run(void){heavy();active->cb();}`);
  assert.equal([...index.files.values()].some(file => file.issues.some(issue => issue.includes('region limit'))), count > 256);
  assert.deepEqual(calls(index).filter(group => group.callKind === 'inferred').map(group => group.name), ['target']);
  assert.ok(calls(index).filter(group => group.callKind === 'inferred').every(group => group.sites.every(site => site.inference?.incomplete === false)));
  assert.equal(calls(index).some(group => group.callKind === 'indirect'), false);
});

for (const conditional of [false, true]) test(`a region-limited no-argument helper retains its omitted global callback invalidation (conditional=${conditional})`, () => {
  const fields = Array.from({ length: 257 }, (_, n) => `int status${n};`).join('');
  const escapes = Array.from({ length: 257 }, (_, n) => `opaque(&data.status${n});`).join('');
  const index = project(`typedef void(*CB)(void);void foo(void){}struct Ops{CB cb;};
    struct Data{${fields}};static struct Data data;static struct Ops selected;void opaque(void*);
    static int condition;static void heavy(void){${conditional ? 'if(condition){' : ''}${escapes}opaque(&selected);${conditional ? '}' : ''}}
    void run(void){selected.cb=foo;heavy();selected.cb();}`);
  assert.ok([...index.files.values()].some(file => file.issues.some(issue => issue.includes('region limit'))));
  assert.ok(calls(index).some(group => group.callKind === 'indirect'));
});

for (const conditional of [false, true]) test(`truncated parameter reachability retains uncertainty through helpers (conditional=${conditional})`, () => {
  const fields = Array.from({ length: 257 }, (_, n) => `int status${n};`).join('');
  const escapes = Array.from({ length: 257 }, (_, n) => `opaque(&data.status${n});`).join('');
  const index = project(`typedef void(*CB)(void);void foo(void){}void bar(void){}struct Ops{CB cb;};
    struct Data{${fields}};static struct Data data;void opaque(void*);
    static void heavy(struct Ops*p,int condition){${escapes}${conditional ? 'if(condition)' : ''}opaque(p);}
    static void wrapper(struct Ops*p,int condition){heavy(p,condition);}
    void run(int condition){struct Ops x={foo},y={bar};wrapper(&x,condition);x.cb();y.cb();}`);
  assert.ok([...index.files.values()].some(file => file.issues.some(issue => issue.includes('region limit'))));
  const bar = calls(index).find(group => group.callKind === 'inferred' && group.name === 'bar');
  assert.ok(bar?.sites.every(site => site.inference?.incomplete), 'truncated reachability must retain the project fallback');
  assert.ok(calls(index).some(group => group.callKind === 'indirect' && group.sites.some(site => site.inference?.expression === 'x.cb')));
});

test('exhausting omitted-region bookkeeping retains conservative project uncertainty', () => {
  const fields = Array.from({ length: 514 }, (_, n) => `int status${n};`).join('');
  const escapes = Array.from({ length: 514 }, (_, n) => `opaque(&data.status${n});`).join('');
  const index = project(`typedef void(*CB)(void);void foo(void){}struct Data{${fields}};static struct Data data;
    void opaque(void*);void heavy(void){${escapes}}void run(void){CB cb=foo;heavy();cb();}`);
  assert.ok([...index.files.values()].some(file => file.issues.some(issue => issue.includes('region limit'))));
  assert.ok(calls(index).some(group => group.callKind === 'indirect'));
});
