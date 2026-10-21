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
function project(sources: Record<string, string>, callbacks = false) {
  const raw = Object.entries(sources).map(([name, text]) => ({ ...analyzer.analyze('file:///demo/' + name, text), expandMacros: false }));
  const derived = analyzer.derive(raw, undefined, undefined, callbacks);
  const files = derived, index = new RelationIndex();
  files.forEach(file => index.update(file));
  return { raw, derived, files, index, refs: files.flatMap(file => file.references.filter(ref => ref.callKind === 'registered')) };
}

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
  assert.deepEqual(index.relations(target.id, 'callers').map(group => group.name), ['run_callbacks']);
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
