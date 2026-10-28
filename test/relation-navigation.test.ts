import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import path from 'node:path';
import { createAnalyzer } from '../src/analyzer';
import { RelationIndex } from '../src/relations';

const require = createRequire(path.resolve('package.json'));
const bundle = buildSync({ entryPoints: ['src/view.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vscode'] }).outputFiles[0].text;
let analyzer: Awaited<ReturnType<typeof createAnalyzer>>;
before(async () => { analyzer = await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'), path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm')); });
class Emitter {
  listeners = new Set<(value: any) => void>();
  event = (listener: (value: any) => void) => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; };
  fire(value?: any) { for (const listener of this.listeners) listener(value); }
  dispose() { this.listeners.clear(); }
}
const uri = 'file:///navigation.c';
const source = 'int value; void D(void){} void C(void){D();} void B(void){C();} void SideLeaf(void){} void Side(void){SideLeaf();} void A(void){B();Side();value++;} void Entry(void){A();} void Top(void){Entry();}';
function harness(saved = new Map<string, unknown>()) {
  const changed = new Emitter(), settings = new Emitter(), diagnosticsChanged = new Emitter();
  const index = new RelationIndex(); index.update(analyzer.analyze(uri, source));
  const opened: any[] = [], messages: any[] = [], notices: string[] = [];
  const config = new Map<string, unknown>(); let writing: (() => Promise<void>) | undefined, notifying: (() => Promise<void>) | undefined, input: string | undefined;
  const storage = { get: (key: string) => saved.get(key), update: async (key: string, value: unknown) => {
    await writing?.(); saved.set(key, JSON.parse(JSON.stringify(value)));
  } };
  const vscode = { EventEmitter: Emitter,
    Range: class { constructor(public start: number, public column: number, public end: number, public endColumn: number) {} },
    ViewColumn: { One: 1 }, Uri: { parse: (value: string) => ({ toString: () => value, path: value }) },
    workspace: { getConfiguration: () => ({ get: (key: string, fallback: unknown) => config.get(key) ?? fallback }),
      onDidChangeConfiguration: settings.event, asRelativePath: (value: unknown) => String(value) },
    window: { showTextDocument: async (document: any, options: any) => { opened.push({ uri: document.toString(), options }); },
      showWarningMessage: async (message: string) => { notices.push(message); await notifying?.(); }, showInformationMessage: async (message: string) => { notices.push(message); await notifying?.(); },
      showInputBox: async () => input }, commands: { executeCommand: async () => {} } };
  const module = { exports: {} as any };
  runInNewContext(bundle, { module, exports: module.exports, process, Buffer, URL, setTimeout, clearTimeout,
    require: (name: string) => name === 'vscode' ? vscode : require(name) });
  const workspace = { index, indexFor: () => index, changed, diagnosticsChanged, failures: new Map(), skipInactive: true,
    analyzeCallbacks: true, status: 'Index ready', buildMembership: () => 'included', buildProfile: undefined as any };
  const view = new module.exports.RelationView(workspace, {}, undefined, storage);
  view.webview = { webview: { postMessage: async (message: any) => { messages.push(message); } } };
  view.state.mode = 'callees';
  const root = (name = 'A') => view.setRoot(index.symbols().find(s => s.name === name && s.definition));
  root();
  const node = (name: string, direction?: string) => [...view.nodes.values()].find((n: any) => n.name === name && (!direction || n.direction === direction)) as any;
  const update = (text: string) => { index.update(analyzer.analyze(uri, text)); view.refresh(); };
  return { view, workspace, index, root, node, opened, notices, messages, saved, update,
    writing: (action?: () => Promise<void>) => { writing = action; }, notifying: (action?: () => Promise<void>) => { notifying = action; }, input: (value?: string) => { input = value; },
    preference: (key: string, value: unknown) => { config.set(key, value); settings.fire({ affectsConfiguration: (name: string) => name === 'dynsight.' + key }); } };
}
const graph = (view: any) => JSON.stringify(view.state.graph);

