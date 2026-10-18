import * as vscode from 'vscode';
import { escape } from 'minimatch';

export async function selectMacroExpansionFolders() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) { void vscode.window.showInformationMessage('Open a workspace folder to select macro expansion folders.'); return; }
  const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Choose the workspace for macro expansion' });
  if (!folder) return;
  const config = vscode.workspace.getConfiguration('cRelation', folder.uri);
  const current = config.get<string[]>('macroExpansionFolders', ['**']);
  const include = config.get<string[]>('include', []);
  let patterns = include;
  if (!include.length || include.includes('**') || include.includes('**/*.{c,h}')) {
    const entries = await vscode.workspace.fs.readDirectory(folder.uri);
    patterns = entries.filter(([name, type]) => (type & vscode.FileType.Directory) && !['.git', 'node_modules', '.vscode-test'].includes(name))
      .map(([name]) => escape(name) + '/**');
    if (entries.some(([name, type]) => (type & vscode.FileType.File) && /\.[ch]$/i.test(name))) patterns.push('*.{c,h}');
  }
  const choices = [...new Set([...patterns, ...current.filter(pattern => pattern !== '**')])].sort().map(pattern => ({
    label: pattern, pattern, picked: current.includes('**') || current.includes(pattern)
  }));
  if (!choices.length) { void vscode.window.showInformationMessage('No source folders found. Edit Macro Expansion Folders in Settings to enter a glob pattern.'); return; }
  const selected = await vscode.window.showQuickPick(choices, {
    title: `Macro Expansion Folders · ${folder.name}`, canPickMany: true,
    placeHolder: 'Checked: expand macros. Unchecked: keep basic analysis. Select all for all sources.'
  });
  if (!selected) return;
  await config.update('macroExpansionFolders', selected.length === choices.length ? ['**'] : selected.map(item => item.pattern),
    folders.length > 1 ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace);
}
