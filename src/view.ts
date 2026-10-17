import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { WorkspaceIndex } from './workspace';
import { GraphNode, Location, SymbolRecord } from './model';
import { ViewState } from './view-state';
import { highlightC, SyntaxToken } from './syntax';

export class RelationView implements vscode.WebviewViewProvider, vscode.Disposable {
  state: ViewState = { candidates: [], status: 'Open a C file and click a symbol name.', fileCount: 0,
    issues: [], mode: 'references', accessFilter: 'all', depth: 1, locked: false, skipInactive: true };
  private webview?: vscode.WebviewView;
  private root?: { id: string; name: string; uri: string };
  private expanded: Record<string, number> = {};
  private locations = new Map<string, { location: Location; label: string }>();
  private nodes = new Map<string, GraphNode>();
  private selection?: string;
  private listener: vscode.Disposable;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private openingSource = false;
  private lastEditor?: vscode.TextEditor;
  private syntaxCache?: { text: string; tokens: SyntaxToken[][] };
  constructor(private workspace: WorkspaceIndex, private extensionUri: vscode.Uri) {
    this.listener = workspace.changed.event(() => {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => this.refresh(), 70);
    });
  }
  resolveWebviewView(view: vscode.WebviewView) {
    this.webview = view;
    const assets = vscode.Uri.joinPath(this.extensionUri, 'dist');
    view.webview.options = { enableScripts: true, localResourceRoots: [assets] };
    const css = view.webview.asWebviewUri(vscode.Uri.joinPath(assets, 'webview.css'));
    const js = view.webview.asWebviewUri(vscode.Uri.joinPath(assets, 'webview.js'));
    const nonce = randomBytes(18).toString('hex');
    view.webview.html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <link rel="stylesheet" href="${css}"><title>C Relations</title></head><body><div id="app"></div><script nonce="${nonce}" src="${js}"></script></body></html>`;
    view.webview.onDidReceiveMessage(message => { void this.handleMessage(message).catch(error => vscode.window.showErrorMessage(`C Relations: ${String(error)}`)); });
    view.onDidDispose(() => { this.webview = undefined; });
    this.refresh();
  }
  track(editor: vscode.TextEditor | undefined) {
    if (!editor || this.state.locked || this.openingSource || !/\.[ch]$/i.test(editor.document.uri.path)) return;
    this.lastEditor = editor;
    const candidates = this.workspace.index.resolveAt(editor.document.uri.toString(), editor.document.offsetAt(editor.selection.active));
    if (!candidates.length) return;
    if (candidates.length > 1) {
      this.root = undefined; this.selection = undefined; this.expanded = {};
      this.state.graph = undefined; this.state.context = undefined;
      this.state.candidates = candidates; this.refresh(); return;
    }
    this.setRoot(candidates[0]);
  }
  private setRoot(symbol: SymbolRecord) {
    if (symbol.id !== this.root?.id) { this.expanded = {}; this.selection = symbol.id; }
    this.root = { id: symbol.id, name: symbol.name, uri: symbol.location.uri };
    this.state.candidates = []; this.refresh();
  }
  refresh() {
    this.state.skipInactive = this.workspace.skipInactive;
    this.state.status = this.workspace.status;
    this.state.fileCount = this.workspace.index.files.size;
    this.state.issues = [
      ...[...this.workspace.failures].map(([uri, error]) => `${vscode.workspace.asRelativePath(vscode.Uri.parse(uri))}: ${error}`),
      ...[...this.workspace.index.files.values()].flatMap(f => f.issues.map(issue => `${vscode.workspace.asRelativePath(vscode.Uri.parse(f.uri))}: ${issue}`))
    ];
    if (this.root) {
      let symbol = this.workspace.index.symbol(this.root.id);
      if (!symbol || symbol.name !== this.root.name) {
        const matches = this.workspace.index.symbols().filter(s => s.name === this.root!.name && s.location.uri === this.root!.uri && s.definition);
        symbol = matches.length === 1 ? matches[0] : undefined;
        if (symbol) { this.root.id = symbol.id; this.expanded = {}; this.selection = symbol.id; }
      }
      this.state.graph = symbol ? this.workspace.index.graph(symbol.id, this.state.mode, this.state.depth, this.expanded, this.state.accessFilter) : undefined;
      if (!symbol) this.state.context = undefined;
    }
    this.locations.clear(); this.nodes.clear();
    const visit = (node: GraphNode) => {
      this.nodes.set(node.key, node);
      if (node.symbolId) this.locations.set(node.symbolId, { location: node.location, label: node.name });
      for (const site of node.sites) this.locations.set(site.id, { location: site.location, label: `${site.name} · ${site.kind}` });
      node.children.forEach(visit);
    };
    if (this.state.graph) visit(this.state.graph.root);
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
  private publish() { void this.webview?.webview.postMessage({ type: 'state', state: this.state }); }
  async handleMessage(message: unknown) {
    if (!message || typeof message !== 'object') return;
    const m = message as Record<string, unknown>;
    switch (m.type) {
      case 'ready': this.refresh(); this.track(vscode.window.activeTextEditor); break;
      case 'preview': if (typeof m.id === 'string' && this.locations.has(m.id)) { this.preview(m.id); this.publish(); } break;
      case 'choose': if (typeof m.id === 'string') { const symbol = this.state.candidates.find(s => s.id === m.id); if (symbol) this.setRoot(symbol); } break;
      case 'mode': if (m.value === 'references' || m.value === 'callers') { this.state.mode = m.value; this.expanded = {}; this.refresh(); } break;
      case 'access': if (m.value === 'all' || m.value === 'read' || m.value === 'write' || m.value === 'readwrite' || m.value === 'address') {
        this.state.accessFilter = m.value; this.expanded = {}; this.refresh();
      } break;
      case 'depth': if (Number.isInteger(m.value) && Number(m.value) >= 1 && Number(m.value) <= 8) { this.state.depth = Number(m.value); this.expanded = {}; this.refresh(); } break;
      case 'lock': this.state.locked = !this.state.locked; this.publish(); if (!this.state.locked) this.track(this.lastEditor); break;
      case 'skip': if (typeof m.value === 'boolean') await vscode.workspace.getConfiguration('cRelation').update('skipInactive', m.value, vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global); break;
      case 'refresh': await this.workspace.reindex(); this.track(vscode.window.activeTextEditor); this.refresh(); break;
      case 'expand': case 'collapse': case 'expandSpecial': {
        if (typeof m.key !== 'string' || !this.nodes.has(m.key)) return;
        let levels = m.type === 'collapse' ? 0 : 1;
        if (m.type === 'expandSpecial') {
          const value = await vscode.window.showInputBox({ title: '선택한 노드에서 추가로 펼칠 단계', value: '2', validateInput: v => /^[1-8]$/.test(v) ? undefined : '1~8 사이의 숫자를 입력하세요.' });
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
  dispose() { clearTimeout(this.refreshTimer); this.listener.dispose(); }
}
