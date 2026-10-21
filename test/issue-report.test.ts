import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createIssueReport, ISSUE_URL, IssueReportInput } from '../src/issue-report';

const now = Date.UTC(2026, 9, 18);
const sample = { at: now - 2000, heapUsed: 256 * 1048576, heapLimit: 1024 * 1048576, external: 32 * 1048576 };
function input(): IssueReportInput {
  return { now, version: '0.1.40', vscodeVersion: '1.105.0', platform: 'linux', arch: 'x64', remoteName: 'wsl',
    scopes: [{ include: 2, exclude: 1, macroMode: 'selected', macroPatterns: 1 }],
    state: { status: 'Partial index: memory budget reached. Narrow Include/Exclude, then Rebuild index.', fileCount: 1820,
      mode: 'both', depth: 2, locked: true, skipInactive: true, accessFilter: 'all', calleeSort: 'source',
      contextLayout: 'separate', callGraphDirection: 'callees-left', includeFunctionArguments: true, analyzeCallbacks: false, candidates: [],
      issues: ['secret/file.c: Callback analysis memory budget reached; targets may be incomplete.', 'secret/file.c: Line 60: incomplete or unsupported C syntax'] },
    diagnostics: { environment: 'secret-host', host: sample, workerError: 'ERR_WORKER_OUT_OF_MEMORY secret/path',
      worker: { run: 'secret-run', phase: 'callbacks', sample, peakHeap: 300 * 1048576,
        phases: { callbacks: { before: sample, after: sample } }, firstLimit: { phase: 'callbacks', sample },
        counts: { files: 1820, sourceChars: 6000000, references: 82000, programs: 12000, macroFiles: 196 } } } };
}
test('report contains actionable version, state, counts and memory checkpoints', () => {
  const report = createIssueReport(input());
  for (const text of ['0.1.40', '1.105.0', 'wsl', '1820', '256', '1024', 'callbacks', 'memory-budget', 'syntax', 'worker-out-of-memory', 'sampleAgeSeconds', 'Reproduction steps']) assert.ok(report.includes(text), text);
  assert.match(report, /"analyzeCallbacks": false/);
  assert.ok(report.includes('public'));
  assert.ok(report.includes('not total system RAM'));
});
test('report projects allowed fields instead of leaking source, paths, symbols or raw errors', () => {
  const value = input();
  value.state.graph = { root: { name: 'SECRET_SYMBOL', location: { uri: 'file:///SECRET_PATH' } } } as any;
  value.state.context = { text: 'SECRET_SOURCE', path: 'SECRET_PATH' } as any;
  (value.scopes[0] as any).patterns = ['SECRET_INCLUDE'];
  value.state.issues.push('SECRET_UNKNOWN_ERROR');
  value.state.callbackDiagnostics = [{kind:'mutation',stage:'propagation',message:'Callback mutation limit',
    elapsedMs:1,scopeElapsedMs:1,evaluations:1,scopeEvaluations:1,
    storage:{operation:'write',retained:256,omitted:'SECRET_STORAGE',sample:['SECRET_RETAINED']},
    costs:[{symbol:'SECRET_FUNCTION',runs:3,cacheHits:2,evaluations:10,elapsedMs:1,
      location:{uri:'file:///SECRET_PATH',start:0,end:1,line:0,column:0,endLine:0,endColumn:1}}]}];
  const report = createIssueReport(value);
  assert.doesNotMatch(report, /secret|SECRET/);
  assert.match(report, /other/);
  value.state.status = 'Index error: SECRET_EXCEPTION';
  assert.doesNotMatch(createIssueReport(value), /SECRET/);
});
test('missing Worker and unrecognized values yield a bounded report immediately', () => {
  const value = input();
  delete value.diagnostics.worker; delete value.diagnostics.workerError;
  value.remoteName = 'SECRET_CUSTOM_REMOTE';
  value.state.issues = Array.from({ length: 10000 }, () => 'SECRET_ERROR_' + 'x'.repeat(200));
  const report = createIssueReport(value);
  assert.match(report, /10000/);
  assert.match(report, /unavailable/);
  assert.doesNotMatch(report, /SECRET/);
  assert.ok(report.length < 6000, String(report.length));
});
test('browser URL is fixed and never carries diagnostic data or requires a template', () => {
  const url = new URL(ISSUE_URL);
  assert.equal(url.origin, 'https://github.com');
  assert.equal(url.pathname, '/mrdylee/vscode_extension_relation_window/issues/new');
  assert.ok(url.searchParams.get('body')?.includes('Paste'));
  assert.equal(url.searchParams.has('template'), false);
  assert.ok(ISSUE_URL.length < 700);
});

