import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createAnalyzer } from '../src/analyzer';
import { suggestExplicitCallbacks } from '../src/explicit-callbacks';
import { RelationIndex } from '../src/relations';

let analyzer: Awaited<ReturnType<typeof createAnalyzer>>;
before(async () => { analyzer = await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'), path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm')); });
const prelude = 'struct xxx {void (*cb_preprocess)(void);void (*cb_process)(void);};static void example_preprocess(void){}static void example_process(void){}';
const table = 'static const struct xxx bbb={.cb_preprocess=example_preprocess,.cb_process=example_process};';

test('a cancelled registration pass returns before scanning source and retains existing facts', () => {
  const raw = analyzer.analyze('file:///explicit-stop/early.c', prelude + 'void run(void){void(*cb)(void)=example_preprocess;cb();}');
  const complete = suggestExplicitCallbacks([raw], [raw]);
  const stopped = suggestExplicitCallbacks([raw], complete, { shouldCancel: () => true });
  assert.deepEqual(stopped[0].callbackRegistrations, complete[0].callbackRegistrations);
  assert.equal(stopped[0].references, complete[0].references);
  assert.ok(stopped[0].callbackDiagnostics?.some(detail => detail.kind === 'cancelled' && detail.stage === 'registrations'));
});

test('Stop within registration collection retains its prefix without caching it as complete', () => {
  const text = prelude + 'void(*cb)(void);void setup(void){' + 'cb=example_preprocess;'.repeat(10000) + '}';
  const raw = analyzer.analyze('file:///explicit-stop/middle.c', text);
  let cancelled = false, clock = 0;
  const stopped = suggestExplicitCallbacks([raw], [raw], {
    now: () => clock += 1000,
    shouldCancel: () => cancelled,
    onProgress: progress => { if (progress.symbol === 'setup' && progress.scopeEvaluations > 0) cancelled = true; }
  });
  const retained = stopped[0].callbackRegistrations ?? [];
  assert.equal(cancelled, true);
  assert.ok(retained.length > 0 && retained.length < 10000, String(retained.length));
  assert.ok(stopped[0].callbackDiagnostics?.some(detail => detail.kind === 'cancelled'));
  const retried = suggestExplicitCallbacks([raw], [raw]);
  assert.equal(retried[0].callbackRegistrations?.length, 10000);
  assert.ok(!retried[0].issues.some(issue => /cancelled/.test(issue)));
  assert.ok(retried[0].callbackRegistrations?.some(ref => ref.id === retained[0].id));
});
function project(sources: Record<string, string>, callbacks = false) {
  const raw = Object.entries(sources).map(([name, text]) => ({ ...analyzer.analyze('file:///demo/' + name, text), expandMacros: false }));
  const derived = analyzer.derive(raw, undefined, undefined, callbacks);
  const files = derived, index = new RelationIndex();
  files.forEach(file => index.update(file));
  return { raw, derived, files, index, refs: files.flatMap(file => file.references.filter(ref => ref.callKind === 'registered')) };
}

for (const callbacks of [false, true]) {
  test(`assignments without calls appear as registrations (full analysis ${callbacks})`, () => {
    const source = prelude + 'void run(void){void (*fp)(void)=example_preprocess;struct xxx local;local.cb_process=&example_process;}';
    const { files, index } = project({ 'main.c': source }, callbacks);
    const registrations = files[0].callbackRegistrations ?? [];
    assert.deepEqual(registrations.map(ref => ref.name), ['example_preprocess', 'example_process']);
    assert.ok(registrations.every(ref => ref.kind === 'reference' && ref.callKind === 'registered'));
    assert.deepEqual(registrations.map(ref => source.slice(ref.location.start, ref.location.end)), ['example_preprocess', '&example_process']);
    const run = index.symbols().find(symbol => symbol.name === 'run')!;
    const groups = index.relations(run.id, 'callees');
    assert.deepEqual(groups.map(group => group.name), ['example_preprocess', 'example_process']);
    assert.ok(groups.every(group => group.callKind === 'registered' && group.sites.every(site => site.kind !== 'call')));
    for (const name of ['example_preprocess', 'example_process']) {
      const target = index.symbols().find(symbol => symbol.name === name)!;
      assert.deepEqual(index.relations(target.id, 'callers').map(group => group.name), ['run']);
      assert.equal(index.graph(target.id, 'both', 1)?.callers?.[0].sites[0].kind, 'reference');
    }
  });
}