test('unavailable-slot notification does not block recalling the next slot', async () => {
  const h = harness(); let release: (() => void) | undefined;
  try {
    await h.view.handleMessage({ type: 'saveSlot', slot: 0, key: 'root' }); h.root('B');
    await h.view.handleMessage({ type: 'saveSlot', slot: 1, key: 'root' });
    h.update(source.replace('void A(', 'void Z(')); h.root('D');
    h.notifying(() => new Promise<void>(resolve => { release = resolve; }));
    void h.view.handleMessage({ type: 'recallSlot', slot: 0 });
    let completed = false;
    void h.view.handleMessage({ type: 'recallSlot', slot: 1 }).then(() => { completed = true; });
    await new Promise(setImmediate);
    assert.equal(completed, true); assert.equal(h.view.state.graph.root.name, 'B');
  } finally { release?.(); h.view.dispose(); }
});

test('stale context-menu identity and changed source cannot save a different symbol', async () => {
  const h = harness();
  try {
    const symbolId = h.view.state.graph.root.symbolId;
    h.root('B'); await h.view.handleMessage({ type: 'saveSlot', slot: 0, key: 'root', symbolId });
    assert.equal(h.view.state.slots[0].name, undefined);
    h.root(); h.index.update(analyzer.analyze(uri, source.replace('void A(', 'void Z(')));
    await h.view.handleMessage({ type: 'saveSlot', slot: 0, key: 'root' });
    assert.equal(h.view.state.slots[0].name, undefined);
  } finally { h.view.dispose(); }
});

