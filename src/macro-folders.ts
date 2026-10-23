import * as vscode from 'vscode';
import { escape } from 'minimatch';
import { analysisConfiguration, smartAnalysisScope } from './analysis-policy';

export async function selectDetailedAnalysisFolders() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) { void vscode.window.showInformationMessage('Open a workspace folder to select Smart Analysis paths.'); return; }
  const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Choose the workspace for Smart Analysis' });
  if (!folder) return;
  const config = vscode.workspace.getConfiguration('dynsight', folder.uri);
  const current = smartAnalysisScope(analysisConfiguration(config, vscode.workspace.getConfiguration('cRelation', folder.uri))).include ?? [];
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
  if (!choices.length) { void vscode.window.showInformationMessage('No source folders found. Edit Smart Analysis: Include in Settings to enter a glob pattern.'); return; }
  const selected = await vscode.window.showQuickPick(choices, {
    title: `Smart Analysis Include · ${folder.name}`, canPickMany: true,
    placeHolder: 'Choose paths for Macro and Copilot. Copilot sends relevant source when enabled. Empty disables Smart Analysis.'
  });
  if (!selected) return;
  await config.update('smartAnalysis.include', selected.map(item => item.pattern),
    folders.length > 1 ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace);
}

export const selectMacroExpansionFolders = selectDetailedAnalysisFolders;
