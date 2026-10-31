import * as vscode from 'vscode';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Minimatch } from 'minimatch';
import { WorkspaceIndex } from './workspace';
import { CopilotCallbackController, CallbackHint, CopilotSnapshot, CopilotProgress, CopilotProvider } from './copilot-callbacks';
import { createCliCallbackProvider, CliProvider } from './cli-callback-provider';
import { bundledAiEngine, installedAiExtensions } from './ai-extensions';
import { prepareCallbackContexts, CallbackSite } from './copilot-context';
import { applyCallbackHints } from './copilot-relations';
import { CallbackOverrideStore, makeCallbackOverride, ResolvedOverride } from './callback-overrides';
import { Location, SymbolRecord, fileKey, locationKey } from './model';
import { analysisConfiguration, configured, smartAnalysisScope } from './analysis-policy';

export interface CallbackActionHandle { siteKey: string; targetId?: string; overrideKey?: string }
export interface CallbackTargetChoice { id: string; name: string; location: Location; compatibility: 'compatible' | 'unknown' | 'incompatible'; reason?: string }
export interface CallbackActionResult { hint?: CallbackHint; suggestionId?: string; comparison?: 'agrees' | 'different' | 'insufficient' }
interface SavedModel { id: string; version: string }
const storageKey = 'callbackOverrides-v1';
export function registerCopilotCallbacks(context: vscode.ExtensionContext, workspace: WorkspaceIndex) {
  let savedModel = context.workspaceState.get<SavedModel>('copilotCallbackModel');
  let model: vscode.LanguageModelChat | undefined, controller: CopilotCallbackController | undefined;
  let cliProvider: CopilotProvider | undefined;
  let overrides = new CallbackOverrideStore(context.workspaceState.get(storageKey));
  let revision = 0, manualRevision = 0, disposed = false, selecting = false, starting = false, running: Promise<unknown> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let automaticPaused = false;
  let writing = Promise.resolve();
  const hints = new Map<string, CallbackHint>();
  const suggestions = new Map<string, {id: string; result: CallbackHint; manualRevision: number}>();
  const provider = () => vscode.workspace.getConfiguration('dynsight').get<'auto' | 'copilot' | CliProvider>('smartAnalysis.provider', 'auto');
  const providerLabel = () => ({auto:'AI',copilot:'Copilot',claude:'Claude Code',codex:'Codex'})[provider()];
  const activity = {state: 'off', provider: providerLabel(), error: undefined as string | undefined, manualReview: 0, manualInactive: 0, automatic: false, total: 0, completed: 0, requests: 0, cacheHits: 0, remaining: 0, failures: 0, candidates: 0, notFound: 0, contextLimited: 0, excluded: 0};
  const enabled = () => { const config = analysisConfiguration(vscode.workspace.getConfiguration('dynsight'), vscode.workspace.getConfiguration('cRelation')); return vscode.workspace.isTrusted &&
    (configured<boolean>(config, 'smartAnalysis.ai') ?? configured<boolean>(config, 'smartAnalysis.copilot') ?? config.get('copilotCallbacks', false)); };
  const canAnalyze = () => !workspace.hasDirtySources && (workspace.copilotSnapshotReady ?? workspace.stable);
  const configuredModel = () => provider()==='copilot' ? vscode.workspace.getConfiguration('dynsight').get<string>('copilotModel', '').trim() : '';
  const indexes=()=>workspace.callbackIndexes??[workspace.index];
  const indexForSite=(site:CallbackSite)=>indexes().find(index=>index.files.has(fileKey(site.file)))??workspace.index;
  function resolvedOverrides(){
    const values=new Map<string,ResolvedOverride>(),rank={'inactive':0,'needs-review':1,'active':2};
    for(const index of indexes())for(const value of overrides.resolve(index))if(!values.has(value.record.key)||rank[value.status]>rank[values.get(value.record.key)!.status])values.set(value.record.key,value);
    return [...values.values()];
  }
  function status(value: string) { activity.state = value; activity.provider = providerLabel(); workspace.copilotDiagnostics = {...activity}; workspace.diagnosticsChanged.fire(); }
  function progress(value: CopilotProgress) {
    for (const key of ['total', 'completed', 'remaining', 'failures', 'candidates', 'notFound', 'contextLimited', 'excluded'] as const) activity[key] = value[key] ?? 0;
    activity.cacheHits = value.cached;
  }
  function configFor(uri: string) {
    const value = vscode.Uri.parse(uri), resource = vscode.workspace.getWorkspaceFolder(value)?.uri;
    return {config: analysisConfiguration(vscode.workspace.getConfiguration('dynsight', resource), vscode.workspace.getConfiguration('cRelation', resource)), relative: vscode.workspace.asRelativePath(value, false).replace(/\\/g, '/')};
  }
  function match(patterns: readonly string[], relative: string) { return patterns.some(pattern => new Minimatch(pattern, {dot: true, nonegate: true, nocomment: true, noext: true, nocase: process.platform === 'win32'}).match(relative)); }
  function detailed(uri: string) {
    const {config,relative}=configFor(uri),scope=smartAnalysisScope(config);
    return (scope.include===undefined||match(scope.include,relative))&&!match(scope.exclude,relative);
  }
  function eligible(uri: string) {
    const {config, relative} = configFor(uri),scope=smartAnalysisScope(config);
    return detailed(uri) && (scope.unified || (match(config.get<string[]>('copilotInclude', []), relative) && !match(config.get<string[]>('copilotExclude', []), relative)));
  }
  function project() {
    if (disposed) return;
    const resolved=resolvedOverrides();
    activity.manualReview=resolved.filter(value=>value.status==='needs-review').length;activity.manualInactive=resolved.filter(value=>value.status==='inactive').length;
    const manual = resolved.filter(value => value.status !== 'active' || detailed(value.record.uri));
    for(const index of indexes())applyCallbackHints(index, [...hints.values()].filter(hint => enabled() && eligible(hint.callsite.uri)), workspace.hasDirtySources ? [] : manual);
    workspace.copilotDiagnostics={...activity};workspace.diagnosticsChanged.fire();workspace.changed.fire();
  }
  function snapshot(): CopilotSnapshot {
    const all=new Map(indexes().flatMap(index=>[...index.files.values()].map(file=>[fileKey(file),file] as const)));
    const files = [...all.values()].map(file => file.references.some(ref => ['ai-candidate', 'user-confirmed'].includes(ref.callKind ?? '')) ?
      {...file, references: file.references.filter(ref => !['ai-candidate', 'user-confirmed'].includes(ref.callKind ?? ''))} : file);
    return {generation: workspace.generation, settingsKey: workspace.analysisKey, scopeRevision: revision, files, callsiteUris: new Set(files.filter(file => eligible(file.uri)).map(file => file.uri))};
  }
  function stop(value = 'stopped') {
    if (value === 'stopped') automaticPaused = true;
    else { revision++; controller?.invalidate(); }
    controller?.stop(); suggestions.clear(); activity.automatic = false; status(value);
  }
  async function selectProvider(picker=false) {
    const epoch=revision, choices=installedAiExtensions();
    if(!choices.length)throw new Error('Install and sign in to Copilot, Claude Code or Codex in this VS Code environment. Dynsight uses one selected extension.');
    const chosen=choices.length===1&&!picker?choices[0]:await vscode.window.showQuickPick(choices,
      {title:'Select one AI extension for Dynsight',placeHolder:'Only this extension will handle Smart Analysis. The others will not receive requests.'});
    if(disposed||epoch!==revision)return false;
    if(!chosen){status('provider-unavailable');return false;}
    selecting=true;
    try {await vscode.workspace.getConfiguration('dynsight').update('smartAnalysis.provider',chosen.value,vscode.ConfigurationTarget.Workspace);}
    finally {selecting=false;}
    return !disposed&&epoch===revision;
  }
  async function selectModel(picker = false) {
    const epoch = revision;
    if(provider()==='auto'&&!await selectProvider())return false;
    const id = configuredModel();
    const selectedProvider=provider();
    if(selectedProvider!=='copilot') {
      if(selectedProvider!=='claude'&&selectedProvider!=='codex')throw new Error('Choose one supported Smart Analysis AI extension.');
      if(picker)void vscode.window.showInformationMessage(`${providerLabel()} uses its default model. No model ID is needed.`);
      if(!cliProvider) {
        const selected=await createCliCallbackProvider({provider:selectedProvider,
          executable:await bundledAiEngine(selectedProvider),model:configuredModel()});
        if(disposed||epoch!==revision)return false;
        cliProvider=selected;
      }
      return !disposed&&epoch===revision;
    }
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
    if (disposed || epoch !== revision) return false;
    selecting = true;
    try { if (configuredModel() !== chosen.id) await vscode.workspace.getConfiguration('dynsight').update('copilotModel', chosen.id, vscode.ConfigurationTarget.Workspace); }
    finally { selecting = false; }
    return epoch === revision && !disposed;
  }
  function setup() {
    if (controller || (!cliProvider && !savedModel) || !context.storageUri) return;
    const selected = cliProvider ? {id:configuredModel(),version:cliProvider.modelKey} : savedModel!;
    const selectedProvider=provider(), cacheKey = createHash('sha256').update(cliProvider?.modelKey ?? JSON.stringify([selected.id, selected.version])).digest('hex');
    controller = new CopilotCallbackController({cacheDir: path.join(context.storageUri.fsPath, 'copilot-callbacks', cacheKey),
      isCurrent: value => !disposed && enabled() && canAnalyze() && value.generation === workspace.generation && value.settingsKey === workspace.analysisKey && value.scopeRevision === revision && provider()===selectedProvider && configuredModel() === selected.id,
      onProgress: value => {
        if (!activity.automatic) return;
        progress(value); status('analyzing');
      },
      onHints: values => {
        if (!activity.automatic) return;
        for (const hint of values) hints.set(hint.key, hint);
        project();
      },
      provider: cliProvider ? {modelKey:cliProvider.modelKey,complete:async(prompt,signal)=>{
        activity.requests++;status('analyzing');
        try {return await cliProvider!.complete(prompt,signal);}
        catch(error) {if(!signal.aborted)activity.error=error instanceof Error?error.message:'AI request failed';throw error;}
      }} : {modelKey: `copilot:${selected.id}:${selected.version}`, complete: async (prompt, signal) => {
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
  async function analyzeAutomatically() {
    if (disposed || running || starting) return;
    if (automaticPaused) { project(); return; }
    if (!enabled()) { project(); status('off'); return; }
    if (!canAnalyze()) { activity.automatic = true; status('waiting-for-saved-index'); return; }
    const epoch = revision, confirmedRevision = manualRevision;
    activity.error=undefined;
    const task = (async () => {
      const value = snapshot();
      if (!value.callsiteUris?.size) {
        const builder = await prepareCallbackContexts(value.files, () => epoch === revision && !disposed && canAnalyze() && value.generation === workspace.generation);
        if (epoch !== revision || disposed || !canAnalyze() || value.generation !== workspace.generation) return;
        Object.assign(activity, {total: 0, completed: 0, cacheHits: 0, remaining: 0, failures: 0, candidates: 0, notFound: 0, contextLimited: 0, excluded: builder.sites.length, automatic: false});
        project(); status('ready'); return;
      }
      activity.automatic = true; status('restoring-cache');
      if (!await selectModel()) {
        if (epoch === revision && !disposed) { automaticPaused = true; activity.automatic = false; status(activity.state); }
        return;
      }
      if (epoch !== revision || disposed || automaticPaused || !canAnalyze()) return;
      setup(); if (!controller) throw new Error('AI storage is unavailable.');
      value.excludedCallsiteKeys = new Set(resolvedOverrides().filter(item => item.status === 'active').map(item => `${locationKey(item.site!.location)}:${item.site!.location.start}:${item.site!.location.end}`));
      const result = await controller.analyzeUnresolved(value, {reason: 'enabled', automatic: true});
      if (result.stale || epoch !== revision || confirmedRevision !== manualRevision) return;
      for (const hint of result.hints) hints.set(hint.key, hint);
      progress(result); activity.automatic = false;
      if (result.failures) automaticPaused = true;
      project(); status(result.stopped ? 'stopped' : result.failures ? 'request-failed' : 'ready');
    })();
    running = task;
    try { await task; }
    catch(error) { if (!disposed && epoch === revision) { activity.error=error instanceof Error?error.message:'AI request failed';automaticPaused = true; activity.automatic = false; status('request-failed'); } }
    finally {
      if (running === task) running = undefined;
      if (!disposed && (epoch !== revision || confirmedRevision !== manualRevision)) schedule();
    }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(() => { void analyzeAutomatically().catch(() => status('request-failed')); }, 10); }
  async function siteFor(action: CallbackActionHandle) {
    if (!canAnalyze()) throw new Error('Save source changes and wait for basic navigation to be ready.');
    const confirmed=action.overrideKey&&resolvedOverrides().find(value=>value.record.key===action.overrideKey&&value.status==='active'&&
      `${locationKey(value.site!.location)}:${value.site!.location.start}:${value.site!.location.end}`===action.siteKey);
    const value = snapshot();
    if(confirmed)value.preferredTargetId=confirmed.target!.id;
    const builder = await prepareCallbackContexts(value.files, () => !disposed && value.generation === workspace.generation,confirmed?new Set([action.siteKey]):undefined);
    const site = builder.sites.find(site => site.key === action.siteKey);
    if (!site || value.generation !== workspace.generation || !canAnalyze()) throw new Error('This callback changed. Open its popup again.');
    return {site, snapshot: value};
  }
  function compatibility(site: CallbackSite, target: SymbolRecord): CallbackTargetChoice['compatibility'] {
    const index=indexForSite(site);
    const members=site.file.references.filter(ref=>ref.member&&ref.location.start>=site.call.location.start&&ref.location.end<=site.call.location.end);
    const bindings = members.length ? members.flatMap(ref=>index.resolveReference(ref)) : index.resolveReference(site.call);
    const signatures = bindings.flatMap(symbol => symbol.signature ? [symbol.signature] : index.symbols().filter(type => type.kind === 'type' && type.name === symbol.type?.name && type.signature).map(type => type.signature!));
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
      return indexForSite(site).symbols().filter(symbol => symbol.kind === 'function' && symbol.definition && symbol.name.toLowerCase().includes(text)).slice(0, 50)
        .map(target => ({id: target.id, name: target.name, location: target.location, compatibility: compatibility(site, target), reason: compatibility(site, target) === 'incompatible' ? 'Function signature does not match the callback.' : undefined}));
    },
    async setTarget(action: CallbackActionHandle, targetId: string) {
      const {site} = await siteFor(action), index=indexForSite(site),target = index.symbol(targetId);
      if (!target || compatibility(site, target) === 'incompatible') throw new Error('Choose a compatible indexed function.');
      const existing = action.overrideKey ? overrides.records().find(value => value.key === action.overrideKey) : undefined;
      const original = existing ? resolvedOverrides().find(value => value.record.key === existing.key)?.original?.id : action.targetId;
      if (!original) throw new Error('Choose an AI candidate to replace.');
      const dependencies = [...(existing?.dependencies.map(value=>value.uri)??[]),
        ...(hints.get(action.siteKey)?.candidates.flatMap(value => value.evidence.map(at => at.uri)) ?? []),
        ...(suggestions.get(action.siteKey)?.result.candidates.filter(value=>value.targetId===targetId).flatMap(value=>value.evidence.map(at=>at.uri))??[])];
      const record = makeCallbackOverride(index, site.call.location, original, targetId, dependencies), generation = workspace.generation;
      await persist(next => { if (generation !== workspace.generation || !canAnalyze()) throw new Error('The source changed. Choose the target again.'); if (existing) next.remove(existing.key); next.set(record); });
    },
    async removeOverride(action: CallbackActionHandle) { if (!action.overrideKey) throw new Error('No manual override selected.'); await persist(next => next.remove(action.overrideKey!)); },
    async analyze(action: CallbackActionHandle, recheck: boolean): Promise<CallbackActionResult> {
      if (!enabled()) throw new Error('Enable Smart Analysis: AI in Settings before requesting AI analysis.');
      if (running || starting) throw new Error('Another callback analysis is running.');
      const startRevision = revision, startManualRevision = manualRevision;
      starting=true;
      try {
      const {site, snapshot: value} = await siteFor(action);
      if (!eligible(site.file.uri)) throw new Error('This callback is outside the Smart Analysis AI scope.');
      const epoch = revision, confirmedRevision = manualRevision;
      if (!await selectModel() || epoch !== revision) throw new Error('AI model selection cancelled.');
      setup(); if (!controller) throw new Error('AI storage is unavailable.');
      value.scopeRevision = revision;
      if(action.overrideKey)value.preferredTargetId=resolvedOverrides().find(value=>value.record.key===action.overrideKey)?.target?.id;
      const active = controller; status('analyzing');
      const task = (async () => {
        const result = await active.analyzeSite(value, action.siteKey, {recheck});
        if (result.stale || epoch !== revision || confirmedRevision !== manualRevision) throw new Error('The callback or selection changed during AI analysis.');
        if (result.failures) { activity.failures += result.failures; status('request-failed'); throw new Error('Copilot could not analyze this callback.'); }
        const hint = result.hints[0]; if (!hint) throw new Error('No current callback result is available.');
        if(!action.overrideKey){
          const previous=hints.get(hint.key);
          if(!previous)activity.completed++;
          activity.total=Math.max(activity.total,activity.completed);activity.remaining=Math.max(0,activity.total-activity.completed);
          activity.candidates+=hint.candidates.length-(previous?.candidates.length??0);
          activity.notFound+=Number(hint.status==='not-found')-Number(previous?.status==='not-found');
          activity.contextLimited+=Number(hint.contextLimited===true)-Number(previous?.contextLimited===true);
          hints.set(hint.key,hint);project();
        }
        activity.cacheHits += Number(hint.cached); status(result.stopped ? 'stopped' : 'ready');
        if (!action.overrideKey) return {hint};
        const selected = resolvedOverrides().find(value => value.record.key === action.overrideKey)?.target;
        const suggestionId = randomUUID(); suggestions.set(action.siteKey, {id: suggestionId, result: hint, manualRevision});
        return {hint, suggestionId, comparison: hint.candidates.some(value => value.targetId === selected?.id) ? 'agrees' as const : hint.candidates.length ? 'different' as const : 'insufficient' as const};
      })(); running = task;
      try { return await task; } finally { if (running === task) running = undefined; }
      } finally {starting=false;if(startRevision!==revision||startManualRevision!==manualRevision)schedule();}
    },
    async useSuggestion(action: CallbackActionHandle, suggestionId: string, targetId: string) {
      const saved = suggestions.get(action.siteKey);
      if (!saved || saved.id !== suggestionId || saved.manualRevision !== manualRevision || !saved.result.candidates.some(value => value.targetId === targetId)) throw new Error('The AI suggestion changed. Recheck this callback.');
      await actions.setTarget(action, targetId);
    },
    cancel(_action?: CallbackActionHandle) { stop(); }
  };
  async function command(recheck = false, action?: CallbackActionHandle) {
    if (!enabled()) { await vscode.window.showInformationMessage('Enable Smart Analysis: AI in Dynsight Settings to analyze unresolved callbacks automatically.'); return; }
    if (!action) { automaticPaused = false; await running?.catch(() => {}); await analyzeAutomatically(); return; }
    await actions.analyze(action, recheck);
  }
  const selectModelCommand=async()=>{
    stop('waiting-for-saved-index'); automaticPaused = false;
    await running?.catch(() => {});
    try {if (await selectModel(true)) schedule(); else automaticPaused = true;}
    catch(error) {automaticPaused=true;activity.error=error instanceof Error?error.message:'AI model selection failed';status('request-failed');await vscode.window.showErrorMessage(activity.error);}
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('dynsight.selectAiProvider',async()=>{
      stop('waiting-for-saved-index');automaticPaused=false;
      await running?.catch(()=>{});
      try {
        if(await selectProvider(true)){controller?.dispose();controller=undefined;cliProvider=undefined;model=undefined;hints.clear();activity.error=undefined;project();schedule();}
        else automaticPaused=true;
      } catch(error) {automaticPaused=true;activity.error=error instanceof Error?error.message:'AI extension selection failed';status('request-failed');await vscode.window.showErrorMessage(activity.error);}
    }),
    vscode.commands.registerCommand('dynsight.analyzeCallbacksWithAI', (action?: CallbackActionHandle) => command(false, action)),
    vscode.commands.registerCommand('dynsight.reanalyzeCallbacksWithAI', (action?: CallbackActionHandle) => command(true, action)),
    vscode.commands.registerCommand('dynsight.selectAiModel',selectModelCommand),
    vscode.commands.registerCommand('dynsight.stopAiAnalysis',()=>stop()),
    vscode.commands.registerCommand('dynsight.analyzeCallbacksWithCopilot', (action?: CallbackActionHandle) => command(false, action)),
    vscode.commands.registerCommand('dynsight.reanalyzeCallbacksWithCopilot', (action?: CallbackActionHandle) => command(true, action)),
    vscode.commands.registerCommand('dynsight.selectCopilotModel', selectModelCommand),
    vscode.commands.registerCommand('dynsight.stopCopilotAnalysis', () => stop()),
    workspace.sourceChanged.event(() => {
      const pausedState = ['request-failed', 'model-unavailable'].includes(activity.state) ? activity.state : 'stopped';
      stop('waiting-for-saved-index'); hints.clear(); project(); if (automaticPaused) status(pausedState);
    }),
    workspace.settled.event(schedule),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (selecting) return;
      if (['copilotCallbacks', 'copilotModel', 'copilotInclude', 'copilotExclude', 'detailedAnalysisFolders', 'smartAnalysis.include', 'smartAnalysis.exclude', 'smartAnalysis.copilot', 'smartAnalysis.ai', 'smartAnalysis.provider', 'include', 'exclude'].some(key => event.affectsConfiguration(`dynsight.${key}`) || event.affectsConfiguration(`cRelation.${key}`))) {
        automaticPaused = false;
        stop(enabled() ? 'waiting-for-saved-index' : 'off'); controller?.dispose(); controller = undefined; model = undefined; cliProvider=undefined; activity.error=undefined; hints.clear(); project(); schedule();
      }
    }),
    {dispose() { disposed = true; clearTimeout(timer); controller?.dispose(); }}
  );
  return {ready: workspace.ready.then(analyzeAutomatically), actions};
}
export type CallbackActions = ReturnType<typeof registerCopilotCallbacks>['actions'];
