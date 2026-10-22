import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { WorkspaceIndex } from './workspace';
import { GraphNode, Location, SymbolRecord } from './model';
import { ViewState, nodePreviewId, canExpandNode } from './view-state';
import { analysisNotices } from './analysis-notices';
import { highlightC, SyntaxToken } from './syntax';

export class RelationView implements vscode.Disposable {
  state: ViewState = { candidates: [], status: 'Open a C file and click a symbol name.', fileCount: 0,
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
  private listener: vscode.Disposable;
  private preferences: vscode.Disposable;
  private diagnosticsListener: vscode.Disposable;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private openingSource = false;
  private lastEditor?: vscode.TextEditor;
  private pendingTrack = false;
  private syntaxCache?: { text: string; tokens: SyntaxToken[][] };
  constructor(private workspace: WorkspaceIndex, private extensionUri: vscode.Uri) {
    this.diagnosticsListener = workspace.diagnosticsChanged.event(() => {
      this.state.diagnostics = workspace.diagnostics;
      void this.webview?.webview.postMessage({ type: 'diagnostics', diagnostics: this.state.diagnostics });
    });
    this.readPreferences();
    this.preferences = vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('dynsight.calleeSort') || event.affectsConfiguration('dynsight.contextLayout') || event.affectsConfiguration('dynsight.includeFunctionArguments') || event.affectsConfiguration('dynsight.analyzeCallbacks')) {
        const previousLayout = this.state.contextLayout;
        this.readPreferences();
        if (event.affectsConfiguration('dynsight.analyzeCallbacks')) {
          this.callbackFocus = undefined; this.state.callback = undefined;
          this.track(this.lastEditor, true);
        }
        this.refresh();
        if (previousLayout !== this.state.contextLayout) void this.applyPanelLayout(previousLayout);
        if (previousLayout !== 'separate' && this.state.contextLayout === 'separate') {
          void vscode.commands.executeCommand('dynsight.context.focus', { preserveFocus: true });
        }
      } else if (event.affectsConfiguration('dynsight.callGraphDirection')) {
        this.readPreferences(); this.publish();
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
    this.state.contextLayout = layout === 'separate' || layout === 'combined-full-width' ? layout : 'combined';
    this.state.callGraphDirection = config.get('callGraphDirection') === 'callees-left' ? 'callees-left' : 'callers-left';
    this.state.includeFunctionArguments = config.get('includeFunctionArguments') === true;
    this.state.analyzeCallbacks = config.get('analyzeCallbacks', true);
  }
  private async applyPanelLayout(previousLayout?: ViewState['contextLayout']) {
    try {
      if (this.state.contextLayout === 'combined-full-width') {
        await vscode.commands.executeCommand('workbench.action.positionPanelBottom');
        if (this.state.contextLayout === 'combined-full-width') await vscode.commands.executeCommand('workbench.action.alignPanelJustify');
      } else if (previousLayout === 'combined-full-width') await vscode.commands.executeCommand('workbench.action.alignPanelCenter');
    } catch (error) { void vscode.window.showErrorMessage(`Dynsight: Could not change panel layout: ${String(error)}`); }
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
  track(editor: vscode.TextEditor | undefined, explicit = false) {
    if (!editor || !/\.[ch]$/i.test(editor.document.uri.path)) return false;
    this.lastEditor = editor;
    if (this.state.locked || (this.openingSource && !explicit)) return false;
    this.pendingTrack = false;
    const position = editor.selection.isEmpty ? editor.selection.active : editor.selection.start;
    const word = editor.document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
    if (!word) return false;
    const uri = editor.document.uri.toString(), offset = editor.document.offsetAt(word.start);
    const foundCallback = this.workspace.index.callbackAt(uri, offset);
    const callback = this.state.analyzeCallbacks || foundCallback?.targets.length ? foundCallback : undefined;
    if (callback) {
      if (this.callbackFocus?.uri === uri && this.callbackFocus.offset === offset && this.state.callback) return false;
      this.activity.fire('callback-selection');
      this.callbackFocus = { uri, offset, text: this.workspace.index.files.get(uri)!.text.slice(callback.location.start, callback.location.end) };
      this.root = undefined; this.selection = undefined; this.selectedNodeKey = undefined; this.expanded = {};
      this.state.graph = undefined; this.state.candidates = []; this.refresh(); return true;
    }
    const candidates = this.workspace.index.resolveAt(uri, offset);
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
  refresh() {
    this.state.diagnostics = this.workspace.diagnostics;
    this.state.skipInactive = this.workspace.skipInactive;
    this.state.status = this.workspace.status;
    this.state.fileCount = this.workspace.index.files.size;
    this.state.callbackDiagnostics = [...this.workspace.index.files.values()].flatMap(file => file.callbackDiagnostics ?? []).slice(0, 64);
    this.state.issues = [
      ...[...this.workspace.failures].map(([uri, error]) => `${vscode.workspace.asRelativePath(vscode.Uri.parse(uri))}: ${error}`),
      ...analysisNotices([...this.workspace.index.files.values()], uri => vscode.workspace.asRelativePath(vscode.Uri.parse(uri)))
    ];
    if (this.root) {
      let symbol = this.workspace.index.symbol(this.root.id);
      if (!symbol || symbol.name !== this.root.name) {
        const matches = this.workspace.index.symbols().filter(s => s.name === this.root!.name && s.location.uri === this.root!.uri && s.definition);
        symbol = matches.length === 1 ? matches[0] : undefined;
        if (symbol) { this.root.id = symbol.id; this.expanded = {}; this.selection = symbol.id; }
      }
      this.state.graph = symbol ? this.workspace.index.graph(symbol.id, this.state.mode, this.state.depth, this.expanded, this.state.accessFilter, this.state.calleeSort, this.state.includeFunctionArguments) : undefined;
      if (!symbol) this.state.context = undefined;
    }
    this.locations.clear(); this.nodes.clear();
    if (this.callbackFocus) {
      const focus = this.callbackFocus, callback = this.workspace.index.callbackAt(focus.uri, focus.offset);
      this.state.callback = callback && this.workspace.index.files.get(focus.uri)?.text.slice(callback.location.start, callback.location.end) === focus.text ? callback : undefined;
      if (this.state.callback) {
        this.selection = `callback:${focus.uri}@${this.state.callback.location.start}`;
        this.locations.set(this.selection, { location: this.state.callback.location, label: `Callback · ${this.state.callback.expression}` });
      }
    }
    const visit = (node: GraphNode) => {
      this.nodes.set(node.key, node);
      if (node.symbolId) this.locations.set(node.symbolId, { location: node.location, label: node.name });
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
    this.publish();
  }
  private preview(id: string) {
    const selected = this.locations.get(id);
    const file = selected && this.workspace.index.files.get(selected.location.uri);
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
    const symbol = id ? this.workspace.index.symbol(id) : undefined;
    if (!symbol) return;
    this.state.locked = true;
    this.pendingTrack = false;
    this.selection = symbol.id;
    this.selectedNodeKey = undefined;
    this.setRoot(symbol);
  }
  async handleMessage(message: unknown) {
    if (!message || typeof message !== 'object') return;
    const m = message as Record<string, unknown>;
    if (typeof m.type === 'string' && ['selectNode', 'pinNode', 'navigateContext', 'choose', 'mode', 'depth', 'lock', 'skip', 'refresh', 'expand', 'collapse', 'expandSpecial', 'open'].includes(m.type)) this.activity.fire(m.type);
    switch (m.type) {
      case 'diagnostics': this.workspace.refreshDiagnostics(); break;
      case 'reportIssue': await vscode.commands.executeCommand('dynsight.reportIssue'); break;
      case 'copilotAnalyze': await vscode.commands.executeCommand('dynsight.analyzeCallbacksWithCopilot'); break;
      case 'copilotStop': await vscode.commands.executeCommand('dynsight.stopCopilotAnalysis'); break;
      case 'ready': this.refresh(); this.track(vscode.window.activeTextEditor); break;
      case 'readyContext': void this.contextView?.webview.postMessage({ type: 'context', context: this.state.context }); break;
      case 'settings': await vscode.commands.executeCommand('dynsight.openSettings'); break;
      case 'help': await vscode.commands.executeCommand('dynsight.help'); break;
      case 'preview': if (typeof m.id === 'string' && this.locations.has(m.id)) { this.preview(m.id); this.publish(); } break;
      case 'selectNode': {
        const node = typeof m.key === 'string' ? this.nodes.get(m.key) : undefined;
        if (!node) return;
        this.selectedNodeKey = node.key;
        this.selection = nodePreviewId(node);
        if (canExpandNode(node)) {
          // Preserve a deeper inherited expansion, including explicit ancestor overrides.
          let levels = this.state.depth, path = '';
          for (const part of node.key.split('/')) {
            if (path) levels--;
            path = path ? `${path}/${part}` : part;
            levels = this.expanded[path] ?? levels;
          }
          this.expanded[node.key] = Math.max(levels, this.state.depth);
        }
        this.refresh(); break;
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
          const focus = this.callbackFocus, current = this.workspace.index.callbackAt(focus.uri, focus.offset);
          choices = current && this.workspace.index.files.get(focus.uri)?.text.slice(current.location.start, current.location.end) === focus.text ? current.targets : [];
        }
        const symbol = choices.find(s => s.id === m.id);
        if (symbol) this.setRoot(symbol); else if (this.callbackFocus) this.refresh();
      } break;
      case 'mode': if (m.value === 'references' || m.value === 'callers' || m.value === 'callees' || m.value === 'both') { this.state.mode = m.value; this.expanded = {}; this.refresh(); } break;
      case 'access': if (m.value === 'all' || m.value === 'read' || m.value === 'write' || m.value === 'readwrite' || m.value === 'address') {
        this.state.accessFilter = m.value; this.expanded = {}; this.refresh();
      } break;
      case 'depth': if (Number.isInteger(m.value) && Number(m.value) >= 1 && Number(m.value) <= 8) { this.state.depth = Number(m.value); this.expanded = {}; this.refresh(); } break;
      case 'lock':
        if (this.state.locked) { this.state.locked = false; this.publish(); this.track(this.lastEditor); }
        else this.pinNode(this.selectedNodeKey ?? this.state.graph?.root.key);
        break;
      case 'pinNode': if (typeof m.key === 'string') this.pinNode(m.key); break;
      case 'skip': if (typeof m.value === 'boolean') await vscode.workspace.getConfiguration('dynsight').update('skipInactive', m.value, vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global); break;
      case 'refresh': await this.workspace.reindex('toolbar'); this.track(vscode.window.activeTextEditor); this.refresh(); break;
      case 'expand': case 'collapse': case 'expandSpecial': {
        if (typeof m.key !== 'string' || !this.nodes.has(m.key)) return;
        let levels = m.type === 'collapse' ? 0 : 1;
        if (m.type === 'expandSpecial') {
          const value = await vscode.window.showInputBox({ title: 'Additional levels to expand from the selected node', value: '2', validateInput: v => /^[1-8]$/.test(v) ? undefined : 'Enter a number from 1 to 8.' });
          if (!value || !this.nodes.has(m.key)) return;
          levels = Number(value);
        }
        this.expanded[m.key] = levels; this.refresh(); break;
      }
      case 'open': {
        if (typeof m.id !== 'string') return;
        const target = this.locations.get(m.id);
        if (!target) return;
        this.openingSource = true;
        try {
          const loc = target.location;
          await vscode.window.showTextDocument(vscode.Uri.parse(loc.uri), { viewColumn: this.lastEditor?.viewColumn ?? vscode.ViewColumn.One,
            selection: new vscode.Range(loc.line, loc.column, loc.endLine, loc.endColumn), preview: true });
        } finally { setTimeout(() => { this.openingSource = false; }, 150); }
        break;
      }
    }
  }
  dispose() { this.activity.dispose(); clearTimeout(this.refreshTimer); this.listener.dispose(); this.preferences.dispose(); this.diagnosticsListener.dispose(); }
}
