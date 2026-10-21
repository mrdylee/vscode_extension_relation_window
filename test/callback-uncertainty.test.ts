import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createAnalyzer } from '../src/analyzer';
import { RelationIndex } from '../src/relations';

let analyzer: Awaited<ReturnType<typeof createAnalyzer>>;
before(async () => {
  analyzer = await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'), path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm'));
});
const prelude = 'typedef void(*CB)(void);void foo(void){}void bar(void){}struct Ops{CB cb;};';
function project(sources: Record<string, string>) {
  const index = new RelationIndex();
  const files = Object.entries(sources).map(([name, text]) => analyzer.analyze('file:///uncertainty/' + name, text));
  for (const file of analyzer.derive(files)) index.update(file);
  return index;
}
function calls(index: RelationIndex, name = 'run') {
  return index.relations(index.symbols().find(symbol => symbol.name === name && symbol.kind === 'function' && symbol.definition)!.id, 'callees');
}
function inferred(index: RelationIndex, name = 'run') { return calls(index, name).filter(group => group.callKind === 'inferred'); }
function complete(index: RelationIndex, target: string) {
  return inferred(index).find(group => group.name === target)?.sites.every(site => site.inference?.incomplete === false);
}

test('opaque mutation of a wide object uses bounded uncertainty without enumerating every field into effects', () => {
  const fields = Array.from({ length: 270 }, (_, n) => `CB cb${n};`).join('');
  const init = Array.from({ length: 270 }, (_, n) => `.cb${n}=foo`).join(',');
  const index = project({ 'main.c': prelude + `struct Wide{${fields}};static struct Wide data={${init}};` +
    'void opaque(void*);void run(void){opaque(&data);data.cb269();}' });
  assert.equal([...index.files.values()].some(file => file.issues.some(issue => issue.includes('mutation limit'))), false);
  assert.deepEqual(inferred(index), [], 'an opaque call may replace the stored callback');
  assert.ok(calls(index).some(group => group.callKind === 'indirect'));
});

test('a strong callback overwrite restores only that field after opaque mutation', () => {
  const index = project({ 'main.c': prelude + 'struct Pair{CB first;CB second;};void opaque(void*);' +
    'void run(void){struct Pair x={foo,foo};opaque(&x);x.first=bar;x.first();x.second();}' });
  assert.deepEqual(inferred(index).map(group => group.name), ['bar']);
  assert.equal(complete(index, 'bar'), true);
  assert.ok(calls(index).some(group => group.callKind === 'indirect' && group.name === 'x.second'));
});

test('a later opaque call invalidates an earlier strong overwrite again', () => {
  const index = project({ 'main.c': prelude + 'void opaque(void*);' +
    'void run(void){struct Ops x={foo};opaque(&x);x.cb=bar;opaque(&x);x.cb();}' });
  assert.deepEqual(inferred(index), []);
  assert.ok(calls(index).some(group => group.callKind === 'indirect'));
});

test('conditional opaque mutation retains the untouched branch as an incomplete candidate', () => {
  const index = project({ 'main.c': prelude + 'void opaque(void*);' +
    'void run(int choose){struct Ops x={foo};if(choose)opaque(&x);x.cb();}' });
  assert.deepEqual(inferred(index).map(group => group.name), ['foo']);
  assert.equal(complete(index, 'foo'), false);
  assert.ok(calls(index).some(group => group.callKind === 'indirect'));
});

test('strong overwrites on every branch mask earlier region uncertainty after the join', () => {
  const index = project({ 'main.c': prelude + 'void opaque(void*);' +
    'void run(int choose){struct Ops x={foo};opaque(&x);if(choose)x.cb=foo;else x.cb=bar;x.cb();}' });
  assert.deepEqual(inferred(index).map(group => group.name).sort(), ['bar', 'foo']);
  assert.equal(complete(index, 'foo'), true);
  assert.equal(complete(index, 'bar'), true);
  assert.equal(calls(index).some(group => group.callKind === 'indirect'), false);
});

