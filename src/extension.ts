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
    vscode.window.onDidChangeTextEditorSelection(event => {
      clearTimeout(timer); timer = setTimeout(() => view.track(event.textEditor), 80);
    }),
    vscode.window.onDidChangeActiveTextEditor(editor => view.track(editor)),
    { dispose: () => clearTimeout(timer) });
  void workspace.ready.then(() => view.track(vscode.window.activeTextEditor));
  return { workspace, view };
}
