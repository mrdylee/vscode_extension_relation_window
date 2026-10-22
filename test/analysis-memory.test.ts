import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyzer } from '../src/analyzer';

const create = () => createAnalyzer('node_modules/web-tree-sitter/web-tree-sitter.wasm', 'node_modules/tree-sitter-c/tree-sitter-c.wasm');
async function collect() {
  assert.ok(global.gc, 'run with node --expose-gc --import tsx');
  // WeakRef targets stay alive until the end of the current JS job.
  for (let n = 0; n < 3; n++) { await new Promise<void>(resolve => setImmediate(resolve)); global.gc(); }
}
function populate(analyzer: Awaited<ReturnType<typeof create>>, name: string) {
  const raw = [analyzer.analyze(`file:///${name}.h`, '#define CALL(cb) cb()\ntypedef void (*CB)(void);'),
    analyzer.analyze(`file:///${name}.c`, `#include "${name}.h"\nvoid target(void){}void svc(CB);void run(void){CB cb=target;CALL(cb);svc(cb);}`)];
  const result = analyzer.derive(raw);
  assert.ok(result[1].references.some(ref => ref.name === 'target' && ref.callKind === 'inferred'));
  assert.deepEqual(result[1].functionArguments?.map(ref => ref.name), ['target']);
  return { raw, result, weakResult: new WeakRef(result[1]) };
}

test('reset releases macro and callback caches even when old source objects remain alive', async () => {
  const analyzer = await create(), other = await create();
  let first: ReturnType<typeof populate> | undefined = populate(analyzer, 'first');
  const raw = first.raw, weakResult = first.weakResult;
  const independent = populate(other, 'independent');
  first = undefined;
  analyzer.reset();
  await collect();
  assert.equal(weakResult.deref(), undefined, 'reset must release the cached derived result, not just raw input');
  assert.equal(other.derive(independent.raw)[1], independent.result[1], 'reset must not invalidate another analyzer');
  const rebuilt = analyzer.derive(raw);
  assert.ok(rebuilt[1].references.some(ref => ref.name === 'target' && ref.callKind === 'inferred'));
  assert.deepEqual(rebuilt[1].functionArguments?.map(ref => ref.name), ['target']);
});

test('successive projects release old callback results while a caller still holds their raw files', async () => {
  const analyzer = await create();
  let first: ReturnType<typeof populate> | undefined = populate(analyzer, 'first');
  const raw = first.raw, weakResult = first.weakResult;
  first = undefined;
  const second = populate(analyzer, 'second');
  await collect();
  assert.equal(weakResult.deref(), undefined, 'the project cache must retain only the current project');
  assert.equal(analyzer.derive(second.raw)[1], second.result[1]);
  assert.ok(raw[0].symbols.length, 'keep original source objects live through the collection check');
});

test('removing all function bodies from a file releases its old macro input', async () => {
  const analyzer = await create();
  let first: ReturnType<typeof populate> | undefined = populate(analyzer, 'edited');
  const header = first.raw[0], oldSource = new WeakRef(first.raw[1]);
  first = undefined;
  const replacement = analyzer.analyze('file:///edited.c', '#include "edited.h"\nvoid target(void);');
  const result = analyzer.derive([header, replacement]);
  assert.equal(result[1], replacement);
  await collect();
  assert.equal(oldSource.deref(), undefined, 'a file without bodies must not keep its previous macro cache alive');
});

test('an empty project releases the previous callback project cache', async () => {
  const analyzer = await create();
  let first: ReturnType<typeof populate> | undefined = populate(analyzer, 'removed');
  const oldSource = new WeakRef(first.raw[0]), oldResult = first.weakResult;
  first = undefined;
  assert.deepEqual(analyzer.derive([]), []);
  await collect();
  assert.equal(oldSource.deref(), undefined);
  assert.equal(oldResult.deref(), undefined);
});

test('shrinking detailed scope releases full programs and old derived results', async () => {
  const analyzer=await create();
  const source='typedef void(*CB)(void);void target(void){}void run(void){CB cb=target;cb();}';
  let full:ReturnType<typeof analyzer.analyze>|undefined=analyzer.analyze('file:///scope.c',source,true,{expandMacros:true,propagateCallbacks:true});
  const oldProgram=new WeakRef(full.programs!);
  let derived:ReturnType<typeof analyzer.derive>|undefined=analyzer.derive([full]);
  const oldResult=new WeakRef(derived[0]);full=undefined;derived=undefined;
  const basic=analyzer.analyze('file:///scope.c',source,true,{expandMacros:false,propagateCallbacks:false});
  analyzer.derive([basic]);await collect();
  assert.equal(basic.programs,undefined);
  assert.equal(oldProgram.deref(),undefined);
  assert.equal(oldResult.deref(),undefined);
});
