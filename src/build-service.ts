import * as vscode from 'vscode';
import type { WorkspaceIndex } from './workspace';
import { BuildMetadataCache } from './build-discovery';
import { BuildEntry, BuildFileSystem, BuildProfile, BuildIssue, fingerprintBuildInput, resolveBuildUri, splitBuildWords } from './build-context';

const storageKey = 'buildConfiguration-v1';
export function registerBuildConfigurations(context: vscode.ExtensionContext, workspace: WorkspaceIndex) {
  const missing = (error: unknown) => ['FileNotFound', 'ENOENT'].includes((error as { code?: string }).code ?? '');
  const fs: BuildFileSystem = {
    readText: async uri => {
      try {
        const data = await vscode.workspace.fs.readFile(vscode.Uri.parse(uri));
        return data.byteLength > 1_048_576 ? undefined : Buffer.from(data).toString('utf8');
      } catch (error) { if (missing(error)) return; throw error; }
    },
    list: async uri => {
      try { return (await vscode.workspace.fs.readDirectory(vscode.Uri.parse(uri))).map(([name, type]) => ({ uri: resolveBuildUri(uri, name), kind: type & vscode.FileType.SymbolicLink ? 'link' as const : type & vscode.FileType.Directory ? 'directory' as const : 'file' as const })); }
      catch (error) { if (missing(error)) return []; throw error; }
    }
  };
  const cache = new BuildMetadataCache(fs);
  let selected = context.workspaceState.get<BuildEntry>(storageKey), entries: BuildEntry[] = [], current: BuildProfile | undefined;
  let discoveryIssues:BuildIssue[]=[];
  let disposed = false, revision = 0, inputKey = '', timer: ReturnType<typeof setTimeout> | undefined;
  workspace.buildPending = !!selected;
  const sources = () => [...workspace.sourceFiles.keys()];
  const changed = () => workspace.changed.fire();
  async function refresh(force = false) {
    if (disposed) return;
    if (force) { cache.clear(); inputKey = ''; }
    const files = sources(), folders = vscode.workspace.workspaceFolders ?? [];
    const scopes = folders.map(folder => { const config = vscode.workspace.getConfiguration('dynsight', folder.uri); return [folder.uri.toString(), config.get<string[]>('include', []), config.get<string[]>('exclude', [])]; });
    const key = fingerprintBuildInput([files.sort(), scopes, selected]);
    if (key === inputKey) return;
    inputKey = key; const epoch = ++revision;
    workspace.buildPending = !!selected;
    workspace.buildStatus = { label: selected ? 'Checking build configuration' : 'Finding build configurations', state: 'discovering', candidates: entries.length, resolved: 0, unresolved: 0 }; changed();
    try {
      const discovered: BuildEntry[] = [];
      const notices:BuildIssue[]=[];
      for (const folder of folders) {
        const rootUri = folder.uri.toString().replace(/\/$/, '');
        const result = await cache.discover({ rootUri, sourceUris: files.filter(uri => uri.startsWith(rootUri + '/')), explicitEntryUri: selected?.rootUri === rootUri ? selected.entryUri : undefined });
        discovered.push(...result.entries);
        notices.push(...result.issues);
      }
      if (disposed || epoch !== revision) return;
      entries = discovered;
      discoveryIssues=notices;
      if (selected) {
        const entry = entries.find(e => e.entryUri === selected!.entryUri && e.rootUri === selected!.rootUri);
        if (!entry) { await workspace.setBuildProfile(undefined); throw new Error('The selected build entry is outside the open workspace. Select a build configuration again.'); }
        current = await cache.profile({ ...entry, id: selected.id, args: selected.args }, files, process.env);
        if (disposed || epoch !== revision) return;
        // Scope is part of the meaning of a build projection, not of the Make files themselves.
        current = { ...current, fingerprint: fingerprintBuildInput([current.fingerprint, scopes]) };
        await workspace.setBuildProfile(current);
        if (disposed || epoch !== revision) return;
      }
      const resolved = current?.units.filter(unit => unit.status === 'resolved').length ?? 0;
      workspace.buildStatus = { label: selected ? decodeURIComponent(selected.entryUri.split('/').pop()!) : `${entries.length} build configuration${entries.length === 1 ? '' : 's'} found${discoveryIssues.length?' · Discovery incomplete':''}`,
        state: discoveryIssues.length||current && (current.coverage !== 'complete' || current.units.length !== resolved) ? 'partial' : 'ready', candidates: entries.length, resolved, unresolved: (current?.units.length ?? 0) - resolved };
      changed();
    } catch (error) {
      if (disposed || epoch !== revision) return;
      current = undefined;
      await workspace.setBuildProfile(undefined).catch(()=>{});
      workspace.buildStatus = { label: `Build configuration: ${String(error)}`, state: 'error', candidates: entries.length, resolved: 0, unresolved: 0 }; changed();
    }
  }
  function schedule(force = false) { clearTimeout(timer); timer = setTimeout(() => { void refresh(force); }, 150); }
  function report() {
    if (!current) {
      if(!discoveryIssues.length)return;
      return vscode.workspace.openTextDocument({language:'plaintext',content:discoveryIssues.map(issue=>issue.code+': '+issue.message).join('\n')}).then(document=>vscode.window.showTextDocument(document,{preview:true}));
    }
    const lines = [`Build configuration: ${current.entry.entryUri}`, `Arguments: ${current.entry.args.join(' ')}`, `Source coverage: ${current.coverage}`, '',
      ...current.units.flatMap(unit => [unit.sourceUri, `  ${unit.status} · ${unit.compiler} · compile membership: ${unit.membership}`, `  cwd: ${unit.cwdUri}`, `  ${unit.argv.join(' ')}`, ...unit.evidence.map(e => `  ${e.uri}:${e.line + 1}: ${e.expression}`), ...unit.issues.map(issue=>`  ${issue.code}: ${issue.message}`), '']),
      'Source coverage describes the final build/link set; partial coverage can still contain verified compile commands.',
      ...[...discoveryIssues,...current.issues].map(issue => `${issue.code}: ${issue.message}${issue.evidence?`\n  ${issue.evidence.uri}:${issue.evidence.line+1}: ${issue.evidence.expression}`:''}`)];
    return vscode.workspace.openTextDocument({ language: 'plaintext', content: lines.join('\n') }).then(document => vscode.window.showTextDocument(document, { preview: true }));
  }
  async function select() {
    await ready; await refresh();
    const choices = entries.map(entry => ({ label: decodeURIComponent(entry.entryUri.split('/').pop()!), description: entry.entryUri, entry }));
    const choice = await vscode.window.showQuickPick([...choices, { label: 'Choose build entry file…', description: '', entry: undefined }, { label: 'Use basic source analysis', description: 'Clear the selected build configuration', entry: undefined }], { title: 'Select build configuration' });
    if (!choice || disposed) return;
    let entry = choice.entry;
    if (choice.label === 'Choose build entry file…') {
      const files = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFiles: true, canSelectFolders: false, title: 'Select an existing build script or Makefile' });
      const file = files?.[0]; if (!file) return;
      const folder = vscode.workspace.getWorkspaceFolder(file); if (!folder) { await vscode.window.showErrorMessage('Choose a build entry inside an open workspace folder.'); return; }
      const rootUri = folder.uri.toString().replace(/\/$/, ''), uri = file.toString();
      entry = { id: fingerprintBuildInput([rootUri, uri]), rootUri, entryUri: uri, cwdUri: rootUri, dialect: /\.(bat|cmd)$/i.test(uri) ? 'cmd' : /\.sh$/i.test(uri) ? 'sh' : 'make', args: [], evidence: [] };
    }
    if (entry) {
      const preview = await cache.profile(entry, sources(), process.env);
      if (preview.issues.some(issue => issue.code === 'missing-script-argument')) {
        const text = await vscode.window.showInputBox({ title: 'Build script arguments', prompt: 'Enter the arguments normally passed to this build script.' });
        if (text === undefined) return;
        const args = splitBuildWords(text, entry.dialect === 'cmd' ? 'windows' : 'posix');
        if (!args) { await vscode.window.showErrorMessage('The build arguments contain unclosed quotes.'); return; }
        entry = { ...entry, id: fingerprintBuildInput([entry.rootUri, entry.entryUri, args]), args };
      }
    }
    selected = entry; current = undefined; inputKey = ''; revision++;
    await context.workspaceState.update(storageKey, selected);
    if (!selected) { await workspace.setBuildProfile(undefined); }
    await refresh(); await report();
  }
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  const onMetadata = (uri: vscode.Uri) => { if (cache.invalidate(uri.toString())) { inputKey = ''; schedule(); } };
  const subscriptions = [watcher, watcher.onDidCreate(onMetadata), watcher.onDidChange(onMetadata), watcher.onDidDelete(onMetadata),
    workspace.changed.event(() => schedule()), vscode.workspace.onDidChangeWorkspaceFolders(() => schedule(true)),
    vscode.workspace.onDidChangeConfiguration(event => { if (['include', 'exclude'].some(key => event.affectsConfiguration('dynsight.' + key))) schedule(true); }),
    vscode.commands.registerCommand('dynsight.selectBuildConfiguration', () => select()),
    vscode.commands.registerCommand('dynsight.refreshBuildConfiguration', async () => { await refresh(true); await report(); })];
  const ready = workspace.ready.then(() => refresh());
  const service = { ready, refresh, dispose() { disposed = true; revision++; clearTimeout(timer); subscriptions.forEach(value => value.dispose()); cache.clear(); } };
  context.subscriptions.push(service);
  return service;
}
