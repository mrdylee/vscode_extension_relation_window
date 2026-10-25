import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { Minimatch } from 'minimatch';

const require = createRequire(import.meta.url);
const code = buildSync({ entryPoints: ['src/scope-folders.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vscode'] }).outputFiles[0].text;
const defaults = JSON.parse(readFileSync('package.json')).contributes.configuration.properties['dynsight.exclude'].default;
const uri = path => ({ path, toString: () => `file://${path}` });
function fixture(values = {}, picks = [], dialogs = [], options = {}) {
  const roots = (options.roots ?? ['/project']).map(path => ({ uri: uri(path), name: path.slice(1) }));
  const writes = [], screens = [], messages = [], commands = new Map(), navigation = [];
  const config = {
    get: (key, fallback) => values[key] ?? (key === 'exclude' ? defaults : fallback),
    inspect: key => ({ defaultValue: key === 'exclude' ? defaults : [], workspaceFolderValue: options.folderValue ? values[key] : undefined }),
    update: async (key, value, target) => { if (options.failWrite) throw new Error('Settings file is read-only'); writes.push({ key, value: Array.from(value), target }); }
  };
  const vscode = {
    FileType: { Directory: 2 },
    ConfigurationTarget: { Workspace: 2, WorkspaceFolder: 3 },
    workspace: { workspaceFolders: roots, getConfiguration: () => {
      if (!options.snapshotConfiguration) return config;
      const snapshot = { ...values };
      return { ...config, get: (key, fallback) => snapshot[key] ?? (key === 'exclude' ? defaults : fallback) };
    }, fs: { stat: async () => ({ type: options.fileSelection ? 1 : 2 }) },
      getWorkspaceFolder: value => roots.find(root => value.path === root.uri.path || value.path.startsWith(root.uri.path + '/')),
      asRelativePath: value => value.path.slice(roots.find(root => value.path.startsWith(root.uri.path)).uri.path.length + 1) },
    window: {
      showWorkspaceFolderPick: async () => roots[0],
      showQuickPick: async (items, opts) => { screens.push({ items, opts }); const pick = picks.shift(); return typeof pick === 'function' ? pick(items) : items.find(item => item.action === pick); },
      showOpenDialog: async () => dialogs.shift(),
      showInformationMessage: async message => messages.push(message),
      showErrorMessage: async message => messages.push(message)
    },
    commands: { executeCommand: async (...args) => navigation.push(args), registerCommand: (id, run) => { commands.set(id, run); return { dispose() {} }; } }
  };
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, process, require: name => name === 'vscode' ? vscode : require(name) });
  return { run: module.exports, writes, screens, messages, roots, commands, navigation };
}
test('cancelling after adding folders never writes settings', async () => {
  const f = fixture({}, ['add', undefined], [[uri('/project/App'), uri('/project/Drivers')]]);
  await f.run.selectScopeFolders('include'); assert.equal(f.writes.length, 0);
});
test('multiple nested folders are staged and saved once, retaining custom globs', async () => {
  const f = fixture({ include: ['Core/**/*.{c,h}'] }, ['add', 'apply'], [[uri('/project/App/nested'), uri('/project/Drivers')]]);
  await f.run.selectScopeFolders('include');
  assert.deepEqual(f.writes, [{ key: 'include', value: ['Core/**/*.{c,h}', 'App/nested/**', 'Drivers/**'], target: 2 }]);
});
test('Explorer Include narrows all-files mode only after Apply and explains matching Exclude', async () => {
  const f = fixture({}, ['apply']);
  await f.run.addScopeFolders('include', uri('/project/mock_driver'), [uri('/project/mock_driver'), uri('/project/App')]);
  assert.deepEqual(f.writes[0].value, ['mock_driver/**', 'App/**']);
  assert.match(f.screens[0].opts.placeHolder, /selected folders/i);
  assert.ok(f.screens[0].items.some(item => /\*\*\/mock\*\/\*\*/.test(item.detail ?? '')));
});
test('Exclude additions retain default rules and escape literal folder names', async () => {
  const f = fixture({}, ['add', 'apply'], [[uri('/project/build[old]')]]);
  await f.run.selectScopeFolders('exclude');
  const pattern = f.writes[0].value.at(-1);
  assert.deepEqual(f.writes[0].value.slice(0, -1), defaults);
  assert.ok(new Minimatch(pattern).match('build[old]/nested/file.c'));
  assert.equal(new Minimatch(pattern).match('buildo/file.c'), false);
});
test('rules can be individually removed and an empty Exclude is explicitly saved', async () => {
  const f = fixture({ exclude: ['Custom/**'] }, [items => items.find(item => item.pattern === 'Custom/**'), 'apply']);
  await f.run.selectScopeFolders('exclude'); assert.deepEqual(f.writes[0].value, []);
});
test('Include has explicit all-files mode', async () => {
  const f = fixture({ include: ['App/**'] }, ['all', 'apply']);
  await f.run.selectScopeFolders('include'); assert.deepEqual(f.writes[0].value, []);
});
test('multi-root settings and existing folder settings save at folder scope', async () => {
  for (const options of [{ roots: ['/project', '/other'] }, { folderValue: true }]) {
    const f = fixture({ include: ['Core/**'] }, ['add', 'apply'], [[uri('/project/App')]], options);
    await f.run.selectScopeFolders('include'); assert.equal(f.writes[0].target, 3);
  }
});
test('outside-workspace selection is rejected without saving', async () => {
  const f = fixture({}, ['add', undefined], [[uri('/outside/App')]]);
  await f.run.selectScopeFolders('include'); assert.equal(f.writes.length, 0); assert.equal(f.messages.length, 1);
});
test('Explorer cancellation and mixed file selection never change settings', async () => {
  for (const options of [{}, { fileSelection: true }]) {
    const f = fixture({}, [undefined], [], options);
    await f.run.addScopeFolders('exclude', uri('/project/App'));
    assert.equal(f.writes.length, 0);
  }
});
test('choosing the root restores bounded default C/H discovery', async () => {
  const f = fixture({ include: ['App/**'] }, ['add', 'apply'], [[uri('/project/App'), uri('/project')]]);
  await f.run.selectScopeFolders('include'); assert.deepEqual(f.writes[0].value, []);
});
test('default Exclude rules can be restored after custom rules', async () => {
  const f = fixture({ exclude: ['Custom/**'] }, ['defaults', 'apply']);
  await f.run.selectScopeFolders('exclude'); assert.deepEqual(f.writes[0].value, defaults);
});
test('concurrent configuration changes are not overwritten', async () => {
  const values = { include: ['Old/**'] };
  const f = fixture(values, ['add', items => { values.include = ['Elsewhere/**']; return items.find(item => item.action === 'apply'); }], [[uri('/project/App')]], { snapshotConfiguration: true });
  await f.run.selectScopeFolders('include'); assert.equal(f.writes.length, 0); assert.match(f.messages[0], /changed while/);
});
test('broad custom Include globs remain visible as all-files mode', async () => {
  const f = fixture({ include: ['**'] }, ['add', 'apply'], [[uri('/project/App')]]);
  await f.run.selectScopeFolders('include');
  assert.deepEqual(f.writes[0].value, ['**', 'App/**']);
  assert.match(f.screens.at(-1).opts.title, /All C\/H files/);
});
test('Explorer folders from multiple roots share one review and save per root', async () => {
  const f = fixture({}, ['apply'], [], { roots: ['/project', '/other'] });
  await f.run.addScopeFolders('include', uri('/project/App'), [uri('/project/App'), uri('/other/Drivers')]);
  assert.equal(f.screens.length, 1);
  assert.deepEqual(f.writes, [{ key: 'include', value: ['App/**'], target: 3 }, { key: 'include', value: ['Drivers/**'], target: 3 }]);
});
test('commas and braces in selected folder names are literal glob characters', async () => {
  const f = fixture({ exclude: [] }, ['add', 'apply'], [[uri('/project/App,Main'), uri('/project/App{old}')]]);
  await f.run.selectScopeFolders('exclude');
  for (const [index, folder] of ['App,Main', 'App{old}'].entries()) assert.ok(new Minimatch(f.writes[0].value[index]).match(`${folder}/file.c`));
});
test('default exclusion reasons also appear for literal special-character folders', async () => {
  const f = fixture({}, ['apply']);
  await f.run.addScopeFolders('include', uri('/project/mock[old]'));
  assert.ok(f.screens[0].items.some(item => /\*\*\/mock\*\/\*\*/.test(item.detail ?? '')));
});
test('registered folder commands report configuration write failures', async () => {
  const f = fixture({}, ['add', 'apply'], [[uri('/project/App')]], { failWrite: true });
  f.run.registerScopeFolders({ subscriptions: [] });
  await f.commands.get('dynsight.selectIncludeFolders')();
  assert.equal(f.writes.length, 0); assert.match(f.messages[0], /Could not save analysis include:.*read-only/);
});
test('Explorer root Include selection dominates child selections in either order', async () => {
  for (const paths of [['/project', '/project/App'], ['/project/App', '/project']]) {
    const f = fixture({ include: ['Old/**'] }, ['apply']);
    await f.run.addScopeFolders('include', uri(paths[0]), paths.map(uri));
    assert.deepEqual(f.writes[0].value, []);
  }
});
test('root Exclude still excludes all files and duplicate child folders are deduplicated', async () => {
  const f = fixture({ exclude: [] }, ['add', 'apply'], [[uri('/project'), uri('/project')]]);
  await f.run.selectScopeFolders('exclude'); assert.deepEqual(f.writes[0].value, ['**']);
  const g = fixture({ include: ['App/**'] }, ['add', 'apply'], [[uri('/project/App'), uri('/project/Drivers'), uri('/project/Drivers')]]);
  await g.run.selectScopeFolders('include'); assert.deepEqual(g.writes[0].value, ['App/**', 'Drivers/**']);
});
test('folder-level settings navigation preserves the selected root', async () => {
  for (const options of [{ roots: ['/project', '/other'] }, { folderValue: true }]) {
    const f = fixture({ include: ['App/**'], exclude: ['App/**'] }, ['exclusions'], [], options);
    await f.run.selectScopeFolders('include');
    assert.equal(f.navigation[0][0], '_workbench.action.openFolderSettings');
    assert.equal(f.navigation[0][1].toString(), 'file:///project');
    assert.equal(f.writes.length, 0);
  }
});
test('multi-root review offers settings editing for each root', async () => {
  const f = fixture({}, [items => items.find(item => item.action === 'settings' && item.edit?.folder.name === 'other')], [], { roots: ['/project', '/other'] });
  await f.run.addScopeFolders('include', uri('/project/App'), [uri('/project/App'), uri('/other/Drivers')]);
  assert.equal(f.navigation[0]?.[1]?.toString(), 'file:///other');
});
test('single-root workspace-level settings retain the filtered Settings entry point', async () => {
  const f = fixture({}, ['settings']); await f.run.selectScopeFolders('exclude');
  assert.equal(f.navigation[0][0], 'workbench.action.openWorkspaceSettings');
  assert.equal(f.navigation[0][1].query, '@id:dynsight.exclude');
});
test('immutable exclusions do not suggest an ineffective Exclude edit', async () => {
  for (const folder of ['node_modules', '.git', '.vscode-test']) {
    const f = fixture({}, [undefined]); await f.run.addScopeFolders('include', uri('/project/' + folder));
    const detail = f.screens[0].items.find(item => item.pattern)?.detail;
    assert.match(detail, /Always excluded/); assert.match(detail, /cannot be overridden/);
    assert.doesNotMatch(detail, /Edit Exclude to include/);
  }
});
test('configurable exclusions retain actionable Exclude editing advice', async () => {
  const f = fixture({}, [undefined]); await f.run.addScopeFolders('include', uri('/project/mock_driver'));
  const detail = f.screens[0].items.find(item => item.pattern)?.detail;
  assert.match(detail, /Edit Exclude to include/); assert.doesNotMatch(detail, /Always excluded/);
});
test('root Include selection keeps actual discovery C/H-only and bounded', async () => {
  const f = fixture({ include: ['App/**'] }, ['add', 'apply'], [[uri('/project')]]);
  await f.run.selectScopeFolders('include');
  const queries = [], module = { exports: {} };
  const vscode = { workspace: { workspaceFolders: f.roots, findFiles: async (pattern, exclude, limit) => {
    queries.push({ pattern: pattern.pattern, limit }); return [];
  } }, RelativePattern: class { constructor(base, pattern) { this.pattern = pattern; } } };
  const workspaceCode = buildSync({ entryPoints: ['src/workspace.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vscode'] }).outputFiles[0].text;
  runInNewContext(workspaceCode, { module, exports: module.exports, process, Buffer, URL, setTimeout, clearTimeout, require: name => name === 'vscode' ? vscode : require(name) });
  await module.exports.WorkspaceIndex.prototype.discover.call({ scope: () => ({ include: f.writes[0].value, exclude: [] }), eligible: () => true });
  assert.deepEqual(queries, [{ pattern: '**/*.{c,h}', limit: 10001 }]);
});
