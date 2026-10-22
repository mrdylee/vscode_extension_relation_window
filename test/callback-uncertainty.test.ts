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

test('a stop before propagation preserves explicit uncertainty at registered call sites', () => {
  const uri = 'file:///uncertainty/deadline.c';
  const source = prelude + `static const struct Ops table={.cb=foo};static const struct Ops *active;
    const struct Ops*getter(void){return &table;}
    int init(int ctx,int result,const struct Ops*cbs){if(ctx&&result&&cbs&&cbs->cb)active=cbs;return 0;}
    void setup(void){init(1,1,getter());}void run(void){if(active&&active->cb)active->cb();}`;
  const raw = analyzer.analyze(uri, source);
  const files = analyzer.derive([raw], undefined, undefined, true, { shouldCancel: () => true }), index = new RelationIndex();files.forEach(file => index.update(file));
  const site = index.callbackAt(uri, source.lastIndexOf('cb();') + 1)!;
  assert.ok(files.some(file => file.callbackDiagnostics?.some(detail => detail.kind === 'cancelled')));
  assert.deepEqual(site.targets, []);
  assert.equal(site.incomplete, true);
  assert.ok(site.reasons.some(reason => reason.includes('cancelled')));
  assert.ok(calls(index).some(group => group.callKind === 'indirect'));
  assert.equal(calls(index).some(group => group.callKind === 'inferred'), false);
});

test('an unregistered callback stopped by the user explains its missing analysis', () => {
  const uri = 'file:///uncertainty/no-registration.c', source = prelude + 'extern struct Ops *active;void run(void){active->cb();}';
  const raw = analyzer.analyze(uri, source);
  const files = analyzer.derive([raw], undefined, undefined, true, { shouldCancel: () => true }), index = new RelationIndex();files.forEach(file => index.update(file));
  const site = index.callbackAt(uri, source.lastIndexOf('cb();') + 1)!;
  assert.deepEqual(site.targets, []);
  assert.equal(site.incomplete, true);
  assert.ok(site.reasons.some(reason => reason.includes('not evaluated')));
  assert.ok(site.reasons.some(reason => reason.includes('cancelled')));
});

test('manual stop keeps unknown mutation uncertain and does not borrow unrelated field registrations', () => {
  const uri = 'file:///uncertainty/changed.c';
  const source = prelude + `static const struct Ops table={.cb=foo},other={.cb=bar};static const struct Ops *active;
    const struct Ops*getter(void){return &table;}
    void init(const struct Ops*cbs){active=cbs;}void setup(void){init(getter());}
    void opaque(void*);void run(void){opaque(&active);active->cb();}`;
  const raw = analyzer.analyze(uri, source);
  const files = analyzer.derive([raw], undefined, undefined, true, { shouldCancel: () => true }), index = new RelationIndex();files.forEach(file => index.update(file));
  const site = index.callbackAt(uri, source.lastIndexOf('cb();') + 1)!;
  assert.equal(site.incomplete, true);
  assert.deepEqual(site.targets, [], 'an opaque replacement cannot be treated as the getter object');
  assert.ok(site.reasons.some(reason => reason.includes('cancelled')));
  assert.ok(calls(index).some(group => group.callKind === 'indirect'));
});

test('manual stop preserves uncertainty in a large body and permits a fresh retry', () => {
  const uri = 'file:///uncertainty/large-body.c';
  const source = prelude + `static const struct Ops table={.cb=foo},other={.cb=bar};static const struct Ops *active;
    const struct Ops*getter(void){return &table;}
    void init(const struct Ops*cbs){if(cbs)active=cbs;}void setup(void){init(getter());}
    void heavy(void){${'active=&other;'.repeat(600)}}void run(void){heavy();active->cb();}`;
  const raw = analyzer.analyze(uri, source);
  const files = analyzer.derive([raw], undefined, undefined, true, { shouldCancel: () => true }), index = new RelationIndex();files.forEach(file => index.update(file));
  const site = index.callbackAt(uri, source.lastIndexOf('cb();') + 1)!;
  assert.deepEqual(site.targets, []);
  assert.equal(site.incomplete, true, 'skipped mutations prohibit a complete call inference');
  assert.ok(site.reasons.some(reason => reason.includes('cancelled')));
  assert.ok(calls(index).some(group => group.callKind === 'indirect'));
  const retry = analyzer.derive([raw]);
  assert.notStrictEqual(retry[0], files[0]);
  assert.ok(!retry[0].callbackDiagnostics?.some(detail => detail.kind === 'cancelled'));
});

