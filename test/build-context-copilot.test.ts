import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createAnalyzer } from '../src/analyzer';
import { contextualizeFacts } from '../src/build-analysis';
import { callbackContexts } from '../src/copilot-context';
import { applyCallbackHints } from '../src/copilot-relations';
import { RelationIndex } from '../src/relations';
import { CallbackOverrideStore, makeCallbackOverride } from '../src/callback-overrides';

async function facts() {
  const parser = await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'), path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm'));
  const text = 'typedef void(*CB)(void);static void one(void){}static void two(void){}static void run(CB cb){cb();}';
  const raw = parser.analyze('file:///p/ops.h', text);
  return ['a', 'b'].map(key => contextualizeFacts(raw, { profileId: 'A', unitId: key, key, configurationFingerprint: 'config-A',
    prepared: { key, uri: raw.uri, text, maskedText: text, entryEnvironmentFingerprint: key, inactive: [], timeline: [], resolvedIncludes: [] } }));
}
test('AI contexts and hints distinguish header call sites in separate units', async () => {
  const files = await facts(), contexts = callbackContexts(files);
  assert.equal(contexts.length, 2); assert.notEqual(contexts[0].key, contexts[1].key);
  assert.notEqual(contexts[0].fingerprint, contexts[1].fingerprint);
  assert.ok(contexts[0].snippets.every(s => s.location.context === 'a'));
  const index = new RelationIndex(); files.forEach(file => index.update(file));
  const target = files[0].symbols.find(s => s.name === 'one')!;
  applyCallbackHints(index, [{ key: contexts[0].key, callsite: contexts[0].callsite, expression: 'cb', status: 'candidates', cached: false, candidates: [{ targetId: target.id, evidence: [target.location], reason: 'candidate' }] }]);
  assert.ok(index.files.get('a')!.references.some(ref => ref.callKind === 'ai-candidate'));
  assert.ok(!index.files.get('b')!.references.some(ref => ref.callKind === 'ai-candidate'));
});
test('manual callback overrides require review after a build fingerprint change', async () => {
  const [file] = await facts(), index = new RelationIndex(); index.update(file);
  const call = file.references.find(ref => ref.kind === 'call')!, one = file.symbols.find(s => s.name === 'one')!, two = file.symbols.find(s => s.name === 'two')!;
  const override = makeCallbackOverride(index, call.location, one.id, two.id), store = new CallbackOverrideStore([override]);
  assert.equal(store.resolve(index)[0].status, 'active');
  index.update({ ...file, context: { ...file.context!, configurationFingerprint: 'config-B' } });
  assert.equal(store.resolve(index)[0].status, 'needs-review');
});
test('build metadata cannot bypass the bounded AI source context',async()=>{
  const [file]=await facts(),location=file.symbols[0].location;
  file.context!.prepared.timeline.push({offset:-1,inherited:true,value:{kind:'define',location,conditions:[],macro:{name:'LARGE',body:'x'.repeat(20000),location,conditions:[]}}});
  const context=callbackContexts([file])[0];
  assert.ok(context.build!.macros.every(macro=>macro.body.length<=128));
  assert.equal(context.build!.macrosTruncated,true);
});
