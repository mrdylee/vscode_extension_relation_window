import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createAnalyzer } from '../src/analyzer';
import { IncrementalAnalysis } from '../src/incremental-analysis';
import { FileAnalysis } from '../src/model';

let parser: Awaited<ReturnType<typeof createAnalyzer>>;
before(async () => { parser = await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'), path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm')); });
const source = (name: string, text: string) => parser.analyze('file:///incremental/' + name, text);
function harness() {
  const cache = new IncrementalAnalysis(), batches: string[][] = [];
  const derive = (files: FileAnalysis[], callbacks = true) => cache.derive(files, dirty => {
    batches.push(dirty.map(file => file.uri));
    return parser.derive(dirty, undefined, undefined, callbacks);
  }, callbacks);
  return { cache, batches, derive };
}

test('unrelated edits reuse derived objects and batch all dirty components under one analysis budget', () => {
  const { derive, batches } = harness();
  const a = source('a.c', 'int alpha(void){return 1;}'), b = source('b.c', 'int beta(void){return 2;}');
  const first = derive([a, b]);
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0], [a.uri, b.uri]);
  assert.deepEqual(derive([a, b]), first);
  assert.equal(batches.length, 1, 'unchanged inputs do not derive again');
  const changed = source('a.c', 'int alpha(void){return 3;}');
  const next = derive([changed, b]);
  assert.deepEqual(batches[1], [a.uri]);
  assert.equal(next[1], first[1]);
  assert.equal(next[0].text, changed.text);
});

test('header edits invalidate quoted and system include consumers', () => {
  const { derive, batches } = harness();
  const header = source('include/api.h', '#define ANSWER 1\n');
  const quoted = source('a.c', '#include "include/api.h"\nint alpha(void){return ANSWER;}');
  const system = source('b.c', '#include <api.h>\nint beta(void){return ANSWER;}');
  const other = source('c.c', 'int gamma(void){return 1;}');
  derive([header, quoted, system, other]);
  derive([source('include/api.h', '#define ANSWER 2\n'), quoted, system, other]);
  assert.deepEqual(batches[1], [header.uri, quoted.uri, system.uri]);
});

test('callback registrations, getters, argument consumers and field writes share an invalidation component', () => {
  const { derive, batches } = harness();
  const table = source('table.c', 'struct Ops{void(*cb)(void);};void foo(void){}void bar(void){}static const struct Ops table={foo};const struct Ops *get(void){return &table;}');
  const install = source('install.c', 'struct Ops{void(*cb)(void);};static const struct Ops *saved;void install(const struct Ops *p){saved=p;}void run(void){saved->cb();}');
  const start = source('start.c', 'void start(void){install(get());}');
  const other = source('other.c', 'int independent(void){return 1;}');
  derive([table, install, start, other]);
  const changed = source('table.c', table.text.replace('table={foo}', 'table={bar}'));
  const next = derive([changed, install, start, other]);
  assert.deepEqual(batches[1], [table.uri, install.uri, start.uri]);
  assert.deepEqual(next, parser.derive([changed, install, start, other]));
});

test('adding a formerly unresolved definition and deleting it invalidate consumers', () => {
  const { derive, batches } = harness();
  const caller = source('caller.c', 'void run(void){missing();}'), other = source('other.c', 'int independent(void){return 1;}');
  derive([caller, other]);
  const definition = source('definition.c', 'void missing(void){}');
  derive([caller, other, definition]);
  assert.deepEqual(batches[1], [caller.uri, definition.uri]);
  derive([caller, other]);
  assert.deepEqual(batches[2], [caller.uri]);
});

test('macro bodies connect generated uses to providers', () => {
  const { derive, batches } = harness();
  const macro = source('macro.h', '#define INVOKE() target()\n');
  const use = source('use.c', '#include "macro.h"\nvoid run(void){INVOKE();}');
  const target = source('target.c', 'void target(void){}'), other = source('other.c', 'int independent;');
  derive([macro, use, target, other]);
  derive([macro, use, source('target.c', 'void target(void){int local=1;}'), other]);
  assert.deepEqual(batches[1], [macro.uri, use.uri, target.uri]);
});

test('token-pasting macros conservatively invalidate the complete workspace', () => {
  const { derive, batches } = harness();
  const macro = source('macro.h', '#define JOIN(a,b) a##b\n'), a = source('a.c', 'int alpha;'), b = source('b.c', 'int beta;');
  derive([macro, a, b]);
  derive([macro, source('a.c', 'int alpha=1;'), b]);
  assert.deepEqual(batches[1], [macro.uri, a.uri, b.uri]);
});

test('configuration changes and clear discard previous derived generations', () => {
  const { cache, derive, batches } = harness();
  const files = [source('a.c', 'int alpha;'), source('b.c', 'int beta;')];
  derive(files); derive(files, false);
  assert.equal(batches.length, 2);
  cache.clear(); derive(files, false);
  assert.equal(batches.length, 3);
});

test('validated restored results seed reuse on the first subsequent file edit', () => {
  const { cache, derive, batches } = harness();
  const a = source('a.c', 'int alpha;'), b = source('b.c', 'int beta;');
  const restored = parser.derive([a, b]);
  cache.seed([a, b], restored);
  assert.equal(derive([a, b])[1], restored[1]);
  assert.equal(batches.length, 0);
  const result = derive([source('a.c', 'int alpha=1;'), b]);
  assert.deepEqual(batches, [[a.uri]]);
  assert.equal(result[1], restored[1]);
});

test('removed components are not retained as reusable old generations', () => {
  const { derive, batches } = harness();
  const a = source('a.c', 'int alpha;'), b = source('b.c', 'int beta;');
  derive([a, b]); derive([a]); derive([a, b]);
  assert.deepEqual(batches, [[a.uri, b.uri], [b.uri]]);
});

test('independent component reorder preserves output order without unnecessary analysis', () => {
  const { derive, batches } = harness();
  const a = source('a.c', 'int alpha;'), b = source('b.c', 'int beta;');
  const first = derive([a, b]), second = derive([b, a]);
  assert.deepEqual(second, [first[1], first[0]]);
  assert.equal(batches.length, 1);
});

test('transient analysis limits are retried instead of freezing a partial result', () => {
  for (const issue of ['Callback analysis memory budget reached', 'Callback analysis budget: 10 seconds', 'Callback analysis work limit reached']) {
    const cache = new IncrementalAnalysis(), a = source('a.c', 'int alpha;');
    let calls = 0;
    const derive = (files: FileAnalysis[]) => { calls++; return files.map(file => ({ ...file, issues: [issue] })); };
    cache.derive([a], derive); cache.derive([a], derive);
    assert.equal(calls, 2, issue);
  }
});