test('elapsed project time alone never stops analysis; per-function timers reset', () => {
  const raw = { ...analyzer.analyze('file:///budget/no-cutoff.c', prelude + 'static CB cb=foo;void slow(void){int i=0;' + 'i++;'.repeat(600) + '}void run(void){slow();cb();}'), expandMacros: false };
  let clock = 0, slowStarted = false;
  const progress: import('../src/model').CallbackProgress[] = [];
  const result = analyzer.derive([raw], undefined, undefined, true, {
    now: () => clock, onProgress: value => {
      progress.push(value);
      if (value.stage === 'setup') clock = 120_000;
      if (value.symbol === 'slow' && !slowStarted) { slowStarted = true; clock += 7000; }
    }
  });
  assert.ok(!result[0].callbackDiagnostics?.some(detail => detail.kind === 'time'));
  assert.equal(progress.at(-1)?.outcome, 'completed');
  assert.ok(progress.at(-1)!.elapsedMs > 60_000);
  assert.ok(progress.some(value => value.symbol === 'slow' && value.scopeElapsedMs >= 5000));
  const firstRun = progress.find(value => value.symbol === 'run')!;
  assert.equal(firstRun.scopeElapsedMs, 0, 'the next function starts its own timer');
  const index = new RelationIndex();result.forEach(file => index.update(file));
  const site = index.callbackAt(raw.uri, raw.text.lastIndexOf('cb();') + 1)!;
  assert.equal(site.incomplete, false);
  assert.deepEqual(site.targets.map(target => target.name), ['foo']);
});

test('retrying the same parsed inputs does not return a cancelled project cache', () => {
  const raw = { ...analyzer.analyze('file:///budget/retry.c', prelude + 'static CB cb=foo;void run(void){cb();}'), expandMacros: false };
  const stopped = analyzer.derive([raw], undefined, undefined, true, { shouldCancel: () => true });
  assert.ok(stopped[0].callbackDiagnostics?.some(detail => detail.kind === 'cancelled'));
  const fresh = analyzer.derive([raw]);
  assert.ok(!fresh[0].callbackDiagnostics?.some(detail => detail.kind === 'cancelled'));
  assert.notStrictEqual(fresh[0], stopped[0]);
});

test('cancellation while evaluating a callee never invents a time-budget reason', () => {
  const source = 'typedef void(*CB)(void);void target(void){}void run(void){CB cb=target;cb();}';
  const raw = { ...analyzer.analyze('file:///cancel-reason/main.c', source), expandMacros: false };
  let active = false, checks = 0;
  const files = analyzer.derive([raw], undefined, undefined, true, {
    shouldCancel: () => active && ++checks >= 7,
    onProgress: progress => { if (progress.stage === 'propagation' && progress.symbol === 'run') active = true; }
  });
  const index = new RelationIndex();files.forEach(file => index.update(file));
  const site = index.callbackAt(raw.uri, source.indexOf('cb();') + 1)!;
  assert.equal(site.incomplete, true);
  assert.ok(site.reasons.some(reason => reason.includes('cancelled')));
  assert.ok(site.reasons.every(reason => !/time budget|10 seconds/i.test(reason)));
});

test('Stop at the propagation/postprocessing boundary keeps targets and records cancellation', () => {
  const raw = { ...analyzer.analyze('file:///late-stop/main.c', prelude + 'static CB cb=foo;void run(void){cb();}'), expandMacros: false };
  let cancelled = false;
  const files = analyzer.derive([raw], undefined, undefined, true, {
    shouldCancel: () => cancelled,
    onProgress: progress => { if (progress.stage === 'propagation' && progress.outcome === 'completed') cancelled = true; }
  });
  assert.equal(cancelled, true);
  assert.ok(files[0].callbackDiagnostics?.some(detail => detail.kind === 'cancelled' && detail.stage === 'registrations'));
  assert.ok(files[0].references.some(ref => ref.callKind === 'inferred' && ref.name === 'foo'));
  assert.ok(!analyzer.derive([raw])[0].issues.some(issue => /cancelled/.test(issue)));
});

test('cancelling the next round retains previously found targets as incomplete and allows retry', () => {
  const source = prelude + 'static CB cb;void setup(void){cb=foo;}void run(void){cb();}';
  const raw = { ...analyzer.analyze('file:///budget/cancel.c', source), expandMacros: false };
  let cancelled = false;
  const result = analyzer.derive([raw], undefined, undefined, true, {
    shouldCancel: () => cancelled,
    onProgress: progress => { if (progress.round === 2) cancelled = true; }
  });
  const index = new RelationIndex();result.forEach(file => index.update(file));
  const site = index.callbackAt(raw.uri, source.lastIndexOf('cb();') + 1)!;
  assert.deepEqual(site.targets.map(target => target.name), ['foo']);
  assert.equal(site.incomplete, true);
  assert.ok(result[0].callbackDiagnostics?.some(detail => detail.kind === 'cancelled'));
  const retried = analyzer.derive([raw]);
  assert.ok(!retried[0].issues.some(issue => /cancelled/.test(issue)));
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
