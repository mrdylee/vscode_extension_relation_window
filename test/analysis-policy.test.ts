import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAnalysisPolicy } from '../src/analysis-policy';

test('explicit empty detailed folders overrides legacy all-on', () => {
  assert.deepEqual(resolveAnalysisPolicy('App/main.c', [], { macroFolders: ['**'], analyzeCallbacks: true }, false),
    { expandMacros: false, propagateCallbacks: false });
});
test('one folder controls both expensive stages without widening the rest', () => {
  assert.deepEqual(resolveAnalysisPolicy('App/main.c', ['App/**'], undefined, false), { expandMacros: true, propagateCallbacks: true });
  assert.deepEqual(resolveAnalysisPolicy('SDK/main.c', ['App/**'], undefined, false), { expandMacros: false, propagateCallbacks: false });
});
test('legacy macro and callback scope remain independent until explicitly migrated', () => {
  assert.deepEqual(resolveAnalysisPolicy('SDK/main.c', undefined, { macroFolders: ['App/**'], analyzeCallbacks: true }, false),
    { expandMacros: false, propagateCallbacks: true });
  assert.deepEqual(resolveAnalysisPolicy('App/main.c', undefined, undefined, false), { expandMacros: false, propagateCallbacks: false });
});
test('Windows slashes and case are normalized only when requested', () => {
  assert.equal(resolveAnalysisPolicy('APP\\main.c', ['App/**'], undefined, true).propagateCallbacks, true);
  assert.equal(resolveAnalysisPolicy('APP/main.c', ['App/**'], undefined, false).propagateCallbacks, false);
});