test('opaque uncertainty survives formal-to-actual summary substitution', () => {
  const index = project({ 'main.c': prelude + 'void opaque(void*);static void erase(struct Ops*x){opaque(x);}' +
    'void run(void){struct Ops x={foo};erase(&x);x.cb();}' });
  assert.deepEqual(inferred(index), [], 'a helper passing an object to opaque code must invalidate its callback fields');
  assert.ok(calls(index).some(group => group.callKind === 'indirect'));
});

test('a helper strong overwrite after opaque mutation remains precise when its summary is imported', () => {
  const index = project({ 'main.c': prelude + 'void opaque(void*);static void erase(struct Ops*x){opaque(x);x->cb=bar;}' +
    'void run(void){struct Ops x={foo};erase(&x);x.cb();}' });
  assert.deepEqual(inferred(index).map(group => group.name), ['bar']);
  assert.equal(complete(index, 'bar'), true);
});

test('opaque mutation reaches callback storage behind an object pointer alias', () => {
  const index = project({ 'main.c': prelude + 'struct Outer{struct Ops*child;};void opaque(void*);' +
    'void run(void){struct Ops x={foo};struct Outer outer={&x};opaque(&outer);x.cb();}' });
  assert.deepEqual(inferred(index), [], 'opaque code can follow outer.child and replace x.cb');
  assert.ok(calls(index).some(group => group.callKind === 'indirect'));
});

test('an opaque by-value aggregate call changes pointees without changing its original callback field', () => {
  const index = project({ 'main.c': prelude + 'struct Holder{CB cb;struct Ops*child;};void opaque(struct Holder);' +
    'void run(void){struct Ops x={foo};struct Holder holder={bar,&x};opaque(holder);holder.cb();x.cb();}' });
  assert.deepEqual(inferred(index).map(group => group.name), ['bar']);
  assert.equal(complete(index, 'bar'), true);
  assert.ok(calls(index).some(group => group.callKind === 'indirect' && group.name === 'x.cb'));
});

test('an unknown array element passed to opaque code invalidates a concrete callback element', () => {
  const index = project({ 'main.c': prelude + 'void opaque(void*);' +
    'void run(int i){struct Ops x[2]={{foo},{bar}};opaque(&x[i]);x[0].cb();}' });
  assert.deepEqual(inferred(index), []);
  assert.ok(calls(index).some(group => group.callKind === 'indirect'));
});

test('a callback copied before object invalidation retains its independent value', () => {
  const index = project({ 'main.c': prelude + 'void opaque(void*);' +
    'void run(void){struct Ops x={foo};CB saved=x.cb;opaque(&x);saved();}' });
  assert.deepEqual(inferred(index).map(group => group.name), ['foo']);
  assert.equal(complete(index, 'foo'), true);
});

test('an independent callback remains complete when an unrelated function reaches its effect limit', () => {
  const globals = Array.from({ length: 270 }, (_, n) => `static CB cb${n};`).join('');
  const writes = Array.from({ length: 270 }, (_, n) => `cb${n}=foo;`).join('');
  const index = project({ 'main.c': prelude + globals + `void heavy(void){${writes}}void run(void){CB cb=bar;cb();}` });
  assert.ok([...index.files.values()].some(file => file.issues.some(issue => issue.includes('mutation limit'))));
  assert.deepEqual(inferred(index).map(group => group.name), ['bar']);
  assert.equal(complete(index, 'bar'), true);
  assert.equal(calls(index).some(group => group.callKind === 'indirect'), false);
});

test('a callback depending on a limited mutator stays incomplete', () => {
  const globals = Array.from({ length: 270 }, (_, n) => `static CB cb${n};`).join('');
  const writes = Array.from({ length: 270 }, (_, n) => `cb${n}=foo;`).join('');
  const index = project({ 'main.c': prelude + globals +
    `static void heavy(CB*out){${writes}*out=bar;}void run(void){CB cb=foo;heavy(&cb);cb();}` });
  assert.ok([...index.files.values()].some(file => file.issues.some(issue => issue.includes('mutation limit'))));
  assert.ok(calls(index).some(group => group.callKind === 'indirect'));
  assert.ok(inferred(index).every(group => group.sites.filter(site => site.kind === 'call').every(site => site.inference?.incomplete)));
});

