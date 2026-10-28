import * as vscode from 'vscode';
import { createHash, randomBytes } from 'node:crypto';
import { WorkspaceIndex } from './workspace';
import { FileAnalysis, GraphData, GraphNode, Location, SymbolRecord, fileKey, locationKey } from './model';
import { ViewState, nodePreviewId, canExpandNode } from './view-state';
import { analysisNotices } from './analysis-notices';
import type { CallbackActions } from './copilot-service';
import { highlightC, SyntaxToken } from './syntax';
import { matchSavedSymbol, readSlots, SavedBranch, SavedSlot, SavedSymbol, SlotViewOptions } from './relation-slots';

const panelAlignments: Partial<Record<ViewState['contextLayout'], string>> = {
  'combined-full-width': 'Justify', 'combined-center': 'Center',
  // Extend the bottom panel under the opposite sidebar to keep the named
  // sidebar full height, using native VS Code panel alignment commands.
  'combined-keep-left-sidebar': 'Right', 'combined-keep-right-sidebar': 'Left'
};

export class RelationView implements vscode.Disposable {
  state: ViewState = { slots: [], canGoBack: false, candidates: [], status: 'Open a C file and click a symbol name.', fileCount: 0,
    issues: [], mode: 'references', accessFilter: 'all', depth: 1, locked: false, skipInactive: true,
    calleeSort: 'name', contextLayout: 'combined', callGraphDirection: 'callers-left', includeFunctionArguments: false, analyzeCallbacks: true };
  readonly activity = new vscode.EventEmitter<string>();
  private webview?: vscode.WebviewView;
  private contextView?: vscode.WebviewView;
  private root?: { id: string; name: string; uri: string };
  private expanded: Record<string, number> = {};
  private locations = new Map<string, { location: Location; label: string }>();
  private nodes = new Map<string, GraphNode>();
  private selection?: string;
  private selectedNodeKey?: string;
  private callbackFocus?: { uri: string; offset: number; text: string };
  private contextChoices = new Map<string, string>();
  private choosingContext = false;
  private listener: vscode.Disposable;
  private preferences: vscode.Disposable;
  private diagnosticsListener: vscode.Disposable;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private openingSource = false;
  private lastEditor?: vscode.TextEditor;
  private pendingTrack = false;
  private syntaxCache?: { text: string; tokens: SyntaxToken[][] };
  private panelLayout = Promise.resolve();
  private graphSnapshot?: { key: string; files: FileAnalysis[]; graph?: GraphData };
  private savedSlots: (SavedSlot | null)[];
  private slotActions = Promise.resolve();
  private expansionHistory: { expanded: Record<string, number>; selection?: string; selectedNodeKey?: string }[] = [];
  private historyContext?: { key: string; files: FileAnalysis[] };
  constructor(private workspace: WorkspaceIndex, private extensionUri: vscode.Uri, private callbackActions?: CallbackActions,
    private storage?: Pick<vscode.Memento, 'get' | 'update'>) {
    this.savedSlots = readSlots(storage?.get('relationSlots-v1'));
    this.slotSummaries();
    this.diagnosticsListener = workspace.diagnosticsChanged.event(() => {
      this.state.diagnostics = workspace.diagnostics;
      void this.webview?.webview.postMessage({ type: 'diagnostics', diagnostics: this.state.diagnostics });
    });
    this.readPreferences();
    this.preferences = vscode.workspace.onDidChangeConfiguration(event => {
      const analysisChanged = ['analyzeCallbacks', 'detailedAnalysisFolders', 'smartAnalysis.macro', 'smartAnalysis.include', 'smartAnalysis.exclude'].some(key => event.affectsConfiguration(`dynsight.${key}`) || event.affectsConfiguration(`cRelation.${key}`));
      if (event.affectsConfiguration('dynsight.calleeSort') || event.affectsConfiguration('dynsight.contextLayout') || event.affectsConfiguration('dynsight.includeFunctionArguments') || analysisChanged) {
        const previousLayout = this.state.contextLayout;
        this.readPreferences();
        if (analysisChanged) {
          this.clearHistory();
          this.callbackFocus = undefined; this.state.callback = undefined;
          this.track(this.lastEditor, true);
        }
        this.refresh();
        if (previousLayout !== this.state.contextLayout) void this.applyPanelLayout(previousLayout);
        if (previousLayout !== 'separate' && this.state.contextLayout === 'separate') {
          void vscode.commands.executeCommand('dynsight.context.focus', { preserveFocus: true });
        }
      } else if (event.affectsConfiguration('dynsight.callGraphDirection')) {
        this.clearHistory(); this.readPreferences(); this.publish();
      }
    });
    this.listener = workspace.changed.event(() => {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => {
        if (!this.pendingTrack || !this.track(this.lastEditor)) this.refresh();
      }, 70);
    });
  }
  private readPreferences() {
    const config = vscode.workspace.getConfiguration('dynsight');
    this.state.calleeSort = config.get('calleeSort') === 'source' ? 'source' : 'name';
    const layout = config.get('contextLayout');
    this.state.contextLayout = layout === 'separate' || (typeof layout === 'string' && Object.hasOwn(panelAlignments, layout)) ? layout as ViewState['contextLayout'] : 'combined';
    this.state.callGraphDirection = config.get('callGraphDirection') === 'callees-left' ? 'callees-left' : 'callers-left';
    this.state.includeFunctionArguments = config.get('includeFunctionArguments') === true;
    this.state.analyzeCallbacks = this.workspace.analyzeCallbacks;
  }
  private applyPanelLayout(previousLayout?: ViewState['contextLayout']) {
    const layout = this.state.contextLayout, alignment = panelAlignments[layout];
    this.panelLayout = this.panelLayout.then(async () => {
      if (this.state.contextLayout !== layout) return;
      if (alignment) {
        await vscode.commands.executeCommand('workbench.action.positionPanelBottom');
        if (this.state.contextLayout === layout) await vscode.commands.executeCommand(`workbench.action.alignPanel${alignment}`);
      } else if (previousLayout && panelAlignments[previousLayout]) await vscode.commands.executeCommand('workbench.action.alignPanelCenter');
    }).catch(error => { void vscode.window.showErrorMessage(`Dynsight: Could not change panel layout: ${String(error)}`); });
    return this.panelLayout;
  }
  resolveWebviewView(view: vscode.WebviewView, contextOnly = false) {
    if (contextOnly) this.contextView = view; else this.webview = view;
    const assets = vscode.Uri.joinPath(this.extensionUri, 'dist');
    view.webview.options = { enableScripts: true, localResourceRoots: [assets] };
    const css = view.webview.asWebviewUri(vscode.Uri.joinPath(assets, 'webview.css'));
    const js = view.webview.asWebviewUri(vscode.Uri.joinPath(assets, 'webview.js'));
    const nonce = randomBytes(18).toString('hex');
    view.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <link rel="stylesheet" href="${css}"><title>Dynsight</title></head><body data-view="${contextOnly ? 'context' : 'relation'}"><div id="app"></div><script nonce="${nonce}" src="${js}"></script></body></html>`;
    view.webview.onDidReceiveMessage(message => { void this.handleMessage(message).catch(error => vscode.window.showErrorMessage(`Dynsight: ${String(error)}`)); });
    view.onDidDispose(() => {
      if (contextOnly && this.contextView === view) this.contextView = undefined;
      if (!contextOnly && this.webview === view) this.webview = undefined;
    });
    if (!contextOnly) { this.publish(); void this.applyPanelLayout(); }
  }
  private get index() { const uri = this.state.locked && this.root ? this.root.uri : this.lastEditor?.document.uri.toString() ?? this.root?.uri; return uri ? this.workspace.indexFor(uri) : this.workspace.index; }
  private contextKey(uri: string) { const key = this.contextChoices.get(uri); return key && this.index.files.has(key) ? key : uri; }
  private async chooseContext(editor: vscode.TextEditor, files: FileAnalysis[]) {
    if (this.choosingContext) return;
    this.choosingContext = true;
    try {
      const selected = await vscode.window.showQuickPick(files.map((file, n) => {
        const unit = this.workspace.buildProfile?.units.find(unit => unit.id === file.context?.unitId);
        return {label:unit ? vscode.workspace.asRelativePath(vscode.Uri.parse(unit.sourceUri)) : `Source context ${n+1}`, description:`Header variant ${n+1}`, key:fileKey(file)};
      }), {title:'Select the source file that includes this header'});
      if (selected && this.lastEditor === editor) { this.contextChoices.set(editor.document.uri.toString(), selected.key); this.track(editor, true); }
    } finally { this.choosingContext = false; }
  }
  track(editor: vscode.TextEditor | undefined, explicit = false) {
    if (!editor || !/\.[ch]$/i.test(editor.document.uri.path)) return false;
    this.lastEditor = editor;
    if (this.state.locked || (this.openingSource && !explicit)) return false;
    this.pendingTrack = false;
    const position = editor.selection.isEmpty ? editor.selection.active : editor.selection.start;
    const word = editor.document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
    if (!word) return false;
    const uri = editor.document.uri.toString(), offset = editor.document.offsetAt(word.start);
    const contexts = this.index.contextsAt(uri);
    if (contexts.length > 1 && this.contextKey(uri) === uri) { void this.chooseContext(editor, contexts); return false; }
    const foundCallback = this.index.callbackAt(this.contextKey(uri), offset);
    const callback = this.state.analyzeCallbacks || foundCallback?.targets.length ? foundCallback : undefined;
    if (callback) {
      if (this.callbackFocus?.uri === uri && this.callbackFocus.offset === offset && this.state.callback) return false;
      this.activity.fire('callback-selection');
      this.callbackFocus = { uri, offset, text: this.index.fileAt(uri)!.text.slice(callback.location.start, callback.location.end) };
      this.root = undefined; this.selection = undefined; this.selectedNodeKey = undefined; this.expanded = {};
      this.state.graph = undefined; this.state.candidates = []; this.refresh(); return true;
    }
    const candidates = this.index.resolveAt(this.contextKey(uri), offset);
    if (!candidates.length) { this.pendingTrack = true; return false; }
    if (candidates.length > 1) {
      this.root = undefined; this.selection = undefined; this.selectedNodeKey = undefined; this.expanded = {};
      this.callbackFocus = undefined; this.state.callback = undefined;
      this.state.graph = undefined; this.state.context = undefined;
      this.state.candidates = candidates; this.refresh(); return true;
    }
    // Cursor movement inside an unchanged symbol must not resend a large graph to WSL.
    if (this.root?.id === candidates[0].id && this.state.graph) return false;
    this.activity.fire('editor-selection');
    this.setRoot(candidates[0]);
    return true;
  }
  private setRoot(symbol: SymbolRecord) {
    this.callbackFocus = undefined; this.state.callback = undefined;
    if (symbol.id !== this.root?.id) { this.expanded = {}; this.selection = symbol.id; this.selectedNodeKey = undefined; }
    this.root = { id: symbol.id, name: symbol.name, uri: symbol.location.uri };
    this.state.candidates = []; this.refresh();
  }
  refresh(publish = true) {
    clearTimeout(this.refreshTimer); this.refreshTimer = undefined;
    this.state.diagnostics = this.workspace.diagnostics;
    this.state.skipInactive = this.workspace.skipInactive;
    this.state.status = this.workspace.status;
    const activeUri=this.lastEditor?.document.uri.toString();
    if(activeUri&&this.workspace.buildProfile){
      const membership=this.workspace.buildMembership(activeUri);
      if(membership==='unknown'||membership==='excluded')this.state.status+=' · Basic navigation: build membership '+membership;
      else if(!this.workspace.skipInactive)this.state.status+=' · All preprocessing branches shown';
    }
    this.state.buildStatus = this.workspace.buildStatus;
    this.state.fileCount = new Set([...this.index.files.values()].map(file=>file.uri)).size;
    this.state.callbackDiagnostics = [...this.index.files.values()].flatMap(file => file.callbackDiagnostics ?? []).slice(0, 64);
    this.state.issues = [
      ...[...this.workspace.failures].map(([uri, error]) => `${vscode.workspace.asRelativePath(vscode.Uri.parse(uri))}: ${error}`),
      ...analysisNotices([...this.index.files.values()], uri => vscode.workspace.asRelativePath(vscode.Uri.parse(uri)))
    ];
    if (this.root) {
      let symbol = this.index.symbol(this.root.id);
      if (!symbol || symbol.name !== this.root.name) {
        const matches = this.index.symbols().filter(s => s.name === this.root!.name && s.location.uri === this.root!.uri && s.definition);
        symbol = matches.length === 1 ? matches[0] : undefined;
        if (symbol) { this.root.id = symbol.id; this.expanded = {}; this.selection = symbol.id; }
      }
      if (symbol) {
        const key = JSON.stringify([symbol.id, this.state.mode, this.state.depth, this.expanded, this.state.accessFilter, this.state.calleeSort, this.state.includeFunctionArguments]);
        const files = [...this.index.files.values()], previous = this.graphSnapshot;
        if (previous?.key === key && files.length === previous.files.length && files.every((file, n) => file === previous.files[n])) this.state.graph = previous.graph;
        else {
          this.state.graph = this.index.graph(symbol.id, this.state.mode, this.state.depth, this.expanded, this.state.accessFilter, this.state.calleeSort, this.state.includeFunctionArguments);
          this.graphSnapshot = { key, files, graph: this.state.graph };
        }
      } else { this.state.graph = undefined; this.graphSnapshot = undefined; }
      if (!symbol) this.state.context = undefined;
    } else this.graphSnapshot = undefined;
    this.locations.clear(); this.nodes.clear();
    if (this.callbackFocus) {
      const focus = this.callbackFocus, callback = this.index.callbackAt(this.contextKey(focus.uri), focus.offset);
      this.state.callback = callback && this.index.fileAt(focus.uri)?.text.slice(callback.location.start, callback.location.end) === focus.text ? callback : undefined;
      if (this.state.callback) {
        this.selection = `callback:${focus.uri}@${this.state.callback.location.start}`;
        this.locations.set(this.selection, { location: this.state.callback.location, label: `Callback · ${this.state.callback.expression}` });
      }
    }
    const visit = (node: GraphNode) => {
      this.nodes.set(node.key, node);
      if (node.symbolId) this.locations.set(node.symbolId, { location: node.location, label: node.name });
      for (const definition of node.definitionCandidates ?? []) this.locations.set(definition.id, { location: definition.location, label: `Macro definition · ${node.name}` });
      for (const site of node.sites) {
        this.locations.set(site.id, { location: site.location, label: `${site.name} · ${site.argument ? `Function argument #${site.argument.position} via ${site.argument.callee}` : site.callKind === 'registered' && site.kind === 'reference' ? 'Registration' : site.kind}` });
        site.inference?.evidence.forEach((frame, i) => this.locations.set(site.id + ':evidence:' + i, { location: frame.location, label: frame.reason }));
      }
      node.children.forEach(visit);
    };
    if (this.state.graph) visit(this.state.graph.root);
    this.state.graph?.callers?.forEach(visit);
    if (this.selectedNodeKey && !this.nodes.has(this.selectedNodeKey)) this.selectedNodeKey = undefined;
    if (this.selection && this.locations.has(this.selection)) this.preview(this.selection);
    else if (this.state.graph?.root.symbolId) { this.selection = this.state.graph.root.symbolId; this.preview(this.selection); }
    else this.state.context = undefined;
    const historyKey = JSON.stringify([this.root?.id, this.slotOptions()]), files = this.graphSnapshot?.files ?? [];
    if (this.historyContext?.key !== historyKey || files.length !== this.historyContext.files.length ||
      files.some((file, n) => file !== this.historyContext!.files[n])) this.clearHistory();
    this.historyContext = { key: historyKey, files };
    if (publish) this.publish();
  }
  private preview(id: string) {
    const selected = this.locations.get(id);
    const file = selected && this.index.fileAt(selected.location.uri, selected.location.context);
    if (!selected || !file) { this.state.context = undefined; return; }
    const lines = file.text.split('\n');
    const firstLine = Math.max(0, selected.location.line - 80);
    if (this.syntaxCache?.text !== file.text) this.syntaxCache = { text: file.text, tokens: highlightC(file.text) };
    this.selection = id;
    this.state.context = { ...selected, text: lines.slice(firstLine, selected.location.line + 121).join('\n'), firstLine,
      tokens: this.syntaxCache.tokens.slice(firstLine, selected.location.line + 121),
      path: vscode.workspace.asRelativePath(vscode.Uri.parse(selected.location.uri)) };
  }
  private publish() {
    void this.webview?.webview.postMessage({ type: 'state', state: this.state });
    void this.contextView?.webview.postMessage({ type: 'context', context: this.state.context });
  }
  private pinNode(key: string | undefined) {
    const id = key ? this.nodes.get(key)?.symbolId : undefined;
    const symbol = id ? this.index.symbol(id) : undefined;
    if (!symbol) return;
    this.state.locked = true;
    this.pendingTrack = false;
    this.selection = symbol.id;
    this.selectedNodeKey = undefined;
    this.setRoot(symbol);
  }
  private slotSummaries() {
    this.state.slots = this.savedSlots.map((slot, n) => ({ slot: n, name: slot?.target.name, kind: slot?.target.kind, locked: slot?.locked ?? false }));
  }
  private slotOptions(): SlotViewOptions {
    const { mode, depth, accessFilter, calleeSort, callGraphDirection, includeFunctionArguments } = this.state;
    return { mode, depth, accessFilter, calleeSort, callGraphDirection, includeFunctionArguments };
  }
  private effectiveLevels(key: string) {
    let levels = this.state.depth, path = '';
    for (const part of key.split('/')) {
      if (path) levels--;
      path = path ? `${path}/${part}` : part;
      levels = this.expanded[path] ?? levels;
    }
    return levels;
  }
  private clearHistory() { this.expansionHistory = []; this.state.canGoBack = false; }
  private changeExpansion(change: () => void) {
    const before = { expanded: { ...this.expanded }, selection: this.selection, selectedNodeKey: this.selectedNodeKey };
    const history = this.expansionHistory, keys = JSON.stringify([...this.nodes.keys()]);
    change(); this.refresh(false);
    if (history === this.expansionHistory && keys !== JSON.stringify([...this.nodes.keys()])) {
      this.expansionHistory.push(before);
      if (this.expansionHistory.length > 100) this.expansionHistory.shift();
    }
    this.state.canGoBack = this.expansionHistory.length > 0;
    this.publish();
  }
  private slotSymbols(index: WorkspaceIndex['index'], uris: Set<string>): SavedSymbol[] {
    const result: SavedSymbol[] = [];
    for (const file of index.files.values()) {
      if (!uris.has(file.uri)) continue;
      const unit = file.context && this.workspace.buildProfile?.units.find(unit => unit.id === file.context!.unitId);
      if (file.context && !unit) continue;
      const sourceDigest = createHash('sha256').update(file.text).digest('hex');
      for (const symbol of file.symbols) {
        if (symbol.kind !== 'function' && symbol.kind !== 'variable') continue;
        const owner = symbol.storage === 'local' ? file.symbols.find(fn => fn.kind === 'function' &&
          fn.extent.start <= symbol.location.start && fn.extent.end >= symbol.location.end) : undefined;
        result.push({ id: symbol.id, uri: symbol.location.uri, name: symbol.name, kind: symbol.kind, start: symbol.location.start,
          definition: symbol.definition, storage: symbol.storage, sourceDigest, containerName: symbol.containerName,
          ownerName: owner?.name, sourceUnitUri: unit?.sourceUri });
      }
    }
    return result;
  }
  private captureSlot(key: string): SavedSlot | undefined {
    const node = this.nodes.get(key), graph = this.state.graph;
    if (!node || !graph) return;
    const files = this.graphSnapshot?.files;
    if (!files || files.length !== this.index.files.size || files.some(file => this.index.files.get(fileKey(file)) !== file)) return;
    const symbols = new Map(this.slotSymbols(this.index, new Set([...this.nodes.values()].map(node => node.location.uri))).map(symbol => [symbol.id, symbol]));
    const target = node.symbolId && symbols.get(node.symbolId);
    if (!target) return;
    const branches: SavedBranch[] = [], options = this.slotOptions();
    const visit = (child: GraphNode, parent: number | null) => {
      const symbol = child.symbolId && symbols.get(child.symbolId);
      if (!symbol) return;
      const n = branches.length;
      branches.push({ parent, symbol, direction: child.direction ?? (options.mode === 'both' ? 'callees' : options.mode),
        levels: parent === null ? this.effectiveLevels(child.key) : this.expanded[child.key] });
      child.children.forEach(next => visit(next, n));
    };
    visit(node, null);
    if (node === graph.root) graph.callers?.forEach(child => visit(child, 0));
    return { target, options, branches, locked: false };
  }
  private async recallSlot(slot: SavedSlot) {
    const index = this.workspace.indexFor(slot.target.uri), symbols = this.slotSymbols(index, new Set(slot.branches.map(branch => branch.symbol.uri).concat(slot.target.uri)));
    const target = matchSavedSymbol(slot.target, symbols), symbol = target && index.symbol(target.id);
    if (!symbol) { void vscode.window.showWarningMessage(`Saved symbol is unavailable: ${slot.target.name}`); return; }
    const { mode, depth, accessFilter, calleeSort, includeFunctionArguments } = slot.options;
    const expanded: Record<string, number> = {}, keys: (string | undefined)[] = [];
    const build = () => index.graph(symbol.id, mode, depth, expanded, accessFilter, calleeSort, includeFunctionArguments);
    let graph = build(), partial = false;
    for (const [n, branch] of slot.branches.entries()) {
      let node = n === 0 ? graph?.root : undefined;
      if (branch.parent !== null) {
        const parentKey = keys[branch.parent];
        const find = (root: GraphNode): GraphNode | undefined => root.key === parentKey ? root : root.children.map(find).find(Boolean);
        const parent = graph && (find(graph.root) ?? graph.callers?.map(find).find(Boolean));
        const children = branch.parent === 0 && mode === 'both' && branch.direction === 'callers' ? graph?.callers : parent?.children;
        const current = matchSavedSymbol(branch.symbol, symbols);
        const matches = parentKey && current ? children?.filter(child => child.symbolId === current.id) ?? [] : [];
        if (matches.length === 1) node = matches[0];
      }
      keys[n] = node?.key;
      if (!node) { partial = true; continue; }
      if (branch.levels !== undefined) { expanded[node.key] = branch.levels; graph = build(); }
    }
    Object.assign(this.state, slot.options);
    this.clearHistory();
    this.state.locked = true; this.state.candidates = []; this.state.callback = undefined;
    this.callbackFocus = undefined; this.pendingTrack = false;
    this.root = { id: symbol.id, name: symbol.name, uri: symbol.location.uri };
    this.expanded = expanded; this.selection = symbol.id; this.selectedNodeKey = undefined;
    if (symbol.location.context) this.contextChoices.set(symbol.location.uri, symbol.location.context);
    this.refresh();
    await this.handleMessage({ type: 'open', id: symbol.id });
    await this.webview?.webview.postMessage({ type: 'revealRoot', id: symbol.id });
    if (partial) void vscode.window.showInformationMessage(`Restored ${symbol.name}; some saved branches are unavailable.`);
  }
  private slotAction(m: Record<string, unknown>) {
    if (!Number.isInteger(m.slot) || Number(m.slot) < 0 || Number(m.slot) >= 5) return Promise.resolve();
    if (m.type === 'saveSlot' && m.symbolId !== undefined && (typeof m.key !== 'string' ||
      this.nodes.get(m.key)?.symbolId !== m.symbolId)) return Promise.resolve();
    const slot = Number(m.slot);
    const captured = m.type === 'saveSlot' && typeof m.key === 'string' ? this.captureSlot(m.key) : undefined;
    const action = this.slotActions.then(async () => {
      const current = this.savedSlots[slot];
      if (m.type === 'recallSlot') { if (current) await this.recallSlot(current); return; }
      const next = readSlots(this.savedSlots);
      if (m.type === 'saveSlot') {
        if (current?.locked || !captured) return;
        next[slot] = captured;
      } else if (m.type === 'lockSlot') {
        if (!current || typeof m.locked !== 'boolean') return;
        next[slot]!.locked = m.locked;
      } else if (m.type === 'clearSlot') {
        if (!current || current.locked) return;
        next[slot] = null;
      }
      await this.storage?.update('relationSlots-v1', next);
      this.savedSlots = next; this.slotSummaries(); this.publish();
    });
    this.slotActions = action.catch(() => {});
    return action;
  }
  async handleMessage(message: unknown) {
    if (!message || typeof message !== 'object') return;
    const m = message as Record<string, unknown>;
    if (typeof m.type === 'string' && ['saveSlot', 'recallSlot', 'lockSlot', 'clearSlot'].includes(m.type)) return this.slotAction(m);
    if (m.type === 'selectBuildConfiguration') { await vscode.commands.executeCommand('dynsight.selectBuildConfiguration'); return; }
    if(m.type === 'copyFunctionName') {
      if(typeof m.requestId !== 'string'||!m.requestId.length||m.requestId.length>128)return;
      let ok=false;if(typeof m.name==='string'&&m.name.length>0&&m.name.length<=4096)try{await vscode.env.clipboard.writeText(m.name);ok=true;}catch{/* UI keeps selectable text on clipboard failure. */}
      await this.webview?.webview.postMessage({type:'copyFunctionNameResult',requestId:m.requestId,ok});return;
    }
    if(typeof m.type==='string' && ['callbackSearch','callbackSetTarget','callbackAnalyze','callbackUseSuggestion','callbackRemoveOverride','callbackCancel'].includes(m.type)) {
      if(typeof m.requestId!=='string'||m.requestId.length>128||typeof m.actionId!=='string'||m.actionId.length>4096)return;
      try {
        if(!this.callbackActions)throw new Error('Callback actions are unavailable.');
        const site=[...this.nodes.values()].flatMap(node=>node.sites).find(site=>site.id===m.actionId&&site.kind==='call'&&site.access);
        if(!site)throw new Error('The callback changed. Open its popup again.');
        const handle={siteKey:`${locationKey(site.location)}:${site.location.start}:${site.location.end}`,targetId:site.targetId,overrideKey:site.manual?.overrideKey};
        let data:Record<string,unknown>={};
        if(m.type==='callbackSearch') {if(typeof m.query!=='string'||m.query.length>512)return;data={choices:await this.callbackActions.search(handle,m.query)};}
        if(m.type==='callbackSetTarget') {if(typeof m.targetId!=='string')return;await this.callbackActions.setTarget(handle,m.targetId);data={saved:true};this.refresh();}
        if(m.type==='callbackRemoveOverride') {await this.callbackActions.removeOverride(handle);data={saved:true};this.refresh();}
        if(m.type==='callbackAnalyze') data={...await this.callbackActions.analyze(handle,m.recheck===true)};
        if(m.type==='callbackUseSuggestion') {if(typeof m.suggestionId!=='string'||typeof m.targetId!=='string')return;await this.callbackActions.useSuggestion(handle,m.suggestionId,m.targetId);data={saved:true};this.refresh();}
        if(m.type==='callbackCancel')this.callbackActions.cancel(handle);
        await this.webview?.webview.postMessage({type:'callbackActionResult',requestId:m.requestId,actionId:m.actionId,ok:true,...data});
      }catch(error){await this.webview?.webview.postMessage({type:'callbackActionResult',requestId:m.requestId,actionId:m.actionId,ok:false,error:String(error instanceof Error?error.message:error)});}
      return;
    }
    if (typeof m.type === 'string' && ['selectNode', 'pinNode', 'navigateContext', 'choose', 'mode', 'depth', 'lock', 'skip', 'refresh', 'expand', 'collapse', 'expandSpecial', 'open'].includes(m.type)) this.activity.fire(m.type);
    switch (m.type) {
      case 'diagnostics': this.workspace.refreshDiagnostics(); break;
      case 'reportIssue': await vscode.commands.executeCommand('dynsight.reportIssue'); break;
      case 'copilotStop': await vscode.commands.executeCommand('dynsight.stopCopilotAnalysis'); break;
      case 'localStop': this.workspace.stopAnalysis(); break;
      case 'localResume': await this.workspace.resumeAnalysis(); break;
      case 'ready': this.refresh(); this.track(vscode.window.activeTextEditor); break;
      case 'readyContext': void this.contextView?.webview.postMessage({ type: 'context', context: this.state.context }); break;
      case 'settings': await vscode.commands.executeCommand('dynsight.openSettings'); break;
      case 'help': await vscode.commands.executeCommand('dynsight.help'); break;
      case 'preview': if (typeof m.id === 'string' && this.locations.has(m.id)) { this.preview(m.id); this.publish(); } break;
      case 'back': {
        this.refresh(false);
        const previous = this.expansionHistory.pop();
        if (previous) {
          this.expanded = previous.expanded; this.selection = previous.selection; this.selectedNodeKey = previous.selectedNodeKey;
        }
        this.state.canGoBack = this.expansionHistory.length > 0;
        this.refresh(); break;
      }
      case 'selectNode': {
        const node = typeof m.key === 'string' ? this.nodes.get(m.key) : undefined;
        if (!node) return;
        this.changeExpansion(() => {
          this.selectedNodeKey = node.key;
          this.selection = nodePreviewId(node);
          if (canExpandNode(node)) this.expanded[node.key] = Math.max(this.effectiveLevels(node.key), this.state.depth);
        });
        break;
      }
      case 'navigateContext': {
        const preview = this.state.context;
        if (!preview || m.uri !== preview.location.uri || !Number.isInteger(m.line) || !Number.isInteger(m.column)) return;
        const line = Number(m.line), column = Number(m.column);
        const text = preview.text.split('\n')[line - preview.firstLine]?.replace(/\r$/, '');
        if (text === undefined || m.text !== text || column < 0 || column > text.length) return;
        const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(preview.location.uri));
        // A preview may lag behind an unsaved edit. Never jump using stale coordinates.
        if (line >= document.lineCount || document.lineAt(line).text !== text) return;
        const position = new vscode.Position(line, column);
        if(preview.location.context)this.contextChoices.set(preview.location.uri,preview.location.context);
        const range = new vscode.Range(position, position);
        const editor = await vscode.window.showTextDocument(document, {
          viewColumn: this.lastEditor?.viewColumn ?? vscode.ViewColumn.One, selection: range, preview: true
        });
        editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        this.track(editor, true);
        break;
      }
      case 'choose': if (typeof m.id === 'string') {
        let choices = this.state.candidates;
        if (this.callbackFocus) {
          const focus = this.callbackFocus, current = this.index.callbackAt(this.contextKey(focus.uri), focus.offset);
          choices = current && this.index.fileAt(focus.uri)?.text.slice(current.location.start, current.location.end) === focus.text ? current.targets : [];
        }
        const symbol = choices.find(s => s.id === m.id);
        if (symbol) this.setRoot(symbol); else if (this.callbackFocus) this.refresh();
      } break;
      case 'mode': if (m.value === 'references' || m.value === 'callers' || m.value === 'callees' || m.value === 'both') { this.clearHistory(); this.state.mode = m.value; this.expanded = {}; this.refresh(); } break;
      case 'access': if (m.value === 'all' || m.value === 'read' || m.value === 'write' || m.value === 'readwrite' || m.value === 'address') {
        this.clearHistory(); this.state.accessFilter = m.value; this.expanded = {}; this.refresh();
      } break;
      case 'depth': if (Number.isInteger(m.value) && Number(m.value) >= 1 && Number(m.value) <= 8) { this.clearHistory(); this.state.depth = Number(m.value); this.expanded = {}; this.refresh(); } break;
      case 'lock':
        if (this.state.locked) { this.state.locked = false; this.publish(); this.track(this.lastEditor); }
        else this.pinNode(this.selectedNodeKey ?? this.state.graph?.root.key);
        break;
      case 'pinNode': if (typeof m.key === 'string') this.pinNode(m.key); break;
      case 'skip': if (typeof m.value === 'boolean') await vscode.workspace.getConfiguration('dynsight').update('skipInactive', m.value, vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global); break;
      case 'refresh': await this.workspace.reindex('toolbar'); this.track(vscode.window.activeTextEditor); this.refresh(); break;
      case 'expand': case 'collapse': case 'expandSpecial': {
        if (typeof m.key !== 'string') return;
        const key = m.key, node = this.nodes.get(key);
        if (!node || !canExpandNode(node)) return;
        let levels = m.type === 'collapse' ? 0 : 1;
        if (m.type === 'expandSpecial') {
          const value = await vscode.window.showInputBox({ title: 'Additional levels to expand from the selected node', value: '2', validateInput: v => /^[1-8]$/.test(v) ? undefined : 'Enter a number from 1 to 8.' });
          if (!value || this.nodes.get(key) !== node || !/^[1-8]$/.test(value)) return;
          levels = Number(value);
        }
        if (m.type === 'collapse') { this.clearHistory(); this.expanded[key] = levels; this.refresh(); }
        else this.changeExpansion(() => { this.expanded[key] = levels; });
        break;
      }
      case 'open': {
        if (typeof m.id !== 'string') return;
        const target = this.locations.get(m.id);
        if (!target) return;
        this.openingSource = true;
        try {
          const loc = target.location;
          if(loc.context)this.contextChoices.set(loc.uri,loc.context);
          await vscode.window.showTextDocument(vscode.Uri.parse(loc.uri), { viewColumn: this.lastEditor?.viewColumn ?? vscode.ViewColumn.One,
            selection: new vscode.Range(loc.line, loc.column, loc.endLine, loc.endColumn), preview: true });
        } finally { setTimeout(() => { this.openingSource = false; }, 150); }
        break;
      }
    }
  }
  dispose() { this.activity.dispose(); clearTimeout(this.refreshTimer); this.listener.dispose(); this.preferences.dispose(); this.diagnosticsListener.dispose(); }
}
