import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

const code = transformSync(readFileSync('src/branding-migration.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
function fixture() {
  const values = new Map<string, unknown>(), calls: string[] = [];
  let legacy = false, choice: string | undefined, failWrite = false, failUninstall = false;
  const slot = (prefix: string, key: string, target: number, uri?: string) => `${prefix}.${key}:${target}:${target === 3 ? uri : ''}`;
  const vscode = {
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    extensions: { getExtension: () => legacy ? {} : undefined },
    commands: { async executeCommand(command: string, id?: string) {
      calls.push(command + (id ? ':' + id : ''));
      if (failUninstall && command.includes('uninstall')) throw Error('uninstall failed');
    } },
    window: { async showWarningMessage() { calls.push('prompt'); return choice; }, async showErrorMessage() { calls.push('error'); } },
    workspace: { workspaceFile: undefined as string | undefined, workspaceFolders: [{ uri: 'one' }, { uri: 'two' }],
      getConfiguration(prefix: string, uri?: string) { return {
        inspect(key: string) { return { globalValue: values.get(slot(prefix, key, 1)), workspaceValue: values.get(slot(prefix, key, 2)), workspaceFolderValue: values.get(slot(prefix, key, 3, uri)) }; },
        async update(key: string, value: unknown, target: number) {
          if (failWrite && prefix === 'dynsight') throw Error('settings read-only');
          const k = slot(prefix, key, target, uri);
          if (value === undefined) values.delete(k); else values.set(k, value);
        }
      }; }
    }
  };
  const module = { exports: {} as any };
  runInNewContext(code, { module, exports: module.exports, require: () => vscode });
  return { values, calls, run: module.exports, workspace: vscode.workspace,
    set(prefix: string, key: string, target: number, value: unknown, uri?: string) { values.set(slot(prefix, key, target, uri), value); },
    get(prefix: string, key: string, target: number, uri?: string) { return values.get(slot(prefix, key, target, uri)); },
    legacy(value: boolean) { legacy = value; }, choose(value?: string) { choice = value; },
    failWrite() { failWrite = true; }, failUninstall() { failUninstall = true; }
  };
}
const properties = { 'dynsight.include': { scope: 'resource' }, 'dynsight.calleeSort': { scope: 'window' }, 'dynsight.automaticUpdates': { scope: 'application' } };

test('move legacy settings at every scope without changing precedence', async () => {
  const f = fixture();
  f.set('cRelation', 'include', 1, ['Global/**']); f.set('cRelation', 'include', 2, ['Workspace/**']);
  f.set('cRelation', 'include', 3, ['One/**'], 'one'); f.set('cRelation', 'include', 3, [], 'two');
  f.set('cRelation', 'automaticUpdates', 1, false);
  await f.run.migrateSettings(properties);
  assert.deepEqual(f.get('dynsight', 'include', 1), ['Global/**']);
  assert.deepEqual(f.get('dynsight', 'include', 2), ['Workspace/**']);
  assert.deepEqual(f.get('dynsight', 'include', 3, 'one'), ['One/**']);
  assert.deepEqual(f.get('dynsight', 'include', 3, 'two'), []);
  assert.equal(f.get('dynsight', 'automaticUpdates', 1), false);
  assert.equal([...f.values.keys()].some(k => k.startsWith('cRelation.')), false);
  await f.run.migrateSettings(properties);
  assert.equal(f.get('dynsight', 'automaticUpdates', 1), false);
});
test('existing new values win and removed settings do not resurrect', async () => {
  const f = fixture(); f.set('cRelation', 'calleeSort', 2, 'source'); f.set('dynsight', 'calleeSort', 2, 'name');
  await f.run.migrateSettings(properties);
  assert.equal(f.get('dynsight', 'calleeSort', 2), 'name');
  assert.equal(f.get('cRelation', 'calleeSort', 2), undefined);
  f.values.delete('dynsight.calleeSort:2:'); await f.run.migrateSettings(properties);
  assert.equal(f.get('dynsight', 'calleeSort', 2), undefined);
});
test('empty saved workspaces still migrate workspace preferences', async () => {
  const f = fixture(); f.workspace.workspaceFolders = []; f.workspace.workspaceFile = 'empty.code-workspace';
  f.set('cRelation', 'calleeSort', 2, 'source');
  await f.run.migrateSettings(properties);
  assert.equal(f.get('dynsight', 'calleeSort', 2), 'source');
  assert.equal(f.get('cRelation', 'calleeSort', 2), undefined);
});
test('failed settings writes leave legacy values intact', async () => {
  const f = fixture(); f.set('cRelation', 'include', 1, ['Keep/**']); f.failWrite();
  await assert.rejects(f.run.migrateSettings(properties), /read-only/);
  assert.deepEqual(f.get('cRelation', 'include', 1), ['Keep/**']);
});
test('hidden legacy analysis values remain readable in place without unsupported configuration writes', async () => {
  const f=fixture();f.set('cRelation','analyzeCallbacks',2,false);f.failWrite();
  await f.run.migrateSettings({'dynsight.analyzeCallbacks':{scope:'window',included:false}});
  assert.equal(f.get('cRelation','analyzeCallbacks',2),false);
  assert.equal(f.get('dynsight','analyzeCallbacks',2),undefined);
});
test('new installs proceed; legacy installs pause until explicitly removed', async () => {
  const f = fixture(); assert.equal(await f.run.prepareUpgrade(), true); assert.equal(f.calls.length, 0);
  f.legacy(true); assert.equal(await f.run.prepareUpgrade(), false); assert.deepEqual(f.calls, ['prompt']);
  f.choose('Remove previous extension and reload'); await f.run.prepareUpgrade();
  assert.deepEqual(f.calls.slice(-2), ['workbench.extensions.uninstallExtension:local-james-black.c-relation-explorer', 'workbench.action.reloadWindow']);
});
test('failed legacy removal reports an error without reload or duplicate startup', async () => {
  const f = fixture(); f.legacy(true); f.choose('Remove previous extension and reload'); f.failUninstall();
  assert.equal(await f.run.prepareUpgrade(), false); assert.ok(f.calls.includes('error'));
  assert.equal(f.calls.includes('workbench.action.reloadWindow'), false);
});
