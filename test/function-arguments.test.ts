import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createAnalyzer } from '../src/analyzer';
import { RelationIndex } from '../src/relations';
import { FileAnalysis } from '../src/model';

let analyzer: Awaited<ReturnType<typeof createAnalyzer>>;
before(async () => { analyzer = await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'), path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm')); });
const prefix = 'typedef void (*CB)(void); static void target(void){} static void other(void){} int svc(CB cb);\n';
const uri = 'file:///demo/main.c';
function project(text: string, skip = true) {
  const raw = analyzer.analyze(uri, text, skip), files = analyzer.derive([raw]), index = new RelationIndex();
  files.forEach(file => index.update(file)); return { raw, files, index };
}
const args = (files: FileAnalysis[]) => files.flatMap(file => file.functionArguments ?? []);
const symbol = (index: RelationIndex, name: string) => index.symbols().find(s => s.name === name && s.definition && s.kind === 'function')!;
const relations = (index: RelationIndex, name: string, mode: 'callers' | 'callees' | 'references', enabled = true) => index.relations(symbol(index, name).id, mode, 'all', 'source', enabled);

test('direct/address arguments retain exact locations and opaque receiver metadata', () => {
  const text = prefix + 'void origin(void){svc(target);svc(&target);}';
  const { files, index } = project(text), sites = args(files);
  assert.equal(sites.length, 2);
  assert.ok(sites.every(site => site.kind === 'reference' && site.targetId === symbol(index, 'target').id && site.ownerId === symbol(index, 'origin').id));
  assert.deepEqual(sites.map(site => site.argument!.position), [1, 1]);
  assert.ok(sites.every(site => site.argument!.callee === 'svc'));
  assert.equal(sites[0].location.start, text.indexOf('target);'));
  assert.equal(text.slice(sites[1].location.start, sites[1].location.end), '&target');
  assert.equal(files[0].references.some(site => site.id === sites[0].id), false);
});

test('optional graph projection leaves default Callers and References unchanged', () => {
  const { index } = project(prefix + 'void origin(void){svc(target);}');
  assert.deepEqual(relations(index, 'target', 'callers', false), []);
  assert.deepEqual(relations(index, 'target', 'callers').map(g => g.name), ['origin']);
  assert.deepEqual(relations(index, 'origin', 'callees', false).map(g => g.name), ['svc']);
  assert.deepEqual(relations(index, 'origin', 'callees').map(g => g.name), ['svc', 'target']);
  assert.deepEqual(relations(index, 'target', 'references'), relations(index, 'target', 'references', false));
});

test('mixed call and argument sites share a node while retaining the real call kind', () => {
  const { index } = project(prefix + 'void origin(void){svc(target);target();}');
  const target = relations(index, 'origin', 'callees').find(g => g.name === 'target')!;
  assert.equal(target.callKind, 'direct'); assert.equal(target.sites.length, 2);
  assert.ok(target.sites[0].argument); assert.equal(target.sites[1].kind, 'call');
  assert.equal(relations(index, 'target', 'callers').length, 1);
});

test('inline and queued executors remain separate from the argument origin', () => {
  for (const [body, executor] of [
    ['static int svc(CB cb){cb();return 0;}', 'svc'],
    ['static CB pending;static int svc(CB cb){pending=cb;return 0;}void worker(void){pending();}', 'worker']
  ]) {
    const { index } = project(prefix.replace('int svc(CB cb);', '') + body + 'void origin(void){svc(target);}');
    const groups = relations(index, 'target', 'callers');
    assert.deepEqual(groups.map(g => g.name), ['origin', executor].sort());
    assert.ok(groups.find(g => g.name === 'origin')!.sites.every(s => s.argument));
    assert.ok(groups.find(g => g.name === executor)!.sites.every(s => s.kind === 'call'));
  }
});