test('a concrete array callback overwrite masks earlier whole-array uncertainty', () => {
  const index = project({ 'main.c': prelude + 'void opaque(void*);' +
    'void run(void){struct Ops x[2]={{foo},{foo}};opaque(x);x[0].cb=bar;x[0].cb();}' });
  assert.deepEqual(inferred(index).map(group => group.name), ['bar']);
  assert.equal(complete(index, 'bar'), true);
  assert.equal(calls(index).some(group => group.callKind === 'indirect'), false);
});

test('a concrete array overwrite masks an earlier wildcard write and its invalidation', () => {
  const index = project({ 'main.c': prelude + 'void opaque(void*);' +
    'void run(int i){struct Ops x[2]={{foo},{foo}};x[i].cb=foo;opaque(x);x[0].cb=bar;x[0].cb();}' });
  assert.deepEqual(inferred(index).map(group => group.name), ['bar']);
  assert.equal(complete(index, 'bar'), true);
});

test('a later wildcard callback write is still considered after a concrete overwrite', () => {
  const index = project({ 'main.c': prelude + 'void opaque(void*);' +
    'void run(int i){struct Ops x[2]={{foo},{foo}};opaque(x);x[0].cb=bar;x[i].cb=foo;x[0].cb();}' });
  assert.deepEqual(inferred(index).map(group => group.name).sort(), ['bar', 'foo']);
});

test('repeated invalidation follows a newly assigned pointee instead of cached reachability', () => {
  const index = project({ 'main.c': prelude + 'struct Outer{struct Ops*child;};void opaque(void*);' +
    'void run(void){struct Ops x={foo},y={bar};struct Outer outer={&x};opaque(&outer);outer.child=&y;opaque(&outer);y.cb();}' });
  assert.deepEqual(inferred(index), []);
  assert.ok(calls(index).some(group => group.callKind === 'indirect'));
});

test('region uncertainty remains bounded when two disjoint branch states are joined', () => {
  const locals = Array.from({ length: 512 }, (_, n) => `CB cb${n}=foo;`).join('');
  const first = Array.from({ length: 256 }, (_, n) => `opaque(&cb${n});`).join('');
  const second = Array.from({ length: 256 }, (_, n) => `opaque(&cb${n + 256});`).join('');
  const index = project({ 'main.c': prelude + 'void opaque(void*);' +
    `void run(int choose){${locals}if(choose){${first}}else{${second}}cb0();}` });
  assert.ok([...index.files.values()].some(file => file.issues.some(issue => issue.includes('region limit'))));
  assert.equal(complete(index, 'foo'), false);
});

test('a deadline before propagation retains getter registrations as incomplete candidates with reasons', t => {
  const uri = 'file:///uncertainty/deadline.c';
  const source = prelude + `static const struct Ops table={.cb=foo};static const struct Ops *active;
    const struct Ops*getter(void){return &table;}
    int init(int ctx,int result,const struct Ops*cbs){if(ctx&&result&&cbs&&cbs->cb)active=cbs;return 0;}
    void setup(void){init(1,1,getter());}void run(void){if(active&&active->cb)active->cb();}`;
  const raw = analyzer.analyze(uri, source);
  const now = performance.now.bind(performance); let clockReads = 0;
  t.mock.method(performance, 'now', () => now() + (++clockReads > 1 ? 10_001 : 0));
  const files = analyzer.derive([raw], undefined, undefined, true), index = new RelationIndex();files.forEach(file => index.update(file));
  const site = index.callbackAt(uri, source.lastIndexOf('cb();') + 1)!;
  assert.ok(files.some(file => file.callbackDiagnostics?.some(detail => detail.kind === 'time')));
  assert.deepEqual(site.targets.map(target => target.name), ['foo']);
  assert.equal(site.incomplete, true);
  assert.ok(site.reasons.some(reason => reason.includes('10 seconds')));
  assert.ok(calls(index).some(group => group.callKind === 'indirect'));
  assert.ok(calls(index).some(group => group.callKind === 'registered' && group.name === 'foo'));
  assert.equal(calls(index).some(group => group.callKind === 'inferred'), false);
});

