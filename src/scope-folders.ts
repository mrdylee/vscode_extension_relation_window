import * as vscode from 'vscode';
import { Minimatch } from 'minimatch';

type ScopeKey = 'include' | 'exclude';
interface ScopeEdit {
  folder: vscode.WorkspaceFolder;
  config: vscode.WorkspaceConfiguration;
  initial: string[];
  patterns: string[];
}
interface ScopeChoice extends vscode.QuickPickItem {
  action: 'add' | 'all' | 'defaults' | 'remove' | 'apply' | 'settings' | 'exclusions';
  edit?: ScopeEdit;
  pattern?: string;
}

const builtInExcludes = ['**/node_modules/**', '**/.git/**', '**/.vscode-test/**'];
const allFiles = (patterns: string[]) => !patterns.length || patterns.some(pattern => ['**', '**/*', '**/*.{c,h}'].includes(pattern));
const folderPattern = (folder: vscode.WorkspaceFolder, uri: vscode.Uri) => {
  if (folder.uri.toString() === uri.toString()) return '**';
  // Character classes work in both VS Code discovery globs and minimatch.
  return vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/').replace(/[\[\]*?{},]/g, char => `[${char}]`) + '/**';
};
function editScope(folder: vscode.WorkspaceFolder, key: ScopeKey): ScopeEdit {
  const config = vscode.workspace.getConfiguration('dynsight', folder.uri);
  const initial = config.get<string[]>(key, []);
  return { folder, config, initial: [...initial], patterns: [...initial] };
}
function excludedBy(edit: ScopeEdit, pattern: string): string[] {
  if (!pattern.endsWith('/**')) return [];
  const escapedCharacter = /\[([\[\]*?{},])\]/g, prefix = pattern.slice(0, -3);
  // Decode literal folder characters without guessing the scope of custom globs.
  if (/[\[*?{}]/.test(prefix.replace(escapedCharacter, ''))) return [];
  const path = prefix.replace(escapedCharacter, '$1');
  return [...builtInExcludes, ...edit.config.get<string[]>('exclude', [])].filter(exclude => exclude.endsWith('/**') &&
    new Minimatch(exclude, { dot: true, nonegate: true, nocomment: true, noext: true, nocase: process.platform === 'win32' })
      .match(path + '/__dynsight_scope__.c'));
}
async function chooseFolders(edit: ScopeEdit): Promise<vscode.Uri[] | undefined> {
  const selected = await vscode.window.showOpenDialog({
    title: `Select analysis folders · ${edit.folder.name}`, defaultUri: edit.folder.uri,
    canSelectFiles: false, canSelectFolders: true, canSelectMany: true, openLabel: 'Add folders'
  });
  if (!selected) return;
  if (selected.some(uri => vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() !== edit.folder.uri.toString())) {
    await vscode.window.showInformationMessage(`Choose folders inside ${edit.folder.name}. Other workspace roots have their own analysis scope.`);
    return;
  }
  return selected;
}
async function reviewScope(key: ScopeKey, edits: ScopeEdit[]) {
  while (true) {
    const choices: ScopeChoice[] = [{ label: '$(check) Apply', action: 'apply', description: 'Save changes and refresh analysis' }];
    for (const edit of edits) {
      choices.push({ label: '$(folder-opened) Add folders…', action: 'add', edit, description: edit.folder.name });
      choices.push(key === 'include'
        ? { label: 'Analyze all C/H files', action: 'all', edit, description: `${edit.folder.name} · ${allFiles(edit.patterns) ? 'current mode' : 'switch to all files'}` }
        : { label: 'Restore default exclusions', action: 'defaults', edit, description: edit.folder.name });
      for (const pattern of edit.patterns) {
        const reasons = key === 'include' ? excludedBy(edit, pattern) : [];
        const fixed = reasons.filter(reason => builtInExcludes.includes(reason));
        choices.push({ label: `$(close) ${pattern}`, action: 'remove', edit, pattern, description: edit.folder.name,
          detail: fixed.length ? `Always excluded by Dynsight: ${fixed.join(', ')}. This cannot be overridden in Include or Exclude.`
            : reasons.length ? `Exclude rule matches this folder: ${reasons.join(', ')}. Edit Exclude to include it.` : 'Select to remove this rule; custom globs are preserved.' });
      }
      choices.push({ label: `$(settings-gear) Edit ${key} patterns in Settings (discard staged changes)`, action: 'settings', edit, description: edit.folder.name });
      if (key === 'include') choices.push({ label: '$(settings-gear) Edit exclusion rules in Settings (discard staged changes)', action: 'exclusions', edit, description: edit.folder.name });
    }
    const selected = await vscode.window.showQuickPick(choices, {
      title: `Analysis ${key === 'include' ? 'Include' : 'Exclude'} · ${edits.map(edit => edit.folder.name).join(', ')}${key === 'include' ? ` · ${edits.every(edit => allFiles(edit.patterns)) ? 'All C/H files' : 'Selected paths'}` : ''}`,
      placeHolder: key === 'include'
        ? (edits.some(edit => !allFiles(edit.patterns)) ? 'Only selected folders / patterns will be analyzed. Exclude still takes priority. Apply to save; Esc cancels.' : 'All C/H files, except Exclude rules. Remove broad rules to restrict analysis. Apply to save; Esc cancels.')
        : 'Review excluded folders and patterns. Empty disables configurable exclusions. Apply to save; Esc cancels.',
      ignoreFocusOut: true, matchOnDescription: true, matchOnDetail: true
    });
    if (!selected) return;
    const edit = selected.edit!;
    if (selected.action === 'settings' || selected.action === 'exclusions') {
      const setting = selected.action === 'exclusions' ? 'exclude' : key;
      if ((vscode.workspace.workspaceFolders?.length ?? 0) > 1 || vscode.workspace.getConfiguration('dynsight', edit.folder.uri).inspect(setting)?.workspaceFolderValue !== undefined)
        await vscode.commands.executeCommand('_workbench.action.openFolderSettings', edit.folder.uri);
      else await vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', { query: `@id:dynsight.${setting}`, jsonEditor: false });
      return;
    }
    if (selected.action === 'add') {
      const folders = await chooseFolders(edit);
      if (folders) edit.patterns = key === 'include' && folders.some(uri => uri.toString() === edit.folder.uri.toString())
        ? [] : [...new Set([...edit.patterns, ...folders.map(uri => folderPattern(edit.folder, uri))])];
    } else if (selected.action === 'all') edit.patterns = [];
    else if (selected.action === 'defaults') edit.patterns = [...(edit.config.inspect<string[]>('exclude')?.defaultValue ?? [])];
    else if (selected.action === 'remove') edit.patterns = edit.patterns.filter(pattern => pattern !== selected.pattern);
    else if (selected.action === 'apply') {
      const changed = edits.filter(value => JSON.stringify(value.patterns) !== JSON.stringify(value.initial));
      if (changed.some(value => JSON.stringify(vscode.workspace.getConfiguration('dynsight', value.folder.uri).get<string[]>(key, [])) !== JSON.stringify(value.initial))) {
        await vscode.window.showInformationMessage('Analysis scope changed while this picker was open. Reopen the picker to use the latest settings.');
        return;
      }
      for (const value of changed) await value.config.update(key, value.patterns,
        (vscode.workspace.workspaceFolders?.length ?? 0) > 1 || value.config.inspect(key)?.workspaceFolderValue !== undefined
          ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace);
      return;
    }
  }
}
export async function selectScopeFolders(key: ScopeKey) {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) { await vscode.window.showInformationMessage('Open a workspace folder to select analysis paths.'); return; }
  const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Choose the workspace for analysis scope' });
  if (folder) await reviewScope(key, [editScope(folder, key)]);
}
export async function addScopeFolders(key: ScopeKey, uri?: vscode.Uri, selected?: vscode.Uri[]) {
  if (!uri) { await selectScopeFolders(key); return; }
  const edits = new Map<string, ScopeEdit>();
  const paths = selected?.length ? selected : [uri];
  for (const value of paths) {
    const folder = vscode.workspace.getWorkspaceFolder(value);
    if (!folder) { await vscode.window.showInformationMessage('Choose folders inside an open workspace.'); return; }
    if (!((await vscode.workspace.fs.stat(value)).type & vscode.FileType.Directory)) {
      await vscode.window.showInformationMessage('Choose folders, rather than individual files, for analysis scope.'); return;
    }
    const id = folder.uri.toString(), edit = edits.get(id) ?? editScope(folder, key);
    edit.patterns = key === 'include' && paths.some(path => path.toString() === id)
      ? [] : [...new Set([...edit.patterns, folderPattern(folder, value)])];
    edits.set(id, edit);
  }
  await reviewScope(key, [...edits.values()]);
}
export function registerScopeFolders(context: vscode.ExtensionContext) {
  for (const key of ['include', 'exclude'] as const) {
    const title = key === 'include' ? 'Include' : 'Exclude';
    const safely = (run: () => Promise<void>) => run().catch(error => vscode.window.showErrorMessage(`Could not save analysis ${key}: ${String(error)}`));
    context.subscriptions.push(
      vscode.commands.registerCommand(`dynsight.select${title}Folders`, () => safely(() => selectScopeFolders(key))),
      vscode.commands.registerCommand(`dynsight.add${title}Folders`, (uri?: vscode.Uri, selected?: vscode.Uri[]) => safely(() => addScopeFolders(key, uri, selected)))
    );
  }
}