test('existing pointer analysis supplies alias arguments and preserves variable selection', () => {
  const text = prefix + 'void origin(void){CB copy=target;svc(copy);copy();}';
  const { files, index } = project(text), sites = args(files);
  assert.equal(sites.length, 1); assert.equal(sites[0].name, 'target');
  assert.equal(sites[0].argument!.inferred, true); assert.ok(sites[0].inference!.evidence.length);
  assert.equal(index.resolveAt(uri, text.indexOf('copy);'))[0].kind, 'variable');
  assert.deepEqual(index.relations(symbol(index, 'target').id, 'callers').map(g => g.name), ['origin']);
});

test('different origins never acquire each other\'s directly supplied callbacks', () => {
  const { index } = project(prefix.replace('int svc(CB cb);', '') + 'static int svc(CB cb){cb();return 0;}void origin(void){svc(target);}void second(void){svc(other);}');
  assert.deepEqual(relations(index, 'target', 'callers').map(g => g.name), ['origin', 'svc']);
  assert.deepEqual(relations(index, 'other', 'callers').map(g => g.name), ['second', 'svc']);
});

test('calls returning scalars, unevaluated calls and unrelated addresses create no argument edges', () => {
  for (const body of ['svc(target());', '(void)sizeof(svc(target));', 'CB local=target;', 'int x=(target==other);']) {
    const { files } = project(prefix + 'void origin(void){' + body + '}');
    assert.deepEqual(args(files), [], body);
  }
});

test('local shadows do not bind to a same-named global function', () => {
  const { files } = project(prefix + 'void origin(void){int target=0;svc(target);}');
  assert.deepEqual(args(files), []);
});

test('inactive and unknown branches preserve filtering and source conditions', () => {
  const text = prefix + 'void origin(void){\n#if 0\nsvc(target);\n#endif\n#if BOARD\nsvc(other);\n#endif\n}';
  const { files, index } = project(text), sites = args(files);
  assert.deepEqual(sites.map(s => s.name), ['other']); assert.ok(sites[0].conditions.length);
  assert.ok(relations(index, 'other', 'callers')[0].sites[0].ambiguous);
  assert.ok(args(project(text, false).files).some(s => s.name === 'target'));
});

test('macro-expanded arguments retain original argument and invocation locations', () => {
  const text = prefix + '#define SUBMIT(cb) svc(cb)\nvoid origin(void){SUBMIT(target);}';
  const { files } = project(text), sites = args(files);
  assert.ok(sites.length); assert.ok(sites.every(s => s.name === 'target'));
  assert.ok(sites.some(s => s.expansion));
  assert.ok(sites.every(s => s.location.start >= text.indexOf('SUBMIT(target)')));
});

test('argument targets from callback return values reuse existing value inference', () => {
  const { files } = project(prefix + 'static CB factory(void){return target;}void origin(void){svc(factory());CB active=other;active();}');
  assert.ok(args(files).some(s => s.name === 'target' && s.argument!.inferred));
  assert.equal(args(files).some(s => s.name === 'factory'), false);
});

test('source edits and dependency replacement remove stale argument targets and preserve result identity', () => {
  const main = analyzer.analyze(uri, prefix + 'extern CB slot;void origin(void){svc(slot);slot();}');
  const depUri = 'file:///demo/slot.c';
  const dependency = (name: string) => analyzer.analyze(depUri, 'typedef void (*CB)(void);void target(void);void other(void);CB slot=' + name + ';');
  const first = analyzer.derive([main, dependency('target')]);
  assert.deepEqual(args(first).map(s => s.name), ['target']);
  const inputs = [main, dependency('other')], second = analyzer.derive(inputs);
  assert.deepEqual(args(second).map(s => s.name), ['other']);
  assert.notEqual(second[0], first[0]); assert.equal(analyzer.derive(inputs)[0], second[0]);
  const index = new RelationIndex(); first.forEach(f => index.update(f)); second.forEach(f => index.update(f));
  assert.deepEqual(relations(index, 'target', 'callers'), []);
  const otherId = symbol(index, 'other').id;
  index.remove(uri); assert.deepEqual(index.relations(otherId, 'callers', 'all', 'name', true), []);
  assert.deepEqual(args(analyzer.derive([main])), []);
});

