import * as vscode from 'vscode';
import { WorkspaceIndex } from './workspace';
import { RelationView } from './view';
import { registerUpdates } from './update-service';

export function activate(context: vscode.ExtensionContext) {
  registerUpdates(context);
  const workspace = new WorkspaceIndex(context.extensionPath);
  const view = new RelationView(workspace, context.extensionUri);
  let timer: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(workspace, view,
    vscode.window.registerWebviewViewProvider('cRelation.explorer', view),
    vscode.commands.registerCommand('cRelation.open', async () => {
      await vscode.commands.executeCommand('cRelation.explorer.focus');
      await workspace.ready;
      view.track(vscode.window.activeTextEditor);
    }),
    vscode.commands.registerCommand('cRelation.reindex', () => workspace.reindex()),
    vscode.commands.registerCommand('cRelation.openSettings', () => vscode.commands.executeCommand(
      vscode.workspace.workspaceFolders?.length ? 'workbench.action.openWorkspaceSettings' : 'workbench.action.openSettings',
      { query: '@id:cRelation.include @id:cRelation.exclude', jsonEditor: false })),
    vscode.commands.registerCommand('cRelation.help', () => vscode.commands.executeCommand(
      'markdown.showPreview', vscode.Uri.joinPath(context.extensionUri, 'USER_GUIDE.md'))),
    vscode.window.onDidChangeTextEditorSelection(event => {
      clearTimeout(timer); timer = setTimeout(() => view.track(event.textEditor), 80);
    }),
    vscode.window.onDidChangeActiveTextEditor(editor => view.track(editor)),
    { dispose: () => clearTimeout(timer) });
  void workspace.ready.then(() => view.track(vscode.window.activeTextEditor));
  return { workspace, view };
}