test('global pointer and aggregate initializers retain registration owners without calls', () => {
  const { files, index } = project({ 'main.c': prelude + table + 'static void (*fp)(void)=&example_preprocess;' });
  assert.deepEqual(files[0].callbackRegistrations?.map(ref => ref.name), ['example_preprocess', 'example_process', 'example_preprocess']);
  const target = index.symbols().find(symbol => symbol.name === 'example_preprocess')!;
  assert.deepEqual(index.relations(target.id, 'callers').map(group => group.name), ['bbb', 'fp']);
});

test('simple local/global pointers and local struct members resolve with full analysis off', () => {
  for (const body of [
    'void (*fp)(void)=example_preprocess;fp();',
    'void (*fp)(void);fp=&example_preprocess;fp();',
    'global=example_preprocess;global();',
    'struct xxx local={.cb_preprocess=example_preprocess};local.cb_preprocess();',
    'struct xxx local;local.cb_preprocess=example_preprocess;local.cb_preprocess();',
    'struct xxx local;struct xxx *p=&local;p->cb_preprocess=example_preprocess;p->cb_preprocess();'
  ]) {
    const { refs } = project({ 'main.c': prelude + 'void (*global)(void);void run(void){' + body + '}' });
    assert.deepEqual(refs.map(ref => ref.name), ['example_preprocess'], body);
  }
});

test('written registrations survive branches and loops without asserting later call targets', () => {
  const source = prelude + 'void run(int flag){void (*fp)(void);if(flag)fp=example_preprocess;while(flag){fp=&example_process;break;}fp();}';
  const { files, refs } = project({ 'main.c': source });
  assert.deepEqual(files[0].callbackRegistrations?.map(ref => ref.name), ['example_preprocess', 'example_process']);
  assert.deepEqual(refs, []);
});

test('direct writes through a structure pointer parameter are traceable without full analysis', () => {
  const source = prelude + 'void run(struct xxx *p){p->cb_preprocess=example_preprocess;p->cb_preprocess();}';
  const { refs } = project({ 'main.c': source });
  assert.deepEqual(refs.map(ref => ref.name), ['example_preprocess']);
});

test('static local initializers and pointers to local aggregate storage remain traceable', () => {
  for (const body of [
    'static void (*fp)(void)=example_preprocess;fp();',
    'struct xxx local={.cb_preprocess=example_preprocess};struct xxx *p=&local;p->cb_preprocess();'
  ]) {
    const { files, refs } = project({ 'main.c': prelude + 'void run(void){' + body + '}' });
    assert.deepEqual(refs.map(ref => ref.name), ['example_preprocess']);
    assert.deepEqual(files[0].callbackRegistrations?.map(ref => ref.name), ['example_preprocess']);
  }
});

test('unknown writes and address escapes remove simple pointer candidates but retain registration facts', () => {
  for (const middle of ['fp=0;', 'fp=get_unknown();', 'mutate(&fp);', 'if(flag)fp=0;']) {
    const source = prelude + 'void run(void){void (*fp)(void)=example_preprocess;' + middle + 'fp();}';
    const { files, refs } = project({ 'main.c': source });
    assert.deepEqual(files[0].callbackRegistrations?.map(ref => ref.name), ['example_preprocess']);
    assert.deepEqual(refs, [], middle);
  }
});

test('RHS calls, local shadows, inactive and unevaluated assignments are not literal registrations', () => {
  const source = prelude + 'void run(void){void (*fp)(void);fp=example_preprocess();fp=0;sizeof(fp=example_process);\n#if 0\nfp=example_process;\n#endif\n{int example_process=0;fp=example_process;}}';
  const { files } = project({ 'main.c': source });
  assert.deepEqual(files[0].callbackRegistrations ?? [], []);
});

