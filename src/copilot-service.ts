import * as vscode from 'vscode';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { WorkspaceIndex } from './workspace';
import { CopilotCallbackController, CopilotProgress, CopilotRunResult, CopilotSnapshot } from './copilot-callbacks';
import { applyCallbackHints } from './copilot-relations';
import { CopilotWaitReason } from './diagnostics';
import { Minimatch } from 'minimatch';

interface SavedModel { id: string; version: string }
export function registerCopilotCallbacks(context: vscode.ExtensionContext, workspace: WorkspaceIndex) {
  let controller: CopilotCallbackController | undefined, model: vscode.LanguageModelChat | undefined;
  let savedModel = context.workspaceState.get<SavedModel>('copilotCallbackModel');
  let disposed = false, userAction = false, pendingChange = false, running: Promise<void> | undefined;
  let observedGeneration = -1;
  let automatic = false, stoppedByUser = false, stopRevision = 0;
  let startCancellation = 0;
  let scopeRevision = 0;
  let scopeSync = Promise.resolve();
  const includeBases = new Map((vscode.workspace.workspaceFolders ?? []).map(folder =>
    [folder.uri.toString(), [...vscode.workspace.getConfiguration('dynsight', folder.uri).get<string[]>('include', [])]]));
  let deferredReason: 'enabled' | 'force' | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const activity = { state: 'off', waitReason: undefined as CopilotWaitReason | undefined, total: 0, completed: 0, requests: 0, cacheHits: 0, remaining: 0, failures: 0, candidates: 0, notFound: 0, contextLimited: 0, excluded: 0 };
  const enabled = () => vscode.workspace.isTrusted && vscode.workspace.getConfiguration('dynsight').get('copilotCallbacks', false);
  const configuredModel = () => vscode.workspace.getConfiguration('dynsight').get('copilotModel', '').trim();
  function status(value: string) {
    activity.state = value;
    activity.waitReason = value === 'waiting-for-saved-index'
      ? workspace.copilotWaitReason ?? (workspace.hasDirtySources ? 'unsaved-sources' : 'source-update') : undefined;
    workspace.copilotDiagnostics = { ...activity, automatic }; workspace.diagnosticsChanged.fire();
  }
  function clearProgress() {
    activity.total = activity.completed = activity.cacheHits = activity.remaining = activity.failures = activity.candidates = activity.notFound = activity.contextLimited = activity.excluded = 0;
  }
  function clear() {
    controller?.invalidate(); applyCallbackHints(workspace.index, []); clearProgress();
    status(enabled() ? 'waiting-for-saved-index' : 'off'); workspace.changed.fire();
  }
  function resetModel() {
    automatic = false; stoppedByUser = false;
    clear(); controller?.dispose(); controller = undefined; model = undefined; userAction = false;
    deferredReason = undefined;
    pendingChange = false; clearTimeout(timer); observedGeneration = workspace.generation;
  }
  function snapshot(): CopilotSnapshot {
    const scopes = new Map<string, { include: Minimatch[]; exclude: Minimatch[] }>();
    const callsiteUris = new Set<string>();
    for (const file of workspace.index.files.values()) {
      const uri = vscode.Uri.parse(file.uri), folder = vscode.workspace.getWorkspaceFolder(uri);
      if (!folder) continue;
      const key = folder.uri.toString();
      let scope = scopes.get(key);
      if (!scope) {
        const config = vscode.workspace.getConfiguration('dynsight', folder.uri);
        const match = (pattern: string) => new Minimatch(pattern, { dot: true, nonegate: true, nocomment: true, noext: true, nocase: process.platform === 'win32' });
        scope = { include: config.get<string[]>('copilotInclude', []).map(match), exclude: config.get<string[]>('copilotExclude', []).map(match) };
        scopes.set(key, scope);
      }
      const relative = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
      if (scope.include.some(pattern => pattern.match(relative)) && !scope.exclude.some(pattern => pattern.match(relative))) callsiteUris.add(file.uri);
    }
    return { generation: workspace.generation, settingsKey: workspace.analysisKey, scopeRevision, callsiteUris,
      files: [...workspace.index.files.values()].map(file => file.references.some(ref => ref.callKind === 'ai-candidate')
        ? { ...file, references: file.references.filter(ref => ref.callKind !== 'ai-candidate') } : file) };
  }
  function setup() {
    if (!savedModel || savedModel.id !== configuredModel() || !context.storageUri || controller) return;
    const selected = savedModel;
    const cacheKey = createHash('sha256').update(JSON.stringify([selected.id, selected.version])).digest('hex');
    controller = new CopilotCallbackController({ cacheDir: path.join(context.storageUri.fsPath, 'copilot-callbacks', cacheKey),
      isCurrent: value => !disposed && enabled() && configuredModel() === selected.id && workspace.stable && !workspace.hasDirtySources && value.generation === workspace.generation && value.settingsKey === workspace.analysisKey && value.scopeRevision === scopeRevision,
      onHints: hints => { applyCallbackHints(workspace.index, hints); workspace.changed.fire(); },
      onProgress: value => { recordProgress(value); status(activity.state); },
      provider: { modelKey: `copilot:${selected.id}:${selected.version}`, complete: async (prompt, signal) => {
        if (!enabled() || signal.aborted) throw new Error('Cancelled');
        const cancellation = new vscode.CancellationTokenSource();
        let cancelled = false, rejectWait!: (error: Error) => void;
        const interrupted = new Promise<never>((_, reject) => { rejectWait = reject; });
        const interrupt = (error: Error) => { cancelled = true; cancellation.cancel(); rejectWait(error); };
        const abort = () => interrupt(new Error('Cancelled'));
        signal.addEventListener('abort', abort, { once: true });
        const timeout = setTimeout(() => interrupt(new Error('Callback request timed out')), 60_000);
        const checkCancelled = () => { if (cancelled || signal.aborted || !enabled() || configuredModel() !== selected.id) throw new Error('Cancelled'); };
        try {
          return await Promise.race([interrupted, (async () => {
            checkCancelled();
            const selectedModel = model?.id === selected.id && model.version === selected.version ? model :
              (await vscode.lm.selectChatModels({ vendor: 'copilot', id: selected.id })).find(item => item.id === selected.id && item.version === selected.version);
            checkCancelled();
            if (!selectedModel) { status('model-unavailable'); throw new Error('Copilot model unavailable'); }
            model = selectedModel;
            if (!userAction && context.languageModelAccessInformation?.canSendRequest(selectedModel) !== true) {
              status('permission-required'); throw new Error('Use Analyze Callbacks with Copilot to grant access');
            }
            const message = vscode.LanguageModelChatMessage.User(prompt);
            const tokens = await selectedModel.countTokens(message, cancellation.token);
            checkCancelled();
            if (tokens > selectedModel.maxInputTokens - 1024) throw new Error('Callback context exceeds model input limit');
            activity.requests++;
            status(activity.state);
            userAction = false;
            const response = await selectedModel.sendRequest([message], {}, cancellation.token);
            checkCancelled();
            let text = '';
            for await (const fragment of response.text) {
              checkCancelled();
              text += fragment;
              if (text.length > 64 * 1024) { cancellation.cancel(); throw new Error('Callback response too large'); }
            }
            checkCancelled();
            return text;
          })()]);
        } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); cancellation.dispose(); }
      } } });
  }
  function recordProgress(result: CopilotProgress) {
    activity.total = result.total; activity.completed = result.completed; activity.cacheHits = result.cached;
    activity.remaining = result.remaining; activity.failures = result.failures;
    activity.candidates = result.candidates; activity.notFound = result.notFound; activity.contextLimited = result.contextLimited;
    activity.excluded = result.excluded ?? 0;
  }
  function account(result: CopilotRunResult) {
    if (result.stale) return;
    recordProgress(result);
    if (!['permission-required', 'model-unavailable'].includes(activity.state))
      status(result.stopped || (stoppedByUser && result.remaining) ? 'stopped' : result.failures ? 'request-failed' : result.remaining ? 'more-callbacks-available' : 'ready');
    else status(activity.state);
  }
  async function run(reason?: 'enabled' | 'saved-change' | 'force') {
    if (disposed || !enabled()) { automatic = false; status('off'); return; }
    if (!workspace.stable || workspace.hasDirtySources) {
      if (reason === 'enabled' || reason === 'force') deferredReason = reason;
      status('waiting-for-saved-index'); return;
    }
    setup();
    if (!controller) { status('model-selection-required'); return; }
    if (running) return running;
    reason = deferredReason ?? reason; deferredReason = undefined;
    clearProgress();
    status(reason ? 'analyzing' : 'restoring-cache');
    const active = controller;
    observedGeneration = workspace.generation;
    running = (async () => {
      try {
        const result = await (reason ? active.analyzeUnresolved(snapshot(), { reason, automatic }) : active.restore(snapshot()));
        if (!result.stale) automatic = false;
        account(result);
      }
      catch { automatic = false; activity.failures++; status('request-failed'); }
      finally { running = undefined; userAction = false; if (pendingChange || deferredReason) schedule(); }
    })();
    return running;
  }
  function schedule() {
    if (disposed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!enabled()) { status('off'); return; }
      if (running) { void running.then(schedule); return; }
      if (!workspace.stable || workspace.hasDirtySources) { status('waiting-for-saved-index'); return; }
      const changed = pendingChange && observedGeneration !== workspace.generation; pendingChange = false;
      void run(changed && !stoppedByUser ? 'saved-change' : undefined);
    }, 1000);
  }
  async function selectModel(picker: boolean, current: () => boolean) {
    const id = configuredModel();
    const models = await vscode.lm.selectChatModels(id && !picker ? { vendor: 'copilot', id } : { vendor: 'copilot' });
    if (!current()) return false;
    const chosen = picker || !id
      ? (await vscode.window.showQuickPick(models.map(value => ({ label: value.name, description: `${value.id} · ${value.version}`, value })),
        { title: 'Select Copilot model for Dynsight', placeHolder: picker ? 'Selection alone sends no source and makes no AI request.' :
          'Analyze all pending callbacks in batches of 5. Relevant source is sent to Copilot and each request uses your allowance. You can stop at any time.' }))?.value
      : models.find(value => value.id === id);
    if (!current()) return false;
    if (!chosen) {
      if (id && !picker) {
        status('model-unavailable');
        await vscode.window.showInformationMessage(`Dynsight: Copilot model "${id}" is unavailable. Select another model in Dynsight settings.`);
      } else if (!models.length) await vscode.window.showInformationMessage('Dynsight: No Copilot models are available. Sign in to GitHub Copilot first.');
      return false;
    }
    resetModel(); await running;
    if (!current()) return false;
    savedModel = { id: chosen.id, version: chosen.version };
    await context.workspaceState.update('copilotCallbackModel', savedModel);
    if (!current()) return false;
    if (configuredModel() !== chosen.id) await vscode.workspace.getConfiguration('dynsight').update('copilotModel', chosen.id, vscode.ConfigurationTarget.Workspace);
    if (!current()) return false;
    model = chosen;
    return true;
  }
  async function command(force = false, selectOnly = false) {
    if (!vscode.workspace.isTrusted || !context.storageUri) { await vscode.window.showInformationMessage('Dynsight: Open a trusted workspace to use Copilot callback analysis.'); return; }
    const cancellation = startCancellation;
    try {
      await copyIncludeScopes();
      // Initial copying can invalidate the old scope itself; explicit Stop or
      // Disable must still cancel a command waiting for that copy to finish.
      if (disposed || cancellation !== startCancellation) return;
      const revision = stopRevision;
      const current = () => !disposed && revision === stopRevision && cancellation === startCancellation;
      if (!await selectModel(selectOnly, current) || !current()) return;
      if (selectOnly) { clearTimeout(timer); await run(); return; }
      automatic = true; stoppedByUser = false;
      await vscode.workspace.getConfiguration('dynsight').update('copilotCallbacks', true, vscode.ConfigurationTarget.Workspace);
      await workspace.whenIdle(); await running;
      if (!current() || !enabled()) return;
      userAction = true; pendingChange = false; clearTimeout(timer);
      await run(force ? 'force' : 'enabled');
    } catch { status('request-failed'); await vscode.window.showErrorMessage('Dynsight: Copilot callback analysis could not start. Check Copilot sign-in and model access.'); }
  }
  function stop() {
    startCancellation++; stopRevision++; automatic = false; stoppedByUser = true;
    deferredReason = undefined; pendingChange = false; userAction = false;
    clearTimeout(timer); controller?.stop(); status(enabled() ? 'stopped' : 'off');
  }
  function copyIncludeScopes(overwrite = false, event?: vscode.ConfigurationChangeEvent) {
    scopeSync = scopeSync.then(async () => {
      const folders = vscode.workspace.workspaceFolders ?? [];
      for (const folder of folders) {
        if (disposed || (event && !event.affectsConfiguration('dynsight.include', folder.uri))) continue;
        const config = vscode.workspace.getConfiguration('dynsight', folder.uri);
        const existing = config.inspect<string[]>('copilotInclude');
        const configured = existing?.globalValue !== undefined || existing?.workspaceValue !== undefined || existing?.workspaceFolderValue !== undefined;
        const include = config.get<string[]>('include', []);
        const key = folder.uri.toString(), previous = includeBases.get(key) ?? [];
        // An explicit AI array in the same JSON save wins over automatic
        // copying, including an empty array used to disable every AI request.
        if (configured && (!overwrite || event?.affectsConfiguration('dynsight.copilotInclude', folder.uri))) {
          includeBases.set(key, [...include]); continue;
        }
        // Copy newly included paths without re-enabling paths the user removed
        // from the AI list. Removing a general Include also removes its copy.
        const paths = configured ? [...new Set([...config.get<string[]>('copilotInclude', []).filter(pattern =>
          !previous.includes(pattern) || include.includes(pattern)), ...include.filter(pattern => !previous.includes(pattern))])] : [...include];
        if (configured && JSON.stringify(config.get('copilotInclude')) === JSON.stringify(paths)) { includeBases.set(key, [...include]); continue; }
        await config.update('copilotInclude', paths, folders.length > 1 ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace);
        includeBases.set(key, [...include]);
      }
    }).catch(error => { void vscode.window.showErrorMessage(`Dynsight: Could not copy Include paths to Copilot Include: ${String(error)}`); });
    return scopeSync;
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('dynsight.analyzeCallbacksWithCopilot', () => command()),
    vscode.commands.registerCommand('dynsight.reanalyzeCallbacksWithCopilot', () => command(true)),
    vscode.commands.registerCommand('dynsight.selectCopilotModel', () => command(false, true)),
    vscode.commands.registerCommand('dynsight.stopCopilotAnalysis', stop),
    workspace.sourceChanged.event(kind => {
      if (automatic) deferredReason ??= 'enabled';
      clear(); if (kind !== 'editor-change' && kind !== 'configuration') pendingChange = true; schedule();
    }),
    workspace.settled.event(schedule),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('dynsight.copilotCallbacks') && !enabled()) startCancellation++;
      const modelChanged = event.affectsConfiguration('dynsight.copilotModel');
      if (modelChanged) { resetModel(); savedModel = context.workspaceState.get<SavedModel>('copilotCallbackModel'); }
      const includeChanged = event.affectsConfiguration('dynsight.include');
      if (includeChanged || event.affectsConfiguration('dynsight.copilotInclude') || event.affectsConfiguration('dynsight.copilotExclude')) {
        scopeRevision++; stopRevision++; automatic = false; pendingChange = false;
        deferredReason = undefined; userAction = false; clearTimeout(timer);
        clear();
        if (includeChanged) void copyIncludeScopes(true, event).then(schedule); else schedule();
        return;
      }
      if (modelChanged) { schedule(); return; }
      if (!event.affectsConfiguration('dynsight.copilotCallbacks')) return;
      clear(); if (!enabled()) {
        stopRevision++; automatic = false; pendingChange = false; deferredReason = undefined;
        userAction = false; clearTimeout(timer); status('off');
      } else schedule();
    }),
    { dispose: () => { disposed = true; clearTimeout(timer); controller?.dispose(); } });
  const ready = workspace.ready.then(async () => { await copyIncludeScopes(); return run(); });
  return { ready };
}
