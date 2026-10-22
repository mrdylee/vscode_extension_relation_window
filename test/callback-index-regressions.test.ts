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
  for (const file of analyzer.derive([analyzer.analyze('file:///callback-index/main.c', source)])) index.update(file);
  return index;
}
function calls(index: RelationIndex) {
  const run = index.symbols().find(symbol => symbol.kind === 'function' && symbol.definition && symbol.name === 'run')!;
  return index.relations(run.id, 'callees');
}
const prelude = 'typedef void(*CB)(void);void foo(void){}void bar(void){}';

for (const variant of ['callee effect', 'returned address', 'wrapper forwarding', 'local alias']) test(`element addresses compose offsets through ${variant}`, () => {
  const helper = variant === 'returned address' ? 'static CB*next(CB*p){return &p[1];}' :
    'static void set(CB*p){p[1]=bar;}' + (variant === 'wrapper forwarding' ? 'static void wrapper(CB*p){set(p);}' : '');
  const invocation = variant === 'returned address' ? '*next(&table[1])=bar;' : variant === 'wrapper forwarding' ? 'wrapper(&table[1]);' :
    variant === 'local alias' ? 'CB*p=&table[1];p[1]=bar;' : 'set(&table[1]);';
  const index = project(prelude + 'static CB table[3]={foo,foo,foo};' + helper + `void run(void){${invocation}table[2]();}`);
  assert.ok(calls(index).some(group => group.callKind === 'inferred' && group.name === 'bar'));
});

for (const variant of ['decay', 'row address', 'whole array address']) test(`real multidimensional arrays keep their dimensions (${variant})`, () => {
  const helper = variant === 'whole array address' ? 'static void set(CB(*p)[2][2]){p[0][1][0]=bar;}' : 'static void set(CB(*p)[2]){p[1][0]=bar;}';
  const invocation = variant === 'whole array address' ? 'set(&table);' : variant === 'row address' ? 'set(&table[0]);' : 'set(table);';
  const index = project(prelude + 'static CB table[2][2]={{foo,foo},{foo,foo}};' + helper + `void run(void){${invocation}table[1][0]();}`);
  assert.ok(calls(index).some(group => group.callKind === 'inferred' && group.name === 'bar'));
});

test('zero indexing a pointer to a scalar callback uses the same storage', () => {
  const index = project(prelude + 'static void set(CB*p){p[0]=bar;}void run(void){CB cb=foo;set(&cb);cb();}');
  assert.ok(calls(index).some(group => group.callKind === 'inferred' && group.name === 'bar'));
});

test('dynamic element addresses retain possible callback writes at known elements', () => {
  const index = project(prelude + 'static CB table[3]={foo,foo,foo};static void set(CB*p){p[1]=bar;}void run(unsigned i){set(&table[i]);table[2]();}');
  assert.ok(calls(index).some(group => group.callKind === 'inferred' && group.name === 'bar'));
  assert.ok(calls(index).some(group => group.callKind === 'inferred' && group.name === 'foo'), 'an unknown offset must not become a definite overwrite');
});

test('opaque helper regions compose element offsets without invalidating neighboring objects', () => {
  const index = project(prelude + 'struct Ops{CB cb;};static struct Ops slots[3]={{foo},{foo},{foo}};void opaque(void*);' +
    'static void clear(struct Ops*p){opaque(&p[1]);}void run(void){clear(&slots[1]);slots[0].cb();slots[2].cb();}');
  const groups = calls(index);
  assert.ok(groups.some(group => group.callKind === 'inferred' && group.sites.some(site => site.inference?.expression === 'slots[0].cb' && !site.inference.incomplete)));
  assert.ok(groups.some(group => group.callKind === 'indirect' && group.sites.some(site => site.inference?.expression === 'slots[2].cb')));
  assert.equal(groups.some(group => group.callKind === 'inferred' && group.sites.some(site => site.kind === 'call' && site.inference?.expression === 'slots[2].cb' && !site.inference.incomplete)), false);
});

for (const order of ['reader-first', 'writer-first']) test(`later wildcard assignments invalidate cached array reads (${order})`, () => {
  const reader = 'void run(void){table[0]();}', writer = 'void set(int i){table[i]=bar;}';
  const index = project(prelude + 'CB table[2]={foo,foo};' +
    (order === 'reader-first' ? reader + writer : writer + reader) + 'void start(void){set(0);run();}');
  assert.deepEqual(calls(index).filter(group => group.callKind === 'inferred').map(group => group.name).sort(), ['bar', 'foo']);
  const target = index.symbols().find(symbol => symbol.kind === 'function' && symbol.definition && symbol.name === 'bar')!;
  assert.deepEqual(index.relations(target.id, 'callers').map(group => group.name), ['run', 'set']);
});

