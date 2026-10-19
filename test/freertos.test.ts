import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

export async function run() {
  const opened: string[] = [];
  const listener = vscode.workspace.onDidOpenTextDocument(document => { if (document.uri.scheme === 'file' && /\.[ch]$/i.test(document.uri.path)) opened.push(document.uri.toString()); });
  const start = Date.now();
  const api = await vscode.extensions.getExtension('dylee.dynsight')!.activate();
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
  const expandedCallSites = [...api.workspace.index.files.values()].reduce((count: number, file: any) => count + file.references.filter((ref: any) => ref.kind === 'call' && ref.expansion).length, 0);
  const inferredCallSites = [...api.workspace.index.files.values()].reduce((count: number, file: any) => count + file.references.filter((ref: any) => ref.callKind === 'inferred').length, 0);
  const functionArgumentSites = [...api.workspace.index.files.values()].reduce((count: number, file: any) => count + (file.functionArguments?.length ?? 0), 0);
  assert.ok(functionArgumentSites > 0, 'FreeRTOS has function argument relationships');
  const callbackNotices = [...api.workspace.index.files.values()].flatMap((file: any) => file.issues.filter((issue:string)=>issue.startsWith('Callback')));
  assert.ok(expandedCallSites > 10000, 'full FreeRTOS macro coverage must not collapse to a small partial result');
  const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'queue.c'));
  const editor = await vscode.window.showTextDocument(document);
  const offset = document.getText().indexOf('prvUnlockQueue');
  assert.ok(offset >= 0);
  editor.selection = new vscode.Selection(document.positionAt(offset + 2), document.positionAt(offset + 2));
  api.view.track(editor);
  assert.equal(api.view.state.graph?.root.name, 'prvUnlockQueue');
  assert.ok(api.view.state.graph.root.children.length, 'queue function has incoming references');
  assert.ok(api.view.state.context.tokens.flat().some((token: any) => token.kind === 'function' && token.text === 'prvUnlockQueue'));
  const result = { passed: true, files: expected.length, elapsedMs, openedDuringIndex: opened.length, expandedCallSites, inferredCallSites, functionArgumentSites, callbackNotices, root: api.view.state.graph.root.name, relations: api.view.state.graph.root.children.length };
  await api.view.handleMessage({ type: 'mode', value: 'callees' });
  const callees = api.view.state.graph.root.children;
  assert.ok(callees.length > 0, 'FreeRTOS queue function has outgoing calls');
  assert.ok(callees.some((node: any) => node.name === 'xTaskRemoveFromEventList' && node.callKind === 'direct'));
  const callee = callees.find((node: any) => node.callKind === 'direct');
  await api.view.handleMessage({ type: 'selectNode', key: callee.key });
  assert.equal(api.view.state.context.location.start, callee.sites[0].location.start);
  assert.equal(api.view.state.context.location.uri, document.uri.toString());
  await api.view.handleMessage({ type: 'mode', value: 'references' });
  const member = api.workspace.index.files.get(document.uri.toString()).symbols.find((symbol: any) => symbol.memberOf && symbol.name === 'uxMessagesWaiting');
  assert.ok(member, 'FreeRTOS queue member extracted');
  const memberStarted = Date.now();
  const memberWrites = api.workspace.index.relations(member.id, 'references', 'write');
  const memberQueryMs = Date.now() - memberStarted;
  assert.ok(memberWrites.length > 0, 'queue member writes resolve through typedefs and pointer declarations');
  assert.ok(memberWrites.every((group: any) => group.sites.every((site: any) => site.member && ['write', 'readwrite'].includes(site.access))));
  editor.selection = new vscode.Selection(document.positionAt(member.location.start), document.positionAt(member.location.start));
  api.view.track(editor);
  assert.equal(api.view.state.graph.root.name, 'QueueDefinition.uxMessagesWaiting');
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
  // Initial webview ready legitimately refreshes the graph. Wait for that handshake
  // before measuring whether subsequent same-symbol cursor movement rebuilds it.
  const handleMessage = api.view.handleMessage;
  let webviewReady = false;
  api.view.handleMessage = async (message: any) => {
    const result = await handleMessage.call(api.view, message);
    if (message?.type === 'ready') webviewReady = true;
    return result;
  };
  try {
    await vscode.commands.executeCommand('dynsight.open');
    const deadline = Date.now() + 5000;
    while (!webviewReady && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(webviewReady, 'webview ready before tracking measurement');
  } finally { api.view.handleMessage = handleMessage; }
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
  const graphProjection = [];
  for (const name of ['prvUnlockQueue', 'vTaskSuspendAll', 'xTaskResumeAll']) {
    const symbol = api.workspace.index.symbols().find((s: any) => s.name === name && s.definition && s.kind === 'function');
    assert.ok(symbol);
    for (const depth of [1, 3]) for (const mode of ['callers', 'callees', 'both']) for (const includeFunctionArguments of [false, true]) {
      const samples = [];
      let graph: any;
      for (let sample = 0; sample < 5; sample++) {
        const started = performance.now(); graph = api.workspace.index.graph(symbol.id, mode, depth, {}, 'all', 'name', includeFunctionArguments);
        samples.push(performance.now() - started);
      }
      const count = (node: any): number => 1 + node.children.reduce((sum: number, child: any) => sum + count(child), 0);
      const nodes = count(graph.root) + (graph.callers ?? []).reduce((sum: number, node: any) => sum + count(node), 0);
      assert.ok(nodes <= 300);
      graphProjection.push({ name, depth, mode, includeFunctionArguments, medianMs: samples.sort((a, b) => a - b)[2], nodes });
    }
  }
  const variableResult = { ...result, variable: variableName, accessKinds: [...accessKinds], variableFilters: true, trackingMs, member: member.name, memberWriteFunctions: memberWrites.length, memberQueryMs, graphProjection };
  await writeFile(process.env.C_RELATION_TEST_OUTPUT!, JSON.stringify(variableResult, null, 2));
  console.log('FreeRTOS full-workspace verification', JSON.stringify(variableResult));
}