test('an unregistered callback stopped by a deadline still explains its missing analysis', t => {
  const uri = 'file:///uncertainty/no-registration.c', source = prelude + 'extern struct Ops *active;void run(void){active->cb();}';
  const raw = analyzer.analyze(uri, source);
  const now = performance.now.bind(performance); let clockReads = 0;
  t.mock.method(performance, 'now', () => now() + (++clockReads > 1 ? 10_001 : 0));
  const files = analyzer.derive([raw], undefined, undefined, true), index = new RelationIndex();files.forEach(file => index.update(file));
  const site = index.callbackAt(uri, source.lastIndexOf('cb();') + 1)!;
  assert.deepEqual(site.targets, []);
  assert.equal(site.incomplete, true);
  assert.ok(site.reasons.some(reason => reason.includes('not evaluated')));
  assert.ok(site.reasons.some(reason => reason.includes('10 seconds')));
});

test('deadline recovery keeps unknown mutation uncertain and does not borrow unrelated field registrations', t => {
  const uri = 'file:///uncertainty/changed.c';
  const source = prelude + `static const struct Ops table={.cb=foo},other={.cb=bar};static const struct Ops *active;
    const struct Ops*getter(void){return &table;}
    void init(const struct Ops*cbs){active=cbs;}void setup(void){init(getter());}
    void opaque(void*);void run(void){opaque(&active);active->cb();}`;
  const raw = analyzer.analyze(uri, source);
  const now = performance.now.bind(performance); let clockReads = 0;
  t.mock.method(performance, 'now', () => now() + (++clockReads > 1 ? 10_001 : 0));
  const files = analyzer.derive([raw], undefined, undefined, true), index = new RelationIndex();files.forEach(file => index.update(file));
  const site = index.callbackAt(uri, source.lastIndexOf('cb();') + 1)!;
  assert.equal(site.incomplete, true);
  assert.deepEqual(site.targets, [], 'an opaque replacement cannot be treated as the getter object');
  assert.ok(site.reasons.some(reason => reason.includes('10 seconds')));
  assert.ok(calls(index).some(group => group.callKind === 'indirect'));
});

test('deadline registration recovery skips large bodies, preserves uncertainty and caches projection identity', t => {
  const uri = 'file:///uncertainty/large-body.c';
  const source = prelude + `static const struct Ops table={.cb=foo},other={.cb=bar};static const struct Ops *active;
    const struct Ops*getter(void){return &table;}
    void init(const struct Ops*cbs){if(cbs)active=cbs;}void setup(void){init(getter());}
    void heavy(void){${'active=&other;'.repeat(600)}}void run(void){heavy();active->cb();}`;
  const raw = analyzer.analyze(uri, source);
  const now = performance.now.bind(performance); let clockReads = 0;
  t.mock.method(performance, 'now', () => now() + (++clockReads > 1 ? 10_001 : 0));
  const files = analyzer.derive([raw], undefined, undefined, true), index = new RelationIndex();files.forEach(file => index.update(file));
  const site = index.callbackAt(uri, source.lastIndexOf('cb();') + 1)!;
  assert.deepEqual(site.targets.map(target => target.name), ['foo']);
  assert.equal(site.incomplete, true, 'skipped mutations prohibit a complete call inference');
  assert.ok(site.reasons.some(reason => reason.includes('mutations may be omitted')));
  assert.ok(calls(index).some(group => group.callKind === 'indirect'));
  assert.strictEqual(analyzer.derive([raw], undefined, undefined, true)[0], files[0]);
});

test('region diagnostics distinguish retained ordered regions from traversal limits', () => {
  const globals = Array.from({ length: 257 }, (_, n) => `static CB cb${n};`).join('');
  const addresses = Array.from({ length: 257 }, (_, n) => `opaque(&cb${n});`).join('');
  const index = project({ 'regions.c': prelude + globals + `void opaque(void*);void heavy(void){${addresses}}void run(void){cb256();}` });
  const detail = [...index.files.values()].flatMap(file => file.callbackDiagnostics ?? [])
    .find(detail => detail.message.includes('region limit') && detail.symbol === 'heavy')!;
  assert.equal(detail.storage?.operation, 'ordered-region');
  assert.equal(detail.storage?.retained, 256);
  assert.match(detail.storage?.omitted ?? '', /cb256$/);
});
