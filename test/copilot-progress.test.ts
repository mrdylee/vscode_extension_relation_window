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

test('automatic analysis processes all 38 sites with cumulative progress and reuses cache', async t => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'dynsight-auto-'));
  t.after(() => rm(cacheDir, {recursive:true, force:true}));
  let requests = 0;
  const completed: number[] = [];
  const c = new CopilotCallbackController({cacheDir, isCurrent:() => true,
    onProgress:value => completed.push(value.completed),
    provider:{modelKey:'auto', complete:async () => { requests++; return noCandidate; }}});
  t.after(() => c.dispose());
  const s = snapshot(38), result = await c.analyzeUnresolved(s, {reason:'enabled', automatic:true});
  assert.equal(result.completed, 38); assert.equal(result.remaining, 0); assert.equal(requests, 38);
  assert.ok(completed.every((value, n) => !n || value >= completed[n - 1]), 'progress never resets at a batch boundary');
  assert.equal((await c.analyzeUnresolved(s, {reason:'enabled', automatic:true})).cached, 38);
  assert.equal(requests, 38);
  assert.equal((await c.analyzeUnresolved(s, {reason:'force', automatic:true})).completed, 38);
  assert.equal(requests, 76, 'forced analysis invalidates the old cache once and visits each site once');
});

test('stopping automatic analysis preserves completed results and resumes only missing sites', async t => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'dynsight-auto-stop-'));
  t.after(() => rm(cacheDir, {recursive:true, force:true}));
  let requests = 0, started!:() => void;
  const held = new Promise<void>(resolve => { started = resolve; });
  let hints = 0;
  const c = new CopilotCallbackController({cacheDir, isCurrent:() => true, onHints:value => { hints = value.length; },
    provider:{modelKey:'auto', complete:async (_prompt, signal) => {
      if (++requests !== 8) return noCandidate;
      started();
      return new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')), {once:true}));
    }}});
  t.after(() => c.dispose());
  const s = snapshot(12), pending = c.analyzeUnresolved(s, {reason:'enabled', automatic:true});
  await held; c.stop();
  const result = await pending;
  assert.equal(result.stopped, true); assert.equal(result.stale, false);
  assert.equal(result.completed, 7); assert.equal(result.failures, 0); assert.equal(hints, 7);
  const restored = await c.restore(s);
  assert.equal(restored.cached, 7); assert.equal(restored.remaining, 5); assert.equal(requests, 8);
  const resumed = await c.analyzeUnresolved(s, {reason:'enabled', automatic:true});
  assert.equal(resumed.completed, 12); assert.equal(resumed.requested, 5);
});

test('automatic analysis stops new requests after an error instead of retrying indefinitely', async t => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'dynsight-auto-failure-'));
  t.after(() => rm(cacheDir, {recursive:true, force:true}));
  let requests = 0;
  const c = new CopilotCallbackController({cacheDir, isCurrent:() => true,
    provider:{modelKey:'auto', complete:async () => { if (++requests === 3) throw new Error('quota'); return noCandidate; }}});
  t.after(() => c.dispose());
  const result = await c.analyzeUnresolved(snapshot(38), {reason:'enabled', automatic:true});
  assert.equal(requests, 3); assert.equal(result.completed, 2);
  assert.equal(result.failures, 1); assert.equal(result.remaining, 36);
});

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
