import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export async function run() {
  const root = vscode.workspace.workspaceFolders![0].uri;
  const started = Date.now();
  let previousTick = started, maxTickGapMs = 0, ticks = 0;
  const timer = setInterval(() => {
    const now = Date.now(); maxTickGapMs = Math.max(maxTickGapMs, now - previousTick); previousTick = now; ticks++;
  }, 20);
  let deadline: ReturnType<typeof setTimeout>;
  const withinDeadline = new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('Large workspace indexing exceeded 120 seconds')), 120000); });
  try {
    const api = await vscode.extensions.getExtension('local-james-black.c-relation-explorer')!.activate();
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root, 'target.c'));
    const editor = await vscode.window.showTextDocument(doc);
    while (!api.workspace.index.files.has(doc.uri.toString())) await Promise.race([withinDeadline, new Promise(r => setTimeout(r, 20))]);
    const filesAtSelection = api.workspace.index.files.size;
    const selectionStart = Date.now(), position = doc.positionAt(doc.getText().indexOf('other'));
    editor.selection = new vscode.Selection(position, position);
    while (api.view.state.graph?.root.name !== 'other') await Promise.race([withinDeadline, new Promise(r => setTimeout(r, 20))]);
    const selectionMs = Date.now() - selectionStart;
    await Promise.race([withinDeadline, api.workspace.ready.then(() => api.workspace.whenIdle())]);
    assert.equal(api.workspace.status, 'Index ready');
    assert.equal(api.workspace.index.files.size, 2501, 'excluded files do not consume the 10,000-file limit');
    assert.equal(api.workspace.failures.size, 0);
    const target = api.workspace.index.symbols().find((s: any) => s.name === 'target' && s.definition);
    const queryStart = Date.now();
    const groups = api.workspace.index.relations(target.id, 'callers');
    const queryMs = Date.now() - queryStart;
    assert.equal(groups.length, 2500);
    assert.equal(groups.reduce((n: number, g: any) => n + g.sites.length, 0), 50000);
    await new Promise(r => setTimeout(r, 30)); // Include query stalls in the heartbeat measurement.
    const result = { passed: true, sourceFiles: 12551, indexedFiles: 2501, calls: 50000, elapsedMs: Date.now() - started, selectionMs, queryMs, filesAtSelection, ticks, maxTickGapMs };
    await mkdir(path.dirname(process.env.C_RELATION_TEST_OUTPUT!), { recursive: true });
    await writeFile(process.env.C_RELATION_TEST_OUTPUT!, JSON.stringify(result, null, 2));
    console.log('Large workspace verification', JSON.stringify(result));
  } finally { clearInterval(timer); clearTimeout(deadline!); }
}
