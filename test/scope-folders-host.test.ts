import * as vscode from 'vscode';
import assert from 'node:assert/strict';

export async function run() {
  const ext = vscode.extensions.getExtension('dylee.dynsight')!;
  const api = await ext.activate();
  await api.workspace.ready;
  await api.workspace.whenIdle();
  const [first, second] = vscode.workspace.workspaceFolders!;
  assert.equal(vscode.workspace.workspaceFolders!.length, 2);
  for (const [folder, actionIndex] of [[first, 3], [second, 4]] as const) {
    // Selecting the root stages [], leaving Apply/Add/All/Settings/Exclusions.
    const picker = vscode.commands.executeCommand('dynsight.addIncludeFolders', folder.uri, [folder.uri]);
    await new Promise(resolve => setTimeout(resolve, 300));
    for (let step = 0; step < actionIndex; step++) await vscode.commands.executeCommand('workbench.action.quickOpenSelectNext');
    await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
    await picker;
    assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), vscode.Uri.joinPath(folder.uri, '.vscode', 'settings.json').toString(), 'settings navigation opens the selected root, including its Exclude editor');
    assert.deepEqual(vscode.workspace.getConfiguration('dynsight', folder.uri).get('include'), ['App/**'], 'opening settings discards staged root Include changes');
  }
  const picker = vscode.commands.executeCommand('dynsight.addIncludeFolders', second.uri, [second.uri]);
  await new Promise(resolve => setTimeout(resolve, 300));
  await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
  await picker;
  await new Promise(resolve => setTimeout(resolve, 500));
  await api.workspace.whenIdle();
  assert.deepEqual(vscode.workspace.getConfiguration('dynsight', second.uri).get('include'), []);
  assert.deepEqual(vscode.workspace.getConfiguration('dynsight', first.uri).get('include'), ['App/**'], 'applying one root preserves other roots');
  console.log('Scope picker multi-root native checks passed');
}
