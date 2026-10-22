import * as vscode from 'vscode';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Minimatch } from 'minimatch';
import { WorkspaceIndex } from './workspace';
import { CopilotCallbackController, CallbackHint, CopilotSnapshot } from './copilot-callbacks';
import { prepareCallbackContexts, CallbackSite } from './copilot-context';
import { applyCallbackHints } from './copilot-relations';
import { CallbackOverrideStore, makeCallbackOverride } from './callback-overrides';
import { Location, SymbolRecord } from './model';

export interface CallbackActionHandle { siteKey: string; targetId?: string; overrideKey?: string }
export interface CallbackTargetChoice { id: string; name: string; location: Location; compatibility: 'compatible' | 'unknown' | 'incompatible'; reason?: string }
export interface CallbackActionResult { hint?: CallbackHint; suggestionId?: string; comparison?: 'agrees' | 'different' | 'insufficient' }
interface SavedModel { id: string; version: string }
const storageKey = 'callbackOverrides-v1';
export function registerCopilotCallbacks(context: vscode.ExtensionContext, workspace: WorkspaceIndex) {
  let savedModel = context.workspaceState.get<SavedModel>('copilotCallbackModel');
  let model: vscode.LanguageModelChat | undefined, controller: CopilotCallbackController | undefined;
  let overrides = new CallbackOverrideStore(context.workspaceState.get(storageKey));
  let revision = 0, manualRevision = 0, disposed = false, selecting = false, starting = false, running: Promise<unknown> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let writing = Promise.resolve();
  const hints = new Map<string, CallbackHint>();
  const suggestions = new Map<string, {id: string; result: CallbackHint; manualRevision: number}>();
  const activity = {state: 'off', manualReview: 0, manualInactive: 0, automatic: false, total: 0, completed: 0, requests: 0, cacheHits: 0, remaining: 0, failures: 0, candidates: 0, notFound: 0, contextLimited: 0, excluded: 0};
  const enabled = () => vscode.workspace.isTrusted && vscode.workspace.getConfiguration('dynsight').get('copilotCallbacks', false);
  const canAnalyze = () => !workspace.hasDirtySources && (workspace.copilotSnapshotReady ?? workspace.stable);
  const configuredModel = () => vscode.workspace.getConfiguration('dynsight').get<string>('copilotModel', '').trim();
  function status(value: string) { activity.state = value; workspace.copilotDiagnostics = {...activity}; workspace.diagnosticsChanged.fire(); }
  function configFor(uri: string) {
    const value = vscode.Uri.parse(uri);
    return {config: vscode.workspace.getConfiguration('dynsight', vscode.workspace.getWorkspaceFolder(value)?.uri), relative: vscode.workspace.asRelativePath(value, false).replace(/\\/g, '/')};
  }
  function match(patterns: readonly string[], relative: string) { return patterns.some(pattern => new Minimatch(pattern, {dot: true, nonegate: true, nocomment: true, noext: true, nocase: process.platform === 'win32'}).match(relative)); }
  function detailed(uri: string) {
    const {config,relative}=configFor(uri),entry=config.inspect<string[]>('detailedAnalysisFolders');
    const explicit=entry&&[entry.globalValue,entry.workspaceValue,entry.workspaceFolderValue].some(value=>value!==undefined);
    return !explicit||match(config.get<string[]>('detailedAnalysisFolders',[]),relative);
  }
  function eligible(uri: string) {
    const {config, relative} = configFor(uri), file = workspace.index.files.get(uri);
    return detailed(uri) && file?.analysisPolicy?.propagateCallbacks !== false && match(config.get<string[]>('copilotInclude', []), relative) && !match(config.get<string[]>('copilotExclude', []), relative);
  }
  function project() {
    if (disposed) return;
    const resolved=overrides.resolve(workspace.index);
    activity.manualReview=resolved.filter(value=>value.status==='needs-review').length;activity.manualInactive=resolved.filter(value=>value.status==='inactive').length;
    const manual = resolved.filter(value => value.status !== 'active' || detailed(value.record.uri));
    applyCallbackHints(workspace.index, [...hints.values()].filter(hint => enabled() && eligible(hint.callsite.uri)), workspace.hasDirtySources ? [] : manual);
    workspace.copilotDiagnostics={...activity};workspace.diagnosticsChanged.fire();workspace.changed.fire();
  }
  function snapshot(): CopilotSnapshot {
    const files = [...workspace.index.files.values()].map(file => file.references.some(ref => ['ai-candidate', 'user-confirmed'].includes(ref.callKind ?? '')) ?
      {...file, references: file.references.filter(ref => !['ai-candidate', 'user-confirmed'].includes(ref.callKind ?? ''))} : file);
    return {generation: workspace.generation, settingsKey: workspace.analysisKey, scopeRevision: revision, files, callsiteUris: new Set(files.filter(file => eligible(file.uri)).map(file => file.uri))};
  }
  function stop(value = 'stopped') { revision++; controller?.stop(); controller?.invalidate(); suggestions.clear(); status(value); }
  async function selectModel(picker = false) {
    const epoch = revision, id = configuredModel();
    const models = await vscode.lm.selectChatModels(id && !picker ? {vendor: 'copilot', id} : {vendor: 'copilot'});
    if (disposed || epoch !== revision) return false;
    const selected = picker || !id ? await vscode.window.showQuickPick(models.map(value => ({label: value.name, description: `${value.id} · ${value.version}`, value})),
      {title: 'Select Copilot model for Dynsight', placeHolder: 'Selection alone sends no source and makes no AI request.'}) : undefined;
    const chosen = selected?.value ?? (id && !picker ? models.find(value => value.id === id) : undefined);
    if (disposed || epoch !== revision) return false;
    if (!chosen) { status('model-unavailable'); return false; }
    if (savedModel?.id !== chosen.id || savedModel.version !== chosen.version) { controller?.dispose(); controller = undefined; }
    model = chosen; savedModel = {id: chosen.id, version: chosen.version};
    await context.workspaceState.update('copilotCallbackModel', savedModel);
    selecting = true;
    try { if (configuredModel() !== chosen.id) await vscode.workspace.getConfiguration('dynsight').update('copilotModel', chosen.id, vscode.ConfigurationTarget.Workspace); }
    finally { selecting = false; }
    return epoch === revision && !disposed;
  }
  function setup() {
    if (controller || !savedModel || !context.storageUri) return;
    const selected = savedModel, cacheKey = createHash('sha256').update(JSON.stringify([selected.id, selected.version])).digest('hex');
    controller = new CopilotCallbackController({cacheDir: path.join(context.storageUri.fsPath, 'copilot-callbacks', cacheKey),
      isCurrent: value => !disposed && enabled() && canAnalyze() && value.generation === workspace.generation && value.settingsKey === workspace.analysisKey && value.scopeRevision === revision && configuredModel() === selected.id,
      provider: {modelKey: `copilot:${selected.id}:${selected.version}`, complete: async (prompt, signal) => {
        const cancellation = new vscode.CancellationTokenSource();
        let cancelled=false;
        let rejectWait!: (error: Error) => void;
        const interrupted = new Promise<never>((_, reject) => { rejectWait = reject; });
        const abort = () => { cancelled=true; cancellation.cancel(); rejectWait(new Error('Copilot request cancelled')); };
        signal.addEventListener('abort', abort, {once: true});
        const timeout = setTimeout(() => { cancelled=true; cancellation.cancel(); rejectWait(new Error('Callback request timed out')); }, 60_000);
        const check = () => { if (cancelled || signal.aborted || cancellation.token.isCancellationRequested || !enabled() || configuredModel() !== selected.id) throw new Error('Copilot request cancelled'); };
        try { return await Promise.race([interrupted, (async () => {
          check(); const selectedModel = model?.id === selected.id && model.version === selected.version ? model :
            (await vscode.lm.selectChatModels({vendor: 'copilot', id: selected.id})).find(value => value.version === selected.version);
          check(); if (!selectedModel) throw new Error('Copilot model unavailable');
          const message = vscode.LanguageModelChatMessage.User(prompt), tokens = await selectedModel.countTokens(message, cancellation.token);
          check(); if (tokens > selectedModel.maxInputTokens - 1024) throw new Error('Callback context exceeds model input limit');
          activity.requests++; status('analyzing');
          const response = await selectedModel.sendRequest([message], {}, cancellation.token); check(); let text = '';
          for await (const fragment of response.text) { check(); text += fragment; if (Buffer.byteLength(text) > 64 * 1024) throw new Error('Callback response too large'); }
          return text;
        })()]); } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); cancellation.dispose(); }
      }}});
  }
  async function restore() {
    if (disposed || running || !canAnalyze()) return;
    if (!enabled()) { project(); status('off'); return; }
    if (!savedModel || savedModel.id !== configuredModel()) { project(); status('model-selection-required'); return; }
    setup(); if (!controller) return;
    const active = controller;
    running = (async () => {
      const result = await active.restore(snapshot()); if (result.stale) return;
      for (const hint of result.hints) hints.set(hint.key, hint);
      activity.cacheHits = result.cached; activity.remaining = result.remaining; activity.total = result.total;
      project(); status('ready');
    })();
    try { await running; } finally { running = undefined; }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(() => { void restore().catch(() => status('request-failed')); }, 10); }
  async function siteFor(action: CallbackActionHandle) {
    if (!canAnalyze()) throw new Error('Save source changes and wait for basic navigation to be ready.');
    const confirmed=action.overrideKey&&overrides.resolve(workspace.index).find(value=>value.record.key===action.overrideKey&&value.status==='active'&&
      `${value.site!.location.uri}:${value.site!.location.start}:${value.site!.location.end}`===action.siteKey);
    const value = snapshot();
    if(confirmed)value.preferredTargetId=confirmed.target!.id;
    const builder = await prepareCallbackContexts(value.files, () => !disposed && value.generation === workspace.generation,confirmed?new Set([action.siteKey]):undefined);
    const site = builder.sites.find(site => site.key === action.siteKey);
    if (!site || value.generation !== workspace.generation || !canAnalyze()) throw new Error('This callback changed. Open its popup again.');
    return {site, snapshot: value};
  }
  function compatibility(site: CallbackSite, target: SymbolRecord): CallbackTargetChoice['compatibility'] {
    const members=site.file.references.filter(ref=>ref.member&&ref.location.start>=site.call.location.start&&ref.location.end<=site.call.location.end);
    const bindings = members.length ? members.flatMap(ref=>workspace.index.resolveReference(ref)) : workspace.index.resolveReference(site.call);
    const signatures = bindings.flatMap(symbol => symbol.signature ? [symbol.signature] : workspace.index.symbols().filter(type => type.kind === 'type' && type.name === symbol.type?.name && type.signature).map(type => type.signature!));
    const actual = target.signature;
    if (!actual?.parameters || !signatures.length) return 'unknown';
    const known = signatures.filter(value => value.parameters); if (!known.length) return 'unknown';
    const builtin = (text: string) => /^(?:(?:unsigned|signed|long|short)\s*)*(?:void|char|int|float|double)?\**$/.test(text) && text.length > 0;
    const mismatch = (expected: NonNullable<SymbolRecord['signature']>) => expected.parameters!.length !== actual.parameters!.length || expected.variadic !== actual.variadic ||
      expected.parameters!.some((type, n) => builtin(type) && builtin(actual.parameters![n] ?? '') && type !== actual.parameters![n]) ||
      (!!expected.result && !!actual.result && builtin(expected.result) && builtin(actual.result) && expected.result !== actual.result);
    return known.every(mismatch) ? 'incompatible' : 'unknown';
  }
  const persist = (change: (next: CallbackOverrideStore) => void) => {
    const result = writing.then(async () => { const next = new CallbackOverrideStore(overrides.records()); change(next); await context.workspaceState.update(storageKey, next.records()); overrides = next; manualRevision++; controller?.invalidate(); suggestions.clear(); project(); });
    writing = result.catch(() => {}); return result;
  };
  const actions = {
    async search(action: CallbackActionHandle, query: string): Promise<CallbackTargetChoice[]> {
      const {site} = await siteFor(action), text = query.trim().toLowerCase();
      return workspace.index.symbols().filter(symbol => symbol.kind === 'function' && symbol.definition && symbol.name.toLowerCase().includes(text)).slice(0, 50)
        .map(target => ({id: target.id, name: target.name, location: target.location, compatibility: compatibility(site, target), reason: compatibility(site, target) === 'incompatible' ? 'Function signature does not match the callback.' : undefined}));
    },
    async setTarget(action: CallbackActionHandle, targetId: string) {
      const {site} = await siteFor(action), target = workspace.index.symbol(targetId);
      if (!target || compatibility(site, target) === 'incompatible') throw new Error('Choose a compatible indexed function.');
      const existing = action.overrideKey ? overrides.records().find(value => value.key === action.overrideKey) : undefined;
      const original = existing ? overrides.resolve(workspace.index).find(value => value.record.key === existing.key)?.original?.id : action.targetId;
      if (!original) throw new Error('Choose an AI candidate to replace.');
      const dependencies = [...(existing?.dependencies.map(value=>value.uri)??[]),
        ...(hints.get(action.siteKey)?.candidates.flatMap(value => value.evidence.map(at => at.uri)) ?? []),
        ...(suggestions.get(action.siteKey)?.result.candidates.filter(value=>value.targetId===targetId).flatMap(value=>value.evidence.map(at=>at.uri))??[])];
      const record = makeCallbackOverride(workspace.index, site.call.location, original, targetId, dependencies), generation = workspace.generation;
      await persist(next => { if (generation !== workspace.generation || !canAnalyze()) throw new Error('The source changed. Choose the target again.'); if (existing) next.remove(existing.key); next.set(record); });
    },
    async removeOverride(action: CallbackActionHandle) { if (!action.overrideKey) throw new Error('No manual override selected.'); await persist(next => next.remove(action.overrideKey!)); },
    async analyze(action: CallbackActionHandle, recheck: boolean): Promise<CallbackActionResult> {
      if (!enabled()) throw new Error('Enable Copilot in Settings before requesting AI analysis.');
      if (running || starting) throw new Error('Another callback analysis is running.');
      starting=true;
      try {
      const {site, snapshot: value} = await siteFor(action);
      if (!eligible(site.file.uri)) throw new Error('This callback is outside the Copilot or detailed analysis scope.');
      const epoch = revision, confirmedRevision = manualRevision;
      if (!await selectModel() || epoch !== revision) throw new Error('Copilot model selection cancelled.');
      setup(); if (!controller) throw new Error('Copilot storage is unavailable.');
      value.scopeRevision = revision;
      if(action.overrideKey)value.preferredTargetId=overrides.resolve(workspace.index).find(value=>value.record.key===action.overrideKey)?.target?.id;
      const active = controller; status('analyzing');
      const task = (async () => {
        const result = await active.analyzeSite(value, action.siteKey, {recheck});
        if (result.stale || epoch !== revision || confirmedRevision !== manualRevision) throw new Error('The callback or selection changed during AI analysis.');
        if (result.failures) { activity.failures += result.failures; status('request-failed'); throw new Error('Copilot could not analyze this callback.'); }
        const hint = result.hints[0]; if (!hint) throw new Error('No current callback result is available.');
        if(!action.overrideKey){hints.set(hint.key,hint);project();} activity.completed++; activity.cacheHits += Number(hint.cached); status(result.stopped ? 'stopped' : 'ready');
        if (!action.overrideKey) return {hint};
        const selected = overrides.resolve(workspace.index).find(value => value.record.key === action.overrideKey)?.target;
        const suggestionId = randomUUID(); suggestions.set(action.siteKey, {id: suggestionId, result: hint, manualRevision});
        return {hint, suggestionId, comparison: hint.candidates.some(value => value.targetId === selected?.id) ? 'agrees' as const : hint.candidates.length ? 'different' as const : 'insufficient' as const};
      })(); running = task;
      try { return await task; } finally { if (running === task) running = undefined; }
      } finally {starting=false;}
    },
    async useSuggestion(action: CallbackActionHandle, suggestionId: string, targetId: string) {
      const saved = suggestions.get(action.siteKey);
      if (!saved || saved.id !== suggestionId || saved.manualRevision !== manualRevision || !saved.result.candidates.some(value => value.targetId === targetId)) throw new Error('The AI suggestion changed. Recheck this callback.');
      await actions.setTarget(action, targetId);
    },
    cancel(_action?: CallbackActionHandle) { stop(); }
  };
  async function command(recheck = false, action?: CallbackActionHandle) {
    if (!enabled()) { await vscode.window.showInformationMessage('Enable Copilot in Dynsight Settings, then choose a callback to analyze.'); return; }
    let selected = action;
    if (!selected) { const builder = await prepareCallbackContexts(snapshot().files, () => !disposed); const choice = await vscode.window.showQuickPick(builder.sites.filter(value => eligible(value.file.uri)).map(value => ({label: value.expression, description: `${value.file.uri}:${value.call.location.line + 1}`, value})), {title: recheck ? 'Recheck callback with AI' : 'Find callback target with AI'}); if (!choice) return; selected = {siteKey: choice.value.key}; }
    await actions.analyze(selected, recheck);
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('dynsight.analyzeCallbacksWithCopilot', (action?: CallbackActionHandle) => command(false, action)),
    vscode.commands.registerCommand('dynsight.reanalyzeCallbacksWithCopilot', (action?: CallbackActionHandle) => command(true, action)),
    vscode.commands.registerCommand('dynsight.selectCopilotModel', async () => { await selectModel(true); schedule(); }),
    vscode.commands.registerCommand('dynsight.stopCopilotAnalysis', () => stop()),
    workspace.sourceChanged.event(() => { stop('waiting-for-saved-index'); hints.clear(); project(); }),
    workspace.settled.event(schedule),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (selecting) return;
      if (['copilotCallbacks', 'copilotModel', 'copilotInclude', 'copilotExclude', 'detailedAnalysisFolders', 'include', 'exclude'].some(key => event.affectsConfiguration(`dynsight.${key}`))) {
        stop(enabled() ? 'waiting-for-saved-index' : 'off'); controller?.dispose(); controller = undefined; model = undefined; hints.clear(); project(); schedule();
      }
    }),
    {dispose() { disposed = true; clearTimeout(timer); controller?.dispose(); }}
  );
  return {ready: workspace.ready.then(restore), actions};
}
export type CallbackActions = ReturnType<typeof registerCopilotCallbacks>['actions'];