test('registration projection is idempotent and removing a file removes its graph relationships', () => {
  const { raw, files, index } = project({ 'main.c': prelude + 'void run(void){void (*fp)(void)=example_preprocess;}' });
  assert.equal(suggestExplicitCallbacks(raw, files)[0], files[0]);
  const target = index.symbols().find(symbol => symbol.name === 'example_preprocess')!;
  assert.equal(index.relations(target.id, 'callers').length, 1);
  index.update({ ...files[0], callbackRegistrations: undefined });
  assert.deepEqual(index.relations(target.id, 'callers'), []);
});

test('literal registrations resolve the original bbb/ccc example without static propagation', () => {
  const source = prelude + table + 'static void run_callbacks(void){const struct xxx *ccc=&bbb;ccc->cb_preprocess();ccc->cb_process();}';
  const { files, index, refs } = project({ 'callback_example.c': source });
  assert.deepEqual(refs.map(ref => ref.name), ['example_preprocess', 'example_process']);
  assert.ok(refs.every(ref => ref.inference?.incomplete));
  assert.ok(refs.every(ref => ref.inference!.evidence.length >= 2));
  assert.ok(refs.every(ref => ref.inference!.reasons.some(reason => /not proof/i.test(reason))));
  assert.ok(files[0].references.some(ref => ref.indirect && ref.name === 'ccc->cb_preprocess'));
  assert.deepEqual(files[0].issues, []);
  const target = index.symbols().find(symbol => symbol.name === 'example_preprocess')!;
  assert.deepEqual(index.relations(target.id, 'callers').map(group => group.name), ['bbb', 'run_callbacks']);
  assert.deepEqual(index.callbackAt(files[0].uri, source.indexOf('ccc->cb_preprocess') + 5)?.targets.map(symbol => symbol.name), ['example_preprocess']);
});

test('the simple pass respects actual worker memory pressure', () => {
  const raw = { ...analyzer.analyze('file:///demo/pressure.c', prelude + table + 'void run(void){bbb.cb_preprocess();}'), expandMacros: false };
  assert.equal(analyzer.derive([raw], () => true, undefined, false).flatMap(file => file.references).some(ref => ref.callKind === 'registered'), false);
});

test('exact objects and static linkage isolate identical field and function names', () => {
  const { refs } = project({
    'one.c': prelude + table + 'static const struct xxx other={.cb_preprocess=example_process};void run(void){const struct xxx *p=&bbb;p->cb_preprocess();p=&other;p->cb_preprocess();}',
    'two.c': 'struct xxx {void (*cb_preprocess)(void);};static void example_preprocess(void){}static const struct xxx bbb={.cb_preprocess=example_preprocess};'
  });
  assert.deepEqual(refs.map(ref => ref.name), ['example_preprocess', 'example_process']);
  assert.ok(refs.every(ref => ref.targetId?.startsWith('file:///demo/one.c')));
});

test('shadowed, unknown, conditional and escaped aliases never reuse a stale object', () => {
  for (const body of [
    'struct xxx bbb;const struct xxx *p=&bbb;p->cb_preprocess();',
    'const struct xxx *p=&bbb;p=get_unknown();p->cb_preprocess();',
    'const struct xxx *p=&bbb;if(flag)p=0;p->cb_preprocess();',
    'const struct xxx *p=&bbb;mutate(&p);p->cb_preprocess();',
    'const struct xxx *p=&bbb;mutate((void*)&p);p->cb_preprocess();'
  ]) assert.deepEqual(project({ 'main.c': prelude + table + 'void run(void){' + body + '}' }).refs, [], body);
});

test('an explicit reassignment restores a pointer after a cast-wrapped address escape', () => {
  const source = prelude + table + 'void run(void){const struct xxx *p=&bbb;mutate((void*)&p);p=&bbb;p->cb_preprocess();}';
  assert.deepEqual(project({ 'main.c': source }).refs.map(ref => ref.name), ['example_preprocess']);
});

test('pointer-storage escapes through assignments and nested evaluated expressions invalidate aliases', () => {
  for (const middle of [
    'const struct xxx **pp=&p;*pp=&other;',
    'const struct xxx **slots[]={&p};*slots[0]=&other;',
    'get_object(&p)->field;',
    'values[change(&p)];',
    'values[change(&p)]=0;',
    '(*get_callback(&p))();'
  ]) {
    const source = prelude + table + 'static const struct xxx other={.cb_preprocess=example_process};void run(void){const struct xxx *p=&bbb;' + middle + 'p->cb_preprocess();}';
    assert.deepEqual(project({ 'main.c': source }).refs, [], middle);
  }
});

