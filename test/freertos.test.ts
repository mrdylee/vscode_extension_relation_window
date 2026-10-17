import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

export async function run() {
  const opened: string[] = [];
  const listener = vscode.workspace.onDidOpenTextDocument(document => { if (document.uri.scheme === 'file' && /\.[ch]$/i.test(document.uri.path)) opened.push(document.uri.toString()); });
  const start = Date.now();
  const api = await vscode.extensions.getExtension('local-james-black.c-relation-explorer')!.activate();
  let timeout: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([api.workspace.ready.then(() => api.workspace.whenIdle()), new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('FreeRTOS indexing exceeded 60 seconds')), 60000);
    })]);
  } finally { clearTimeout(timeout!); listener.dispose(); }
  const elapsedMs = Date.now() - start;
  const expected = await vscode.workspace.findFiles('**/*.{c,h}', '**/{node_modules,.git,.vscode-test}/**');
  assert.ok(expected.length > 600, 'test uses the full FreeRTOS tree');
  assert.equal(api.workspace.status, 'Index ready');
  assert.equal(api.workspace.index.files.size, expected.length);
  assert.equal(api.workspace.failures.size, 0);
  assert.deepEqual(opened, [], 'indexing does not create C editor documents');
  const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'queue.c'));
  const editor = await vscode.window.showTextDocument(document);
  const offset = document.getText().indexOf('prvUnlockQueue');
  assert.ok(offset >= 0);
  editor.selection = new vscode.Selection(document.positionAt(offset + 2), document.positionAt(offset + 2));
  api.view.track(editor);
  assert.equal(api.view.state.graph?.root.name, 'prvUnlockQueue');
  assert.ok(api.view.state.graph.root.children.length, 'queue function has incoming references');
  assert.ok(api.view.state.context.tokens.flat().some((token: any) => token.kind === 'function' && token.text === 'prvUnlockQueue'));
  const result = { passed: true, files: expected.length, elapsedMs, openedDuringIndex: opened.length, root: api.view.state.graph.root.name, relations: api.view.state.graph.root.children.length };
  const tasks = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'tasks.c'));
  const tasksEditor = await vscode.window.showTextDocument(tasks);
  const variableOffset = tasks.getText().indexOf('uxCurrentNumberOfTasks');
  tasksEditor.selection = new vscode.Selection(tasks.positionAt(variableOffset), tasks.positionAt(variableOffset));
  api.view.track(tasksEditor);
  assert.equal(api.view.state.graph.root.name, 'uxCurrentNumberOfTasks');
  assert.equal(api.view.state.graph.root.kind, 'variable');
  const accessKinds = new Set(api.view.state.graph.root.children.flatMap((node: any) => node.sites.map((site: any) => site.access)));
  for (const kind of ['read', 'write', 'readwrite']) assert.ok(accessKinds.has(kind), `FreeRTOS variable has ${kind} sites`);
  await api.view.handleMessage({ type: 'access', value: 'read' });
  assert.ok(api.view.state.graph.root.children.some((node: any) => node.name === 'uxTaskGetNumberOfTasks'));
  await api.view.handleMessage({ type: 'access', value: 'write' });
  assert.equal(api.view.state.graph.root.children.some((node: any) => node.name === 'uxTaskGetNumberOfTasks'), false);
  const variableName = api.view.state.graph.root.name;
  await vscode.commands.executeCommand('cRelation.open');
  await api.view.handleMessage({ type: 'depth', value: 3 });
  const trackingMs: Record<string, number> = {};
  for (const name of ['vTaskSuspendAll', 'xTaskResumeAll', 'uxCurrentNumberOfTasks', 'xSchedulerRunning']) {
    const startOffset = api.workspace.index.files.get(tasks.uri.toString()).symbols.find((symbol: any) => symbol.name === name && symbol.definition).location.start;
    assert.ok(startOffset >= 0);
    const started = Date.now();
    tasksEditor.selection = new vscode.Selection(tasks.positionAt(startOffset), tasks.positionAt(startOffset + name.length));
    while (api.view.state.graph?.root.name !== name && Date.now() - started < 2000) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(api.view.state.graph?.root.name, name, `automatic selection tracking: ${name}`);
    trackingMs[name] = Date.now() - started;
    const graph = api.view.state.graph;
    tasksEditor.selection = new vscode.Selection(tasks.positionAt(startOffset + 2), tasks.positionAt(startOffset + 2));
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(api.view.state.graph, graph, 'same-symbol cursor movement does not rebuild or resend the graph');
  }
  const variableResult = { ...result, variable: variableName, accessKinds: [...accessKinds], variableFilters: true, trackingMs };
  await writeFile(process.env.C_RELATION_TEST_OUTPUT!, JSON.stringify(variableResult, null, 2));
  console.log('FreeRTOS full-workspace verification', JSON.stringify(variableResult));
}
