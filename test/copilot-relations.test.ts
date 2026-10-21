import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createAnalyzer } from '../src/analyzer';
import { RelationIndex } from '../src/relations';
import { applyCallbackHints } from '../src/copilot-relations';

test('AI candidates retain source evidence and appear in both directions without replacing unresolved calls', async () => {
  const parser = await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'), path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm'));
  const file = parser.analyze('file:///candidate.c', 'typedef void(*CB)(void); void target(void){} void run(CB cb){cb();}', true);
  const index = new RelationIndex(); index.update(file);
  const target = file.symbols.find(s => s.name === 'target')!;
  const run = file.symbols.find(s => s.name === 'run')!;
  const site = file.references.find(ref => ref.kind === 'call' && ref.name === 'cb')!;
  applyCallbackHints(index, [{ key: 'test', callsite: site.location, expression: 'cb', status: 'candidates', cached: false,
    candidates: [{ targetId: target.id, evidence: [target.location], reason: 'Registered candidate' }] }]);
  const outgoing = index.relations(run.id, 'callees');
  assert.ok(outgoing.some(group => group.name === 'cb'), 'unresolved evidence remains');
  const candidate = outgoing.find(group => group.name === 'target')!;
  assert.equal(candidate.callKind, 'ai-candidate');
  assert.equal(candidate.sites[0].ambiguous, true);
  assert.equal(index.relations(target.id, 'callers')[0].name, 'run');
  assert.equal(index.callbackAt(file.uri, site.location.start)?.incomplete, true);
  applyCallbackHints(index, []);
  assert.equal(index.relations(target.id, 'callers').length, 0);
  index.update({ ...file, references: [...file.references, { ...site, name: target.name, targetId: target.id, indirect: false, callKind: 'inferred' }] });
  applyCallbackHints(index, [{ key: 'same', callsite: site.location, expression: 'cb', status: 'candidates', cached: false,
    candidates: [{ targetId: target.id, evidence: [target.location], reason: 'Duplicate candidate' }] }]);
  assert.equal(index.relations(target.id, 'callers')[0].sites.length, 1, 'AI does not duplicate an already resolved static call');
  assert.equal(index.files.get(file.uri)!.references.some(ref => ref.callKind === 'ai-candidate'), false);
});