test('literal-only arguments keep the pointer fast path and unchanged file identity', () => {
  const main = analyzer.analyze(uri, prefix + 'void origin(void){svc(target);}');
  const first = analyzer.derive([main, analyzer.analyze('file:///demo/unrelated.c', 'int version=1;')]);
  const second = analyzer.derive([main, analyzer.analyze('file:///demo/unrelated.c', 'int version=2;')]);
  assert.equal(first[0], second[0]); assert.equal(args(second).length, 1);
  assert.ok(second.every(f => f.issues.every(issue => !issue.startsWith('Callback'))));
});

test('review: declaration initializer arguments belong to the containing function', () => {
  const { files, index } = project(prefix + 'void origin(void){int result=svc(target);}void entry(void){origin();}');
  assert.equal(args(files)[0].ownerId, symbol(index, 'origin').id);
  const graph = index.graph(symbol(index, 'target').id, 'callers', 2, {}, 'all', 'name', true)!;
  assert.equal(graph.root.children[0].name, 'origin');
  assert.equal(graph.root.children[0].children[0].name, 'entry');
});

test('review: conditional argument expressions retain candidate markers', () => {
  const { index } = project(prefix + 'void origin(int choose){svc(choose?target:other);}');
  for (const name of ['target', 'other']) {
    assert.ok(relations(index, name, 'callers')[0].sites[0].ambiguous, name);
    assert.ok(relations(index, 'origin', 'callees').find(group => group.name === name)!.sites[0].ambiguous, name);
  }
});

test('review: conditionally shadowed function arguments remain candidates', () => {
  const { index } = project(prefix + 'void origin(void){\n#if BOARD\nint target=0;\n#endif\nsvc(target);\n}');
  assert.ok(relations(index, 'target', 'callers')[0].sites[0].ambiguous);
});

test('review: typed callback fields and table elements are passed as resolved candidates', () => {
  const { files } = project(prefix + 'struct Ops{CB run;};static struct Ops ops={target};static CB table[]={other};void origin(void){svc(ops.run);svc(table[0]);ops.run();}');
  assert.deepEqual(args(files).map(s => s.name), ['target', 'other']);
  assert.ok(args(files).every(s => s.argument!.inferred));
});

test('review: passing an aggregate containing callbacks does not pass each function', () => {
  const { files } = project(prefix + 'struct Ops{CB run;};static struct Ops ops={target};void opaque(struct Ops *);void origin(void){opaque(&ops);ops.run();}');
  assert.deepEqual(args(files), []);
});

test('review: cross-file caller deletion removes argument buckets while targets stay indexed', () => {
  const declaration = analyzer.analyze('file:///demo/api.h', 'typedef void (*CB)(void);void target(void){}void svc(CB);');
  const main = analyzer.analyze(uri, '#include "api.h"\nvoid origin(void){svc(target);}');
  const index = new RelationIndex(); analyzer.derive([declaration, main]).forEach(file => index.update(file));
  const target = symbol(index, 'target'); assert.equal(relations(index, 'target', 'callers').length, 1);
  index.remove(uri); assert.deepEqual(index.relations(target.id, 'callers', 'all', 'name', true), []);
  index.clear(); assert.equal(index.files.size, 0);
});

test('enabled bidirectional expansion obeys the shared graph budget', () => {
  const source = 'typedef void (*CB)(void);void svc(CB);' + Array.from({ length: 350 }, (_, n) => `void cb${n}(void){}`).join('') +
    'void origin(void){' + Array.from({ length: 350 }, (_, n) => `svc(cb${n});`).join('') + '}';
  const { index } = project(source), graph = index.graph(symbol(index, 'origin').id, 'both', 3, {}, 'all', 'source', true)!;
  const count = (node: typeof graph.root): number => 1 + node.children.reduce((n, child) => n + count(child), 0);
  assert.ok(count(graph.root) + (graph.callers ?? []).reduce((n, child) => n + count(child), 0) <= 300);
  assert.ok(graph.root.children.some(n => n.sites.some(site => site.argument)));
});
