import * as vscode from 'vscode';

const legacyId = 'local-james-black.c-relation-explorer';

export async function prepareUpgrade() {
  if (!vscode.extensions.getExtension(legacyId)) return true;
  const action = 'Remove previous extension and reload';
  const choice = await vscode.window.showWarningMessage(
    'Dynsight now uses publisher dylee. Remove the previous extension and reload to avoid duplicate analysis. Dynsight will wait until then; your source files and settings are kept.', action);
  if (choice === action) {
    try {
      await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', legacyId);
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    } catch (error) { await vscode.window.showErrorMessage(`Dynsight: Could not remove the previous extension: ${String(error)}. Remove it from Extensions, then reload.`); }
  }
  return false;
}

export async function migrateSettings(properties: Record<string, { scope?: string }>) {
  const move = async (key: string, target: vscode.ConfigurationTarget, field: 'globalValue' | 'workspaceValue' | 'workspaceFolderValue', uri?: vscode.Uri) => {
    const previous = vscode.workspace.getConfiguration('cRelation', uri);
    const current = vscode.workspace.getConfiguration('dynsight', uri);
    const value = previous.inspect(key)?.[field];
    if (value === undefined) return;
    if (current.inspect(key)?.[field] === undefined) await current.update(key, value, target);
    // Remove only after the new value is saved (or explicitly set already).
    await previous.update(key, undefined, target);
  };
  for (const [fullKey, schema] of Object.entries(properties)) {
    const key = fullKey.slice('dynsight.'.length);
    await move(key, vscode.ConfigurationTarget.Global, 'globalValue');
    if (schema.scope !== 'application' && (vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.length))
      await move(key, vscode.ConfigurationTarget.Workspace, 'workspaceValue');
    if (schema.scope === 'resource') for (const folder of vscode.workspace.workspaceFolders ?? [])
      await move(key, vscode.ConfigurationTarget.WorkspaceFolder, 'workspaceFolderValue', folder.uri);
  }
}
