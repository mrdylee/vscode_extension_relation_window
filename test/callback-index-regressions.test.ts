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