test('addressing pointer storage and excessive dereferences never reuse its pointee', () => {
  for (const body of [
    'const struct xxx *p=&bbb;const struct xxx *q=(const struct xxx *)&p;q->cb_preprocess();',
    'const struct xxx *p=&bbb;(**(const struct xxx **)p).cb_preprocess();',
    'const struct xxx *p=&bbb;const struct xxx copy=bbb;copy.cb_preprocess();',
    'void (*q)(void)=(void(*)(void))&bbb.cb_preprocess;q();'
  ]) assert.deepEqual(project({ 'main.c': prelude + table + 'void run(void){' + body + '}' }).refs, [], body);
});

test('a pointer to a callback slot requires dereferencing before invoking its registered value', () => {
  const source = prelude + table + 'void run(void){void (**q)(void)=&bbb.cb_preprocess;(*q)();}';
  assert.deepEqual(project({ 'main.c': source }).refs.map(ref => ref.name), ['example_preprocess']);
});

test('ordinary pointer casts, one dereference and address-of-dereference preserve exact aliases', () => {
  const source = prelude + table + 'void run(void){const struct xxx *p=&bbb;const struct xxx *q=(const struct xxx *)p;(*q).cb_preprocess();q=&*p;q->cb_process();}';
  assert.deepEqual(project({ 'main.c': source }).refs.map(ref => ref.name), ['example_preprocess', 'example_process']);
});

test('known writes replace registrations and unknown writes remove them at later calls', () => {
  const { refs } = project({ 'main.c': prelude + table.replace('const ', '') + 'void run(void){const struct xxx *p=&bbb;bbb.cb_preprocess=example_process;p->cb_preprocess();bbb.cb_preprocess=0;p->cb_preprocess();}' });
  assert.deepEqual(refs.map(ref => ref.name), ['example_process']);
});

test('unevaluated and inactive calls produce no registration candidates', () => {
  const source = prelude + table + 'void run(void){const struct xxx *p=&bbb;sizeof(p->cb_preprocess());\n#if 0\np->cb_process();\n#endif\n}';
  assert.deepEqual(project({ 'main.c': source }).refs, []);
});

test('unrelated objects do not exhaust the simple registration pass', () => {
  const unrelated = Array.from({ length: 350 }, (_, n) => `static const struct xxx other${n}={.cb_preprocess=example_process};`).join('');
  const { files, refs } = project({ 'main.c': prelude + table + unrelated + 'void run(void){const struct xxx *p=&bbb;p->cb_preprocess();}' });
  assert.deepEqual(refs.map(ref => ref.name), ['example_preprocess']);
  assert.deepEqual(files.flatMap(file => file.issues), []);
});

test('overlong alias chains are skipped without suppressing independent short registrations', () => {
  const aliases = Array.from({ length: 2200 }, (_, n) => `const struct xxx *p${n}=${n ? `p${n - 1}` : '&bbb'};`).join('');
  const source = prelude + table + `void run(void){${aliases}p0->cb_preprocess();p15->cb_preprocess();p16->cb_preprocess();p2199->cb_preprocess();const struct xxx *fresh=&bbb;fresh->cb_process();}`;
  const { refs, files } = project({ 'main.c': source });
  assert.deepEqual(refs.map(ref => ref.inference?.expression), ['p0->cb_preprocess', 'p15->cb_preprocess', 'fresh->cb_process']);
  assert.ok(refs.every(ref => ref.inference!.evidence.length <= 17));
  assert.deepEqual(files.flatMap(file => file.issues), []);
});

test('existing static edges and repeated projection never duplicate candidates', () => {
  const source = prelude + table + 'void run(void){const struct xxx *p=&bbb;p->cb_preprocess();}';
  const full = project({ 'main.c': source }, true);
  assert.deepEqual(full.refs, []);
  const basic = project({ 'main.c': source });
  assert.equal(suggestExplicitCallbacks(basic.raw, basic.files)[0], basic.files[0]);
});
