import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import path from 'node:path';
import { RelationIndex } from '../src/relations';

const require = createRequire(path.resolve('package.json'));
const bundle = buildSync({ entryPoints: ['src/view.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vscode'] }).outputFiles[0].text;
class Emitter {
  private listeners = new Set<(value: any) => void>();
  event = (listener: (value: any) => void) => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; };
  fire(value?: any) { for (const listener of this.listeners) listener(value); }
  dispose() { this.listeners.clear(); }
}
function harness(layout = 'combined') {
  const settings = new Emitter(), config = new Map<string, unknown>([['contextLayout', layout]]);
  const commands: string[] = [], errors: string[] = [];
  let pause: (() => Promise<void>) | undefined;
  const vscode = { EventEmitter: Emitter,
    workspace: { getConfiguration: () => ({ get: (key: string, fallback: unknown) => config.get(key) ?? fallback }), onDidChangeConfiguration: settings.event,
      asRelativePath: (value: unknown) => String(value) }, Uri: { parse: (value: string) => ({ toString: () => value }) },
    commands: { executeCommand: async (name: string) => { commands.push(name); if (name.endsWith('positionPanelBottom')) await pause?.(); } },
    window: { showErrorMessage: (message: string) => { errors.push(message); } } };
  const module = { exports: {} as any };
  runInNewContext(bundle, { module, exports: module.exports, process, Buffer, URL, setTimeout, clearTimeout, require: (name: string) => name === 'vscode' ? vscode : require(name) });
  const index = new RelationIndex();
  const view = new module.exports.RelationView({ index, changed: new Emitter(), diagnosticsChanged: new Emitter(), failures: new Map(), skipInactive: true, status: 'Index ready' }, {});
  const update = (value: string) => { config.set('contextLayout', value); settings.fire({ affectsConfiguration: (key: string) => key === 'dynsight.contextLayout' }); return view.panelLayout; };
  return { view, index, commands, errors, update, pause: (value?: () => Promise<void>) => { pause = value; } };
}

test('status-only refresh preserves the graph while source and graph settings invalidate it', () => {
  const h = harness(), uri = 'file:///graph-refresh.c';
  const location = { uri, start: 5, end: 9, line: 0, column: 5, endLine: 0, endColumn: 9 };
  const symbol = { id: uri + '#5', name: 'root', kind: 'function' as const, definition: true, pointer: false,
    storage: 'global' as const, conditions: [], location, extent: location };
  const file = { uri, text: 'void root(void){}', symbols: [symbol], references: [], includes: [], issues: [] };
  h.index.update(file); h.view.root = { id: symbol.id, name: symbol.name, uri };
  const original = h.index.graph.bind(h.index); let builds = 0;
  h.index.graph = (...args: Parameters<typeof original>) => { builds++; return original(...args); };
  try {
    h.view.refresh(); const first = h.view.state.graph;
    h.view.refresh(); h.view.refresh();
    assert.equal(h.view.state.graph, first);
    assert.equal(builds, 1);
    h.index.update({ ...file, text: 'void root(void){ }' }); h.view.refresh();
    assert.equal(builds, 2);
    h.view.state.depth = 2; h.view.refresh();
    assert.equal(builds, 3);
  } finally { h.view.dispose(); }
});

test('Combined alignments keep the requested sidebar full height and restore center on exit', async () => {
  const h = harness();
  try {
    for (const [layout, alignment] of [['combined-keep-left-sidebar', 'Right'], ['combined-center', 'Center'], ['combined-keep-right-sidebar', 'Left'], ['combined-full-width', 'Justify']]) {
      h.commands.length = 0;
      await h.update(layout);
      assert.equal(h.view.state.contextLayout, layout);
      assert.deepEqual(h.commands, ['workbench.action.positionPanelBottom', `workbench.action.alignPanel${alignment}`]);
    }
    h.commands.length = 0;
    await h.update('separate');
    assert.ok(h.commands.includes('workbench.action.alignPanelCenter'));
    assert.ok(h.commands.includes('dynsight.context.focus'));
    await h.update('combined-keep-left-sidebar'); h.commands.length = 0;
    await h.update('combined');
    assert.deepEqual(h.commands, ['workbench.action.alignPanelCenter']);
    assert.deepEqual(h.errors, []);
  } finally { h.view.dispose(); }
});

test('stored explicit alignment is restored on opening; default Combined leaves user alignment alone', async () => {
  for (const layout of ['combined', 'combined-keep-left-sidebar', 'combined-center', 'combined-keep-right-sidebar']) {
    const h = harness(layout);
    try {
      await h.view.applyPanelLayout();
      assert.equal(h.commands.length, layout === 'combined' ? 0 : 2);
      assert.equal(h.view.state.contextLayout, layout);
    } finally { h.view.dispose(); }
  }
});

test('rapid changes cannot apply an older panel alignment after the final choice', async () => {
  const h = harness();
  let release!: () => void, entered!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  h.pause(async () => { entered(); await pending; });
  try {
    const first = h.update('combined-full-width'); await started;
    const middle = h.update('combined-keep-left-sidebar');
    const last = h.update('combined-keep-right-sidebar');
    h.pause(); release(); await Promise.all([first, middle, last]);
    assert.equal(h.view.state.contextLayout, 'combined-keep-right-sidebar');
    assert.deepEqual(h.commands.filter(command => command.includes('alignPanel')), ['workbench.action.alignPanelLeft']);
    assert.deepEqual(h.errors, []);
  } finally { release(); h.view.dispose(); }
});