test('cache and AI diagnostics expose bounded counters without model names or source data', () => {
  const value = input();
  value.diagnostics.index = { sessionStartedAt: now, rebuildCount: 0, sourceParses: 0, relationPasses: 0, rebuilds: [],
    cache: { state: 'restored', restored: 196, saved: 196 } };
  value.diagnostics.copilot = { state: 'model-selection-required', requests: 5, cacheHits: 7, remaining: 2, failures: 1,
    candidates: 3, notFound: 4, contextLimited: 2, model: 'SECRET_MODEL', prompt: 'SECRET_SOURCE' } as any;
  const report = createIssueReport(value), data = JSON.parse(report.split('```json\n')[1].split('\n```')[0]);
  assert.equal(data.diskCache.restored, 196);
  assert.equal(data.copilot.state, 'model-selection-required');
  assert.equal(data.copilot.requests, 5);
  assert.equal(data.copilot.contextLimited, 2);
  value.diagnostics.copilot!.waitReason = 'unsaved-sources';
  assert.match(createIssueReport(value), /"waitReason": "unsaved-sources"/);
  value.diagnostics.copilot!.waitReason = 'SECRET_SOURCE_PATH' as any;
  assert.doesNotMatch(createIssueReport(value), /SECRET/);
  assert.doesNotMatch(report, /SECRET/);
});

test('report includes bounded rebuild reasons without source details or arbitrary settings', () => {
  const value = input();
  (value.diagnostics as any).index = { sessionStartedAt: now - 10000, rebuildCount: 12, sourceParses: 20, relationPasses: 3,
    lastSourceEvent: { at: now - 1000, kind: 'editor-close', uri: 'SECRET_SOURCE' },
    rebuilds: Array.from({ length: 12 }, (_, i) => ({ number: i + 1, at: now - 2000, finishedAt: now - 1000,
      reason: i === 11 ? 'configuration' : 'SECRET_REASON', settings: ['include', 'SECRET_PATTERN'], outcome: 'completed', rawError: 'SECRET_ERROR' })) };
  const report = createIssueReport(value), data = JSON.parse(report.split('```json\n')[1].split('\n```')[0]);
  assert.ok(data.index, 'report must include rebuild diagnostics');
  assert.equal(data.index.rebuildCount, 12);
  assert.equal(data.index.rebuilds.length, 5);
  assert.equal(data.index.rebuilds.at(-1).reason, 'configuration');
  assert.deepEqual(data.index.rebuilds.at(-1).settings, ['include']);
  assert.equal(data.index.rebuilds.at(-1).durationMs, 1000);
  assert.equal(data.index.lastSourceEvent.kind, 'editor-close');
  assert.doesNotMatch(report, /SECRET/);
});

test('report includes file-loss checkpoints without exporting discovered paths', () => {
  const value = input();
  value.state.status = 'Partial index: 2 file(s) failed. See Analysis notices.';
  value.diagnostics.index = { sessionStartedAt: now, rebuildCount: 1, sourceParses: 1, relationPasses: 1,
    rebuilds: [{ number: 1, at: now, reason: 'startup', outcome: 'partial',
      files: { searchResults: 4, selected: 3, discoveryComplete: true, indexed: 1, failed: 2, missing: 0,
        paths: ['SECRET_SOURCE'] } as any }] };
  const report = createIssueReport(value), data = JSON.parse(report.split('```json\n')[1].split('\n```')[0]);
  assert.deepEqual(data.index.rebuilds[0].files, {
    searchResults: 4, selected: 3, discoveryComplete: true, indexed: 1, failed: 2, missing: 0
  });
  assert.doesNotMatch(report, /SECRET/);
});

test('callback limit report exposes safe cost counters without source identifiers', () => {
  const value=input();
  value.state.callbackDiagnostics=[{kind:'mutation',stage:'propagation',message:'SECRET_MESSAGE',symbol:'SECRET_FUNCTION',
    location:{uri:'file:///SECRET_PATH',start:1,end:2,line:3,column:4,endLine:3,endColumn:5},
    elapsedMs:350,scopeElapsedMs:12,evaluations:1000,scopeEvaluations:300,slots:256}];
  const report=createIssueReport(value);
  assert.match(report,/"callbackLimits"/);
  assert.match(report,/"scopeEvaluations": 300/);
  assert.match(report,/"stage": "propagation"/);
  assert.doesNotMatch(report,/SECRET/);
});
