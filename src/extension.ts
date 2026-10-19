import * as vscode from 'vscode';
import { WorkspaceIndex } from './workspace';
import { RelationView } from './view';
import { registerUpdates } from './update-service';
import { selectMacroExpansionFolders } from './macro-folders';
import { registerIssueReporting } from './issue-report-service';
import { migrateSettings, prepareUpgrade } from './branding-migration';

export async function activate(context: vscode.ExtensionContext) {
  if (!await prepareUpgrade()) return;
  try { await migrateSettings(context.extension.packageJSON.contributes.configuration.properties); }
  catch (error) {
    await vscode.window.showErrorMessage(`Dynsight: Could not migrate settings: ${String(error)}. Check settings-file access, then reload.`);
    throw error;
  }
  registerUpdates(context);
  const workspace = new WorkspaceIndex(context.extensionPath);
  const view = new RelationView(workspace, context.extensionUri);
  registerIssueReporting(context, workspace, view);
  let timer: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(workspace, view,
    vscode.window.registerWebviewViewProvider('dynsight.explorer', { resolveWebviewView: webview => view.resolveWebviewView(webview) }),
    vscode.window.registerWebviewViewProvider('dynsight.context', { resolveWebviewView: webview => view.resolveWebviewView(webview, true) }),
    vscode.commands.registerCommand('dynsight.open', async () => {
      await vscode.commands.executeCommand('dynsight.explorer.focus');
      await workspace.ready;
      view.track(vscode.window.activeTextEditor);
    }),
    vscode.commands.registerCommand('dynsight.reindex', () => workspace.reindex()),
    vscode.commands.registerCommand('dynsight.selectMacroExpansionFolders', () => selectMacroExpansionFolders().catch(error =>
      vscode.window.showErrorMessage(`Could not save macro expansion folders: ${String(error)}`))),
    vscode.commands.registerCommand('dynsight.openSettings', () => vscode.commands.executeCommand(
      vscode.workspace.workspaceFolders?.length ? 'workbench.action.openWorkspaceSettings' : 'workbench.action.openSettings',
      { query: '@ext:dylee.dynsight', jsonEditor: false })),
    vscode.commands.registerCommand('dynsight.help', () => vscode.commands.executeCommand(
      'markdown.showPreview', vscode.Uri.joinPath(context.extensionUri, 'USER_GUIDE.md'))),
    vscode.window.onDidChangeTextEditorSelection(event => {
      clearTimeout(timer); timer = setTimeout(() => view.track(event.textEditor), 80);
    }),
    vscode.window.onDidChangeActiveTextEditor(editor => view.track(editor)),
    { dispose: () => clearTimeout(timer) });
  void workspace.ready.then(() => view.track(vscode.window.activeTextEditor));
  // Preserve existing custom keybindings without exposing old command labels.
  for (const { command } of context.extension.packageJSON.contributes.commands as { command: string }[])
    context.subscriptions.push(vscode.commands.registerCommand(command.replace(/^dynsight\./, 'cRelation.'),
      (...args: unknown[]) => vscode.commands.executeCommand(command, ...args)));
  return { workspace, view };
}
