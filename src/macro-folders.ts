import * as vscode from 'vscode';
import { escape } from 'minimatch';

export async function selectDetailedAnalysisFolders() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) { void vscode.window.showInformationMessage('Open a workspace folder to select detailed analysis folders.'); return; }
  const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Choose the workspace for detailed analysis' });
  if (!folder) return;
  const config = vscode.workspace.getConfiguration('dynsight', folder.uri);
  const current = config.get<string[]>('detailedAnalysisFolders', []);
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
  if (!choices.length) { void vscode.window.showInformationMessage('No source folders found. Edit Detailed Analysis Folders in Settings to enter a glob pattern.'); return; }
  const selected = await vscode.window.showQuickPick(choices, {
    title: `Detailed Analysis Folders · ${folder.name}`, canPickMany: true,
    placeHolder: 'Checked: expand macros and trace callbacks. Unchecked: basic analysis only. Empty disables detailed analysis.'
  });
  if (!selected) return;
  await config.update('detailedAnalysisFolders', selected.length === choices.length ? ['**'] : selected.map(item => item.pattern),
    folders.length > 1 ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace);
}

export const selectMacroExpansionFolders = selectDetailedAnalysisFolders;
