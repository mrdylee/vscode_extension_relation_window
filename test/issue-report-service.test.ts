import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import * as reporting from '../src/issue-report';

// Exercise the real adapter; only native VS Code UI/clipboard/browser APIs are substituted.
const code = transformSync(readFileSync('src/issue-report-service.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
function fixture() {
  const calls: string[] = [];
  const records: any[] = [];
  const history = { DiagnosticHistory: class { record(value: any) { records.push(value); } async read() { return 'previous-run evidence'; } },
    collectHostLogs: async () => 'host-exit evidence' };
  let command: () => Promise<any>;
  const choices: ((value?: string) => void)[] = [];
  const document = { isClosed: false, text: '', getText() { return this.text; } };
  const vscode = {
    version: '1.105.0',
    commands: { registerCommand(_id: string, action: () => Promise<any>) { command = action; return {}; } },
    workspace: { workspaceFolders: [], fs: { async writeFile(_uri: any, bytes: Uint8Array) { calls.push('saved:' + Buffer.from(bytes).toString()); } }, async openTextDocument({ content }: { content: string }) { calls.push('draft'); document.isClosed = false; document.text = content; return document; } },
    window: { async showSaveDialog() { return 'chosen-report.md' as any; }, async showTextDocument() { calls.push('preview'); }, showInformationMessage(_message: string, ...actions: string[]) {
      if (actions.length) { calls.push('prompt'); return new Promise<string | undefined>(resolve => choices.push(resolve)); } return Promise.resolve(undefined);
    }, async showErrorMessage() { calls.push('error'); } },
    env: { remoteName: 'wsl', clipboard: { async writeText(text: string) { calls.push('clipboard:' + text); } },
      async openExternal(url: string) { calls.push('browser:' + url); return true; } },
    Uri: { parse: (value: string) => value }
  };
  const module = { exports: {} as any };
  const require = createRequire(process.cwd() + '/package.json');
  runInNewContext(code, { module, exports: module.exports, process, Buffer, setInterval: () => ({ unref() {} }), clearInterval() {},
    require: (name: string) => name === 'vscode' ? vscode : name === './issue-report' ? reporting : name === './diagnostic-history' ? history : require(name) });
  const emitter = { event: () => ({ dispose() {} }) };
  const sample = { at: Date.now(), heapUsed: 100, heapLimit: 1000, external: 0 };
  module.exports.registerIssueReporting({ subscriptions: [], extension: { packageJSON: { version: '0.1.40' } } }, {
    changed: emitter, diagnosticsChanged: emitter,
    diagnostics: { host: sample, workerError: 'ERR_WORKER_OUT_OF_MEMORY PRIVATE', index: { rebuilds: [{ number: 1, at: 1, reason: 'startup', outcome: 'completed', settings: ['include', 'PRIVATE_PATTERN'], rawError: 'PRIVATE',
      files: { searchResults: 1800, selected: 1800, discoveryComplete: true, indexed: 297, failed: 1503, missing: 0, paths: ['PRIVATE'] }
    }], lastSourceEvent: { at: 1, kind: 'editor-close', uri: 'PRIVATE' } } }, status: 'Analysis stopped',
    index: { files: new Map() }, failures: new Map(), request() { throw Error('Unexpected Worker request'); }
  }, { activity: emitter, state: { mode: 'both', depth: 1, accessFilter: 'all', calleeSort: 'name', contextLayout: 'combined', callGraphDirection: 'callers-left' } });
  return { calls, records, history, vscode, document, run: () => command(), choose: (value?: string, index = choices.length - 1) => choices[index](value) };
}
const settled = () => new Promise(resolve => setImmediate(resolve));

test('preview needs no Worker, browser or clipboard; repeated requests reuse pending draft', async () => {
  const f = fixture();
  assert.equal(await f.run(), f.document);
  assert.equal(await f.run(), f.document);
  assert.equal(f.calls.filter(c => c === 'draft').length, 1);
  assert.ok(!f.calls.some(c => /^(clipboard|browser)/.test(c)));
  assert.match(f.document.text, /worker-out-of-memory/);
  assert.doesNotMatch(f.document.text, /PRIVATE/);
  f.choose(); await settled();
  await f.run();
  assert.equal(f.calls.filter(c => c === 'draft').length, 2, 'dismissal permits a fresh snapshot');
});
test('sharing copies the reviewed document before opening a fixed generic URL', async () => {
  const f = fixture(); await f.run();
  f.document.text = 'Reviewed and edited report';
  f.choose('Copy & Open GitHub'); await settled();
  const copy = f.calls.indexOf('clipboard:Reviewed and edited report');
  const browser = f.calls.indexOf('browser:' + reporting.ISSUE_URL);
  assert.ok(copy >= 0 && browser > copy);
  assert.ok(!reporting.ISSUE_URL.includes('Reviewed'));
});
test('closing a draft allows a new report; dismissing the old prompt cannot clear the new session', async () => {
  const f = fixture(); await f.run(); f.document.isClosed = true;
  await Promise.all([f.run(), f.run()]);
  assert.equal(f.calls.filter(c => c === 'draft').length, 2);
  f.choose(undefined, 0); await settled();
  await f.run();
  assert.equal(f.calls.filter(c => c === 'draft').length, 2);
});
test('copy-only and dismissal never open the browser', async () => {
  for (const action of ['Copy report', undefined]) {
    const f = fixture(); await f.run(); f.choose(action); await settled();
    assert.equal(f.calls.some(c => c.startsWith('clipboard:')), action === 'Copy report');
    assert.ok(!f.calls.some(c => c.startsWith('browser:')));
  }
});
test('closed drafts and clipboard failures do not open GitHub; browser failures retain the draft', async () => {
  for (const kind of ['closed', 'clipboard', 'browser-false', 'browser-throws']) {
    const f = fixture(); await f.run(); const content = f.document.text;
    if (kind === 'closed') f.document.isClosed = true;
    if (kind === 'clipboard') f.vscode.env.clipboard.writeText = async () => { throw Error('clipboard unavailable'); };
    if (kind === 'browser-false') f.vscode.env.openExternal = async () => false;
    if (kind === 'browser-throws') f.vscode.env.openExternal = async () => { throw Error('browser unavailable'); };
    f.choose('Copy & Open GitHub'); await settled();
    assert.ok(f.calls.includes('error'), kind);
    assert.equal(f.document.text, content);
    if (kind === 'closed' || kind === 'clipboard') assert.ok(!f.calls.some(c => c.startsWith('browser:')));
  }
});


test('report includes saved history and host evidence without asking the Worker', async () => {
  const f = fixture(); await f.run();
  assert.match(f.document.text, /previous-run evidence/);
  assert.match(f.document.text, /host-exit evidence/);
  assert.ok(f.records.length > 0);
  assert.equal(f.records[0].index.lastRebuild.files.selected, 1800);
  assert.equal(f.records[0].index.lastRebuild.files.indexed, 297);
  assert.doesNotMatch(JSON.stringify(f.records), /PRIVATE/);
});
test('Save report writes reviewed content; cancel does not write or share', async () => {
  for (const cancelled of [false, true]) {
    const f = fixture(); await f.run(); f.document.text = 'Reviewed report with evidence';
    if (cancelled) f.vscode.window.showSaveDialog = async () => undefined;
    f.choose('Save report'); await settled();
    assert.equal(f.calls.includes('saved:Reviewed report with evidence'), !cancelled);
    assert.ok(!f.calls.some(c => /^(clipboard|browser)/.test(c)));
  }
});
test('collection errors preserve the current report and name missing evidence', async () => {
  const f = fixture(); f.history.collectHostLogs = async () => { throw Error('PRIVATE PATH'); };
  await f.run(); assert.match(f.document.text, /Host logs unavailable/);
  assert.match(f.document.text, /Diagnostic snapshot/); assert.doesNotMatch(f.document.text, /PRIVATE PATH/);
});

test('save failure preserves reviewed draft without opening a browser', async () => {
  const f = fixture(); await f.run(); const text = f.document.text;
  f.vscode.workspace.fs.writeFile = async () => { throw Error('disk full'); };
  f.choose('Save report'); await settled();
  assert.ok(f.calls.includes('error')); assert.equal(f.document.text, text);
  assert.ok(!f.calls.some(c => c.startsWith('browser:')));
});