test('queued save keeps the exact right-clicked symbol when an earlier recall changes the root', async () => {
  const h = harness();
  try {
    await h.view.handleMessage({ type: 'saveSlot', slot: 0, key: 'root' }); h.root('B');
    let release!: () => void; h.writing(() => new Promise<void>(resolve => { release = resolve; }));
    const locking = h.view.handleMessage({ type: 'lockSlot', slot: 0, locked: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    const recalling = h.view.handleMessage({ type: 'recallSlot', slot: 0 });
    const saving = h.view.handleMessage({ type: 'saveSlot', slot: 1, key: 'root' });
    h.writing(); release(); await Promise.all([locking, recalling, saving]);
    assert.equal(h.view.state.slots[1].name, 'B');
  } finally { h.view.dispose(); }
});
test('header slots distinguish including sources and refuse a missing saved context', async () => {
  const h = harness(), header = 'file:///shared.h';
  try {
    h.workspace.buildProfile = { units: [{ id: 'u1', sourceUri: 'file:///one.c' }, { id: 'u2', sourceUri: 'file:///two.c' }] };
    for (const unit of ['u1', 'u2']) {
      const file = analyzer.analyze(header, 'static void shared(void){}');
      file.context = { profileId: 'p', unitId: unit, key: unit, prepared: {} as any };
      file.symbols.forEach(symbol => { symbol.id += ':' + unit; symbol.location.context = unit; symbol.extent.context = unit; });
      h.index.update(file);
    }
    const first = h.index.symbols().find(s => s.name === 'shared' && s.location.context === 'u1')!;
    const second = h.index.symbols().find(s => s.name === 'shared' && s.location.context === 'u2')!;
    h.view.state.locked = true; h.view.setRoot(first);
    await h.view.handleMessage({ type: 'saveSlot', slot: 0, key: 'root' });
    h.view.setRoot(second); await h.view.handleMessage({ type: 'recallSlot', slot: 0 });
    assert.equal(h.view.state.graph.root.location.context, 'u1');
    h.index.remove('u1'); h.view.setRoot(second);
    await h.view.handleMessage({ type: 'recallSlot', slot: 0 });
    assert.equal(h.view.state.graph.root.location.context, 'u2'); assert.match(h.notices.at(-1)!, /unavailable/);
  } finally { h.view.dispose(); }
});
test('missing saved branches restore the root with a partial message', async () => {
  const h = harness();
  try {
    await h.view.handleMessage({ type: 'selectNode', key: h.node('B').key });
    await h.view.handleMessage({ type: 'saveSlot', slot: 0, key: 'root' });
    h.update(source.replace('B();Side();', 'Side();'));
    await h.view.handleMessage({ type: 'recallSlot', slot: 0 });
    assert.equal(h.view.state.graph.root.name, 'A'); assert.ok(h.node('Side'));
    assert.match(h.notices.at(-1)!, /some saved branches/);
  } finally { h.view.dispose(); }
});
test('Back is bounded, handles both directions, and ignores leaves and cancelled Levels', async () => {
  const h = harness();
  try {
    await h.view.handleMessage({ type: 'expandSpecial', key: h.node('B').key }); assert.equal(h.view.state.canGoBack, false);
    await h.view.handleMessage({ type: 'mode', value: 'both' });
    const initial = graph(h.view);
    await h.view.handleMessage({ type: 'selectNode', key: h.node('Entry', 'callers').key });
    assert.ok(h.node('Top', 'callers'));
    await h.view.handleMessage({ type: 'back' }); assert.equal(graph(h.view), initial);
    await h.view.handleMessage({ type: 'selectNode', key: h.node('B', 'callees').key });
    await h.view.handleMessage({ type: 'selectNode', key: h.node('C', 'callees').key });
    await h.view.handleMessage({ type: 'selectNode', key: h.node('D', 'callees').key });
    await h.view.handleMessage({ type: 'back' }); await h.view.handleMessage({ type: 'back' });
    assert.equal(graph(h.view), initial); assert.equal(h.view.state.canGoBack, false);
    h.update(Array.from({ length: 105 }, (_, n) => `void F${n}(void){${n < 104 ? `F${n+1}();` : ''}}`).join('\n'));
    h.root('F0'); h.view.state.mode = 'callees'; h.view.refresh();
    for (let n = 1; n < 104; n++) await h.view.handleMessage({ type: 'selectNode', key: h.node(`F${n}`).key });
    for (let n = 0; n < 100; n++) await h.view.handleMessage({ type: 'back' });
    assert.equal(h.view.state.canGoBack, false); assert.ok(h.node('F4')); assert.equal(h.node('F5'), undefined);
  } finally { h.view.dispose(); }
});

test('right-click target, five slots, locks, recall and reload preserve saved trees', async () => {
  const h = harness();
  try {
    assert.equal(h.view.state.slots.length, 5);
    await h.view.handleMessage({ type: 'selectNode', key: h.node('B').key });
    await h.view.handleMessage({ type: 'selectNode', key: h.node('C').key });
    const original = graph(h.view), rootKey = h.view.state.graph.root.key;
    await h.view.handleMessage({ type: 'saveSlot', slot: 0, key: rootKey });
    assert.equal(graph(h.view), original);
    await h.view.handleMessage({ type: 'saveSlot', slot: 1, key: h.node('B').key });
    assert.equal(h.view.state.slots[1].name, 'B');
    await h.view.handleMessage({ type: 'lockSlot', slot: 1, locked: true });
    await h.view.handleMessage({ type: 'saveSlot', slot: 1, key: rootKey });
    await h.view.handleMessage({ type: 'clearSlot', slot: 1 });
    assert.equal(h.view.state.slots[1].name, 'B');
    h.root('D'); await h.view.handleMessage({ type: 'recallSlot', slot: 0 });
    assert.equal(graph(h.view), original); assert.equal(h.view.state.locked, true);
    assert.equal(h.opened.at(-1).uri, uri); assert.equal(h.view.state.context.location.start, h.index.symbols().find(s => s.name === 'A')!.location.start);
    await h.view.handleMessage({ type: 'recallSlot', slot: 1 });
    assert.equal(h.view.state.graph.root.name, 'B'); assert.ok(h.node('D'), 'descendant expansions are rebased');
    const loaded = harness(h.saved);
    try { assert.equal(loaded.view.state.slots[1].locked, true); await loaded.view.handleMessage({ type: 'recallSlot', slot: 1 }); assert.ok(loaded.node('D')); }
    finally { loaded.view.dispose(); }
    await h.view.handleMessage({ type: 'lockSlot', slot: 1, locked: false });
    await h.view.handleMessage({ type: 'clearSlot', slot: 1 }); assert.equal(h.view.state.slots[1].name, undefined);
  } finally { h.view.dispose(); }
});
test('variable filters and both directions survive recall without writing settings', async () => {
  const h = harness();
  try {
    h.root('value'); h.view.state.accessFilter = 'write'; h.view.refresh();
    await h.view.handleMessage({ type: 'saveSlot', slot: 4, key: 'root' });
    h.root(); await h.view.handleMessage({ type: 'mode', value: 'both' });
    await h.view.handleMessage({ type: 'selectNode', key: h.node('B', 'callees').key });
    await h.view.handleMessage({ type: 'selectNode', key: h.node('Entry', 'callers').key });
    const original = graph(h.view);
    await h.view.handleMessage({ type: 'saveSlot', slot: 2, key: 'root' });
    await h.view.handleMessage({ type: 'recallSlot', slot: 4 });
    assert.equal(h.view.state.accessFilter, 'write'); assert.equal(h.view.state.graph.root.name, 'value');
    await h.view.handleMessage({ type: 'recallSlot', slot: 2 }); assert.equal(graph(h.view), original);
  } finally { h.view.dispose(); }
});
test('moved symbols and branches resolve to current source, missing targets keep current view', async () => {
  const h = harness();
  try {
    await h.view.handleMessage({ type: 'selectNode', key: h.node('B').key });
    await h.view.handleMessage({ type: 'saveSlot', slot: 0, key: 'root' });
    h.update('\n\n' + source); h.root('D');
    await h.view.handleMessage({ type: 'recallSlot', slot: 0 });
    assert.equal(h.view.state.graph.root.name, 'A'); assert.ok(h.node('C'));
    assert.equal(h.view.state.context.location.line, 2);
    h.update('void D(void){}'); h.root('D'); const original = graph(h.view);
    await h.view.handleMessage({ type: 'recallSlot', slot: 0 });
    assert.equal(graph(h.view), original); assert.match(h.notices.at(-1)!, /unavailable/i);
  } finally { h.view.dispose(); }
});
test('slot writes are ordered, failures keep saved state and later writes recover', async () => {
  const h = harness();
  try {
    let release!: () => void; h.writing(() => new Promise<void>(resolve => { release = resolve; }));
    const first = h.view.handleMessage({ type: 'saveSlot', slot: 0, key: 'root' });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(h.view.state.slots[0].name, undefined);
    const locked = h.view.handleMessage({ type: 'lockSlot', slot: 0, locked: true });
    h.writing(); release(); await Promise.all([first, locked]);
    assert.equal(h.view.state.slots[0].locked, true);
    h.writing(async () => { throw new Error('disk denied'); });
    await assert.rejects(h.view.handleMessage({ type: 'lockSlot', slot: 0, locked: false }), /disk denied/);
    assert.equal(h.view.state.slots[0].locked, true);
    h.writing(); await h.view.handleMessage({ type: 'lockSlot', slot: 0, locked: false });
    assert.equal(h.view.state.slots[0].locked, false);
    for (const slot of [-1, 5, '0', 1.5]) await h.view.handleMessage({ type: 'clearSlot', slot });
    assert.equal(h.view.state.slots[0].name, 'A');
  } finally { h.view.dispose(); }
});

test('Back reverses expansions one at a time and preserves unrelated branches and selection', async () => {
  const h = harness();
  try {
    await h.view.handleMessage({ type: 'selectNode', key: h.node('Side').key });
    const original = graph(h.view), selection = h.view.selection;
    await h.view.handleMessage({ type: 'selectNode', key: h.node('B').key }); const afterB = graph(h.view);
    await h.view.handleMessage({ type: 'selectNode', key: h.node('C').key });
    assert.ok(h.node('D')); assert.equal(h.view.state.canGoBack, true);
    await h.view.handleMessage({ type: 'back' }); assert.equal(graph(h.view), afterB);
    await h.view.handleMessage({ type: 'back' }); assert.equal(graph(h.view), original); assert.equal(h.view.selection, selection);
    assert.ok(h.node('SideLeaf')); assert.equal(h.opened.length, 0);
    await h.view.handleMessage({ type: 'back' }); assert.equal(h.view.state.canGoBack, false);
  } finally { h.view.dispose(); }
});
test('no-op clicks, previews and diagnostics do not consume history; changes and collapse reset it', async () => {
  const h = harness();
  try {
    await h.view.handleMessage({ type: 'selectNode', key: h.node('B').key }); const expanded = graph(h.view);
    await h.view.handleMessage({ type: 'selectNode', key: h.node('B').key });
    await h.view.handleMessage({ type: 'preview', id: h.node('B').symbolId }); h.view.refresh();
    await h.view.handleMessage({ type: 'back' }); assert.notEqual(graph(h.view), expanded); assert.equal(h.view.state.canGoBack, false);
    for (const change of [() => h.root('D'), () => h.view.handleMessage({ type: 'depth', value: 2 }),
      () => h.update('\n' + source), () => h.preference('callGraphDirection', 'callees-left'),
      () => h.view.handleMessage({ type: 'collapse', key: h.node('B').key })]) {
      h.root(); h.view.state.depth = 1; h.view.expanded = {}; h.view.refresh();
      await h.view.handleMessage({ type: 'selectNode', key: h.node('B').key }); assert.equal(h.view.state.canGoBack, true);
      await change(); assert.equal(h.view.state.canGoBack, false);
    }
  } finally { h.view.dispose(); }
});
