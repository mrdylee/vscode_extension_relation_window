import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import path from 'node:path';

test('worker applies selected build options and returns contextual facts for A to B to A', async () => {
  const worker = new Worker(path.resolve('dist/analysis-worker.cjs'), { workerData: { assets: path.resolve('dist') } });
  let serial = 0; const pending = new Map();
  worker.on('message', message => { const job = pending.get(message.id); if (!job) return; pending.delete(message.id); clearTimeout(job.timer); message.error ? job.reject(new Error(message.error)) : job.resolve(message.result); });
  worker.on('error', error => { for (const job of pending.values()) { clearTimeout(job.timer); job.reject(error); } pending.clear(); });
  const request = data => {
    const id = ++serial;
    return { id, promise: new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Worker response timeout')), 5000); pending.set(id, { resolve, reject, timer }); worker.postMessage({ ...data, id }); }) };
  };
  const profile = mode => ({ id: 'A', fingerprint: 'mode-' + mode,
    entry: { id: 'A', rootUri: 'file:///p', entryUri: 'file:///p/Makefile', cwdUri: 'file:///p', dialect: 'make', args: [], evidence: [] },
    units: [{ id: 'main-unit', fingerprint: 'main-' + mode, profileId: 'A', sourceUri: 'file:///p/main.c', cwdUri: 'file:///p', argv: ['gcc', '-DMODE=' + mode, '-Iinc', '-c', 'main.c'], dialect: 'posix', evidence: [], compiler: 'gcc', status: 'resolved', membership: 'included', builtins: 'unknown',
      macroActions: [{ kind: 'define', name: 'MODE', replacement: String(mode) }], includeSearch: [{ kind: 'user', uri: 'file:///p/inc' }], forcedInputs: [], dependencies: [], issues: [] }],
    coverage: 'partial', dependencies: [], relevantEnvironment: [], issues: [] });
  try {
    const versions = [];
    for (const [uri, text] of [['file:///p/main.c', '#include "ops.h"\nvoid run(void){RUN();}'], ['file:///p/inc/ops.h', 'static void first(void){}static void second(void){}\n#if MODE==1\n#define RUN() first()\n#else\n#define RUN() second()\n#endif']]) {
      const job = request({ uri, text, skip: true, expandMacros: true, propagateCallbacks: true }); await job.promise; versions.push([uri, job.id, -job.id]);
    }
    for (const mode of [1, 2, 1]) {
      const epoch = { profileId: 'A', fingerprint: 'mode-' + mode, contextRevision: mode, sourceRevision: 1 };
      const result = await request({ type: 'derive', versions, buildProfile: profile(mode), buildEpoch: epoch, buildScope: { rootUri: 'file:///p', include: [], exclude: [] } }).promise;
      assert.deepEqual(result.buildEpoch, epoch);
      assert.ok(result.buildFiles?.length >= 2);
      const main = result.buildFiles.find(file => file.uri.endsWith('/main.c'));
      assert.deepEqual(main.references.filter(ref => ref.callKind === 'expanded').map(ref => ref.name), [mode === 1 ? 'first' : 'second']);
      assert.ok(main.references.every(ref => ref.location.uri === 'file:///p/main.c'));
    }
  } finally { await worker.terminate(); }
});
