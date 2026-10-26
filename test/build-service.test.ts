import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { buildFixture } from './build-fixtures';

const require = createRequire(process.cwd() + '/package.json');
test('build configuration discovery stays read-only and selection applies only a proven entry', async () => {
  const bundle = buildSync({ entryPoints: ['src/build-service.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vscode', 'web-tree-sitter'] }).outputFiles[0].text;
  const f = buildFixture({ Makefile: 'CC=gcc\na.o: App/a.c\n\t$(CC) -DMODE=1 -c $<' }), commands = new Map<string, Function>(), saved = new Map();
  const disposable = { dispose() {} }, emitter = { event: () => disposable, fire() {} };
  const uri = (value: string) => ({ toString: () => value, path: new URL(value).pathname });
  let applied: any;const previews:string[]=[];
  const workspace = { ready: Promise.resolve(), sourceFiles: new Map([['file:///p/App/a.c', { uri: 'file:///p/App/a.c' }]]), changed: emitter,
    buildPending:false,setBuildProfile: async (profile: unknown) => { if(profile)assert.equal(workspace.buildPending,true,'AI stays pending while a selected configuration is refreshed');workspace.buildPending=false;applied = profile; } };
  const vscode = { FileType: { File: 1, Directory: 2, SymbolicLink: 64 }, Uri: { parse: uri },
    workspace: { workspaceFolders: [{ uri: uri('file:///p'), name: 'p', index: 0 }],
      getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
      onDidChangeConfiguration: () => disposable, onDidChangeWorkspaceFolders: () => disposable,
      createFileSystemWatcher: () => ({ ...disposable, onDidCreate: () => disposable, onDidChange: () => disposable, onDidDelete: () => disposable }),
      fs: { readFile: async (value: ReturnType<typeof uri>) => { const text = f.texts.get(value.toString()); if (text === undefined) throw Object.assign(new Error('missing'), { code: 'FileNotFound' }); return Buffer.from(text); },
        readDirectory: async (value: ReturnType<typeof uri>) => (await f.fs.list(value.toString())).map(e => [decodeURIComponent(e.uri.split('/').pop()!), e.kind === 'file' ? 1 : 2]) },
      openTextDocument: async (options:{content:string}) => {previews.push(options.content);return{};} },
    window: { showQuickPick: async (choices: any[]) => choices.find(choice => choice.entry), showTextDocument: async () => {}, showErrorMessage: async () => {} },
    commands: { registerCommand: (name: string, handler: Function) => { commands.set(name, handler); return disposable; } } };
  const module = { exports: {} as any };
  runInNewContext(bundle, { module, exports: module.exports, Buffer, URL, process, performance, __dirname: process.cwd() + '/src', setTimeout, clearTimeout, require: Object.assign((name: string) => name === 'vscode' ? vscode : require(name), { resolve: require.resolve }) });
  const context = { subscriptions: [], workspaceState: { get: (key: string) => saved.get(key), update: async (key: string, value: unknown) => saved.set(key, value) } };
  const service = module.exports.registerBuildConfigurations(context, workspace);
  try {
    await service.ready; assert.equal(applied, undefined); assert.equal(saved.size, 0);
    await commands.get('dynsight.selectBuildConfiguration')!();
    assert.equal((applied as any).units[0].sourceUri, 'file:///p/App/a.c');
    assert.equal((applied as any).units[0].macroActions[0].replacement, '1');
    assert.equal(saved.size, 1);
    const reads = f.reads.length; await service.refresh(); assert.equal(f.reads.length, reads);
    const previousPreviews=previews.length;vscode.workspace.workspaceFolders=[];
    await commands.get('dynsight.refreshBuildConfiguration')!();
    assert.equal(applied,undefined);assert.equal(previews.length,previousPreviews,'an unavailable selection does not preview the old build');
  } finally { service.dispose(); }
});
