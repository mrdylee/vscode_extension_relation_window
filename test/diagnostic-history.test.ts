import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DiagnosticHistory, collectHostLogs } from '../src/diagnostic-history';

async function folder(t: any) { const dir = await mkdtemp(path.join(os.tmpdir(), 'dynsight-history-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
test('records survive a new session and only three sessions are retained', async t => {
  const dir = await folder(t);
  for (let n = 1; n <= 4; n++) { const h = new DiagnosticHistory(dir, `20261020T10000${n}-1`); h.record({ event: `run${n}` }); await h.flush(); }
  const h = new DiagnosticHistory(dir, '20261020T100004-1');
  const report = await h.read();
  assert.match(report, /run2/); assert.match(report, /run4/); assert.doesNotMatch(report, /run1/);
  assert.equal((await readdir(dir)).filter(f => f.endsWith('.jsonl')).length, 3);
});
test('journal rotation and pending writes are bounded; newest record survives', async t => {
  const dir = await folder(t), h = new DiagnosticHistory(dir, '20261020T100001-1');
  for (let n = 0; n < 300; n++) { h.record({ n, padding: 'x'.repeat(6000) }); await h.flush(); }
  for (let n = 0; n < 200; n++) h.record({ event: 'burst', n });
  h.record({ event: 'newest' }); await h.flush();
  const files = await readdir(dir); assert.ok(files.length <= 2);
  for (const f of files) assert.ok((await stat(path.join(dir, f))).size <= 256 * 1024);
  assert.match(await h.read(), /newest/); assert.ok(h.dropped > 0);
});
test('storage failure is reported without rejecting or disabling the report', async t => {
  const dir = await folder(t), file = path.join(dir, 'not-a-directory'); await writeFile(file, 'x');
  const h = new DiagnosticHistory(file); h.record({ event: 'startup' }); await h.flush();
  assert.match(await h.read(), /unavailable/);
});
test('host collection includes prior session exits and current starts; redacts roots and skips unrelated logs', async t => {
  const dir = await folder(t), previous = path.join(dir, '20261020T090000'), current = path.join(dir, '20261020T100000');
  for (const root of [previous, current]) await mkdir(path.join(root, 'exthost1', 'dylee.dynsight'), { recursive: true });
  await writeFile(path.join(previous, 'remoteagent.log'), '[info] Extension Host Process exited with code: 9, signal: SIGKILL\n');
  await writeFile(path.join(current, 'exthost1', 'exthost.log'), '[info] Extension host with pid 11383 started\n[error] FATAL ERROR heap out of memory /home/dylee/work/private.c https://host/home/dylee?token=SECRET\nUNRELATED_PRIVATE\n');
  await writeFile(path.join(current, 'exthost1', 'private.log'), 'PRIVATE_EXT_LOG');
  const report = await collectHostLogs(path.join(current, 'exthost1', 'dylee.dynsight'), ['/home/dylee']);
  assert.match(report, /SIGKILL/); assert.match(report, /11383/); assert.match(report, /heap out of memory/);
  assert.doesNotMatch(report, /UNRELATED_PRIVATE|PRIVATE_EXT_LOG|\/home\/dylee|SECRET/);
  assert.match(report, /missing/);
});
test('unknown host layout is explicit; tail reads and output stay bounded', async t => {
  const dir = await folder(t);
  assert.match(await collectHostLogs(path.join(dir, 'arbitrary')), /unsupported/);
  const host = path.join(dir, '20261020T100000', 'window1', 'exthost'); await mkdir(host, { recursive: true });
  await writeFile(path.join(host, 'exthost.log'), 'Extension host OLD\n' + 'z'.repeat(100000) + '\nExtension host with pid 42 started\n');
  const report = await collectHostLogs(path.join(host, 'dylee.dynsight'));
  assert.match(report, /42/); assert.doesNotMatch(report, /OLD/); assert.ok(report.length < 10000);
});

test('report reads persisted records without waiting indefinitely for pending writes', async t => {
  const dir = await folder(t), h = new DiagnosticHistory(dir);
  h.record({ event: 'persisted' }); await h.flush();
  h.flush = () => new Promise<void>(() => {});
  let timer: ReturnType<typeof setTimeout>;
  try {
    const report = await Promise.race([h.read(), new Promise<string>((_, reject) => { timer = setTimeout(() => reject(Error('Report waited for pending writes')), 1000); })]);
    assert.match(report, /persisted/); assert.match(report, /pending writes/);
  } finally { clearTimeout(timer!); }
});
