import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import * as reporting from '../src/issue-report';

// Exercise the real adapter; only native VS Code UI/clipboard/browser APIs are substituted.
const code = transformSync(readFileSync('src/issue-report-service.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
function fixture() {
  const calls: string[] = [];
  let command: () => Promise<any>;
  const choices: ((value?: string) => void)[] = [];
  const document = { isClosed: false, text: '', getText() { return this.text; } };
  const vscode = {
    version: '1.105.0',
    commands: { registerCommand(_id: string, action: () => Promise<any>) { command = action; return {}; } },
    workspace: { workspaceFolders: [], async openTextDocument({ content }: { content: string }) { calls.push('draft'); document.isClosed = false; document.text = content; return document; } },
    window: { async showTextDocument() { calls.push('preview'); }, showInformationMessage(_message: string, ...actions: string[]) {
      if (actions.length) { calls.push('prompt'); return new Promise<string | undefined>(resolve => choices.push(resolve)); } return Promise.resolve(undefined);
    }, async showErrorMessage() { calls.push('error'); } },
    env: { remoteName: 'wsl', clipboard: { async writeText(text: string) { calls.push('clipboard:' + text); } },
      async openExternal(url: string) { calls.push('browser:' + url); return true; } },
    Uri: { parse: (value: string) => value }
  };
  const module = { exports: {} as any };
  runInNewContext(code, { module, exports: module.exports, process,
    require: (name: string) => name === 'vscode' ? vscode : reporting });
  const sample = { at: Date.now(), heapUsed: 100, heapLimit: 1000, external: 0 };
  module.exports.registerIssueReporting({ subscriptions: [], extension: { packageJSON: { version: '0.1.40' } } }, {
    diagnostics: { host: sample, workerError: 'ERR_WORKER_OUT_OF_MEMORY PRIVATE' }, status: 'Analysis stopped',
    index: { files: new Map() }, failures: new Map(), request() { throw Error('Unexpected Worker request'); }
  }, { state: { mode: 'both', depth: 1, accessFilter: 'all', calleeSort: 'name', contextLayout: 'combined', callGraphDirection: 'callers-left' } });
  return { calls, vscode, document, run: () => command(), choose: (value?: string, index = choices.length - 1) => choices[index](value) };
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
