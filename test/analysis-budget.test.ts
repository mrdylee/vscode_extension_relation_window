import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisWorkBudget } from '../src/analysis-budget';
import { createAnalyzer } from '../src/analyzer';
test('work is cumulative across repeated evaluations of a function', () => {
  const budget = new AnalysisWorkBudget({functionWork:3,projectWork:20});
  assert.equal(budget.consume('run',2),'ok');
  assert.equal(budget.consume('other',1),'ok');
  assert.equal(budget.consume('run',2),'function-limit');
});
test('project budget covers many independent functions', () => {
  const budget = new AnalysisWorkBudget({functionWork:10,projectWork:3});
  assert.equal(budget.consume('a',2),'ok');
  assert.equal(budget.consume('b',2),'project-limit');
});
test('engine retains direct calls and records partial reasons when project work is exhausted',async()=>{
  const parser=await createAnalyzer('node_modules/web-tree-sitter/web-tree-sitter.wasm','node_modules/tree-sitter-c/tree-sitter-c.wasm');
  const raw=parser.analyze('file:///budget.c','typedef void(*CB)(void);void target(void){}void direct(void){}void run(CB cb){direct();cb();}');
  const [result]=parser.derive([raw],undefined,undefined,true,{workLimits:{functionWork:1,projectWork:1}});
  assert.ok(result.references.some(ref=>ref.kind==='call'&&ref.name==='direct'));
  assert.ok(result.issues.some(issue=>/work limit/.test(issue)));
  assert.ok(result.references.some(ref=>ref.analysis?.status==='work-limit'),'unresolved calls retain the work limit reason');
});
test('one expensive function does not remove an independent callback target',async()=>{
  const parser=await createAnalyzer('node_modules/web-tree-sitter/web-tree-sitter.wasm','node_modules/tree-sitter-c/tree-sitter-c.wasm');
  const source='typedef void(*CB)(void);void target(void){}void busy(void){int i=0;'+('i=i+1;').repeat(100)+'}void good(void){CB cb=target;cb();}';
  const raw=parser.analyze('file:///independent.c',source,true,{expandMacros:false,propagateCallbacks:true});
  const [result]=parser.derive([raw],undefined,undefined,true,{workLimits:{functionWork:100,projectWork:10000}});
  assert.ok(result.issues.some(issue=>issue.includes('function work limit')));
  assert.ok(result.references.some(ref=>ref.callKind==='inferred'&&ref.name==='target'));
});