test('late wildcard writes invalidate nested array callback reads', () => {
  const index = project(prelude + 'CB table[2][2]={{foo,foo},{foo,foo}};' +
    'void run(void){table[0][1]();}void set(int i){table[i][1]=bar;}void start(void){set(0);run();}');
  assert.deepEqual(calls(index).filter(group => group.callKind === 'inferred').map(group => group.name).sort(), ['bar', 'foo']);
});

test('many sibling array regions preserve the untouched element callback', () => {
  const count = 128;
  const index = project(prelude + 'struct Object{CB callback;};void opaque(void*);' +
    `static struct Object objects[${count + 1}]={` + Array.from({ length: count + 1 }, () => '{foo}').join(',') + '};' +
    'void run(void){' + Array.from({ length: count }, (_, n) => `opaque(&objects[${n}]);objects[${n}].callback();`).join('') +
    `objects[${count}].callback();}`);
  const inferred = calls(index).filter(group => group.callKind === 'inferred');
  assert.deepEqual(inferred.map(group => group.name), ['foo']);
  assert.equal(inferred[0].sites.length, 1);
  assert.equal(inferred[0].sites[0].inference?.incomplete, false);
  assert.equal(calls(index).filter(group => group.callKind === 'indirect').length, count);
});

test('nested array region matching includes wildcard ancestors without matching sibling fields', () => {
  const index = project(prelude + 'struct Leaf{CB left;CB right;};struct Outer{struct Leaf leaves[2];};void opaque(void*);' +
    'void run(int i){struct Outer objects[2]={{{{foo,bar},{foo,bar}}},{{{foo,bar},{foo,bar}}}};' +
    'opaque(&objects[0].leaves[i].left);objects[0].leaves[1].left();objects[0].leaves[1].right();objects[1].leaves[1].left();}');
  assert.deepEqual(calls(index).filter(group => group.callKind === 'inferred').map(group => group.name).sort(), ['bar', 'foo']);
  assert.equal(calls(index).filter(group => group.callKind === 'indirect').length, 1);
  assert.ok(calls(index).filter(group => group.callKind === 'inferred').every(group => group.sites.every(site => site.inference?.incomplete === false)));
});

test('unrelated heap growth and invalidation do not re-evaluate cached callback readers', () => {
  const fields = Array.from({ length: 257 }, (_, n) => `CB cb${n};`).join('');
  const escapes = Array.from({ length: 257 }, (_, n) => `opaque(&unrelated.cb${n});`).join('');
  const writes = Array.from({ length: 270 }, (_, n) => `bytes[${n}]=0;`).join('');
  const index = project(prelude + `static CB selected=foo,table[1]={foo};static unsigned char bytes[270];
    struct Wide{${fields}};static struct Wide unrelated;void opaque(void*);
    void read_one(void){selected();}void read_array(int i){table[i]();}
    void grow_unrelated(void){${writes}${escapes}}
    void run(void){read_one();read_array(0);grow_unrelated();}`);
  const costs = [...index.files.values()].flatMap(file => file.callbackDiagnostics ?? []).flatMap(detail => detail.costs ?? []);
  for (const name of ['read_one', 'read_array']) {
    const cost = costs.find(cost => cost.symbol === name);
    assert.ok(cost, name);
    assert.equal(cost.runs, 1, name + ' should depend only on the storage it reads');
    assert.ok(cost.cacheHits >= 1, name);
  }
});

test('adding a matching global invalidation still refreshes a cached callback read', () => {
  const index = project(prelude + `struct Ops{CB cb;};static struct Ops source={foo};void opaque(void*);
    void run(void){source.cb();}void clear(void){opaque(&source);}void start(void){clear();run();}`);
  assert.ok(calls(index).some(group => group.callKind === 'indirect'));
  assert.equal(calls(index).some(group => group.callKind === 'inferred' && group.sites.some(site => !site.inference?.incomplete)), false);
});

test('adding another concrete array element refreshes a cached unknown-index read', () => {
  const index = project(prelude + `static CB table[2]={foo};void run(int i){table[i]();}
    void add(void){table[1]=bar;}void start(void){add();run(0);}`);
  assert.deepEqual(calls(index).filter(group => group.callKind === 'inferred').map(group => group.name).sort(), ['bar', 'foo']);
});
