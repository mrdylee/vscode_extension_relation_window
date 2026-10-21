import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAnalyzer } from '../src/analyzer';
import { CopilotCallbackController, CopilotSnapshot } from '../src/copilot-callbacks';

let analyzer: Awaited<ReturnType<typeof createAnalyzer>>;
before(async () => { analyzer = await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'), path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm')); });
function snapshot(count = 7): CopilotSnapshot {
  const text = 'struct Ops {void(*cb)(void);};' + Array.from({length:count}, (_, n) => `void run${n}(struct Ops*p){p->cb();}`).join('');
  return {generation:1,settingsKey:'off-mode',files:[analyzer.analyze('file:///progress.c',text)]};
}
const noCandidate = JSON.stringify({status:'not-found',candidates:[]});

test('Copilot progress reports detected total before response and continues five then two', async t => {
  const cacheDir = await mkdtemp(path.join(tmpdir(),'dynsight-progress-'));
  t.after(() => rm(cacheDir,{recursive:true,force:true}));
  let release!:()=>void, entered!:()=>void, requests=0;
  const held=new Promise<void>(r=>release=r), started=new Promise<void>(r=>entered=r);
  const progress: any[]=[];
  const controller=new CopilotCallbackController({cacheDir,isCurrent:()=>true,onProgress:value=>progress.push({...value}),
    provider:{modelKey:'test',complete:async()=>{requests++;if(requests===1){entered();await held;}return noCandidate;}}});
  t.after(()=>controller.dispose());
  const s=snapshot(), pending=controller.analyzeUnresolved(s,{reason:'enabled'});
  await started;
  try { assert.equal(progress.at(-1)?.total,7); assert.equal(progress.at(-1)?.completed,0); assert.equal(progress.at(-1)?.remaining,7); }
  finally { release(); }
  const first=await pending;
  assert.equal(first.total,7); assert.equal(first.completed,5); assert.equal(first.remaining,2);
  assert.equal(progress.at(-1).notFound,5,'no-candidate is a processed result');
  const second=await controller.analyzeUnresolved(s,{reason:'enabled'});
  assert.equal(second.requested,2); assert.equal(second.cached,5);
  assert.equal(second.completed,7); assert.equal(second.remaining,0); assert.equal(requests,7);
  const restored=await controller.restore(s);
  assert.equal(restored.completed,7); assert.equal(restored.requested,0); assert.equal(requests,7);
});

test('failed requests remain unfinished and stale replies cannot publish completed progress',async t=>{
  const cacheDir=await mkdtemp(path.join(tmpdir(),'dynsight-progress-failure-'));
  t.after(()=>rm(cacheDir,{recursive:true,force:true}));
  let current=true,fail=true,release!:()=>void,entered!:()=>void;
  const held=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r),progress:any[]=[];
  const controller=new CopilotCallbackController({cacheDir,isCurrent:()=>current,onProgress:value=>progress.push({...value}),
    provider:{modelKey:'test',complete:async()=>{if(fail)throw new Error('denied');entered();await held;return noCandidate;}}});
  t.after(()=>controller.dispose());
  const failed=await controller.analyzeUnresolved(snapshot(1),{reason:'enabled'});
  assert.equal(failed.total,1);assert.equal(failed.completed,0);assert.equal(failed.remaining,1);assert.equal(failed.failures,1);
  fail=false;const pending=controller.analyzeUnresolved(snapshot(1),{reason:'enabled'});await started;
  current=false;controller.invalidate();const before=progress.length;release();
  assert.equal((await pending).stale,true);assert.equal(progress.length,before);
  assert.equal(progress.at(-1).completed,0);
});
