import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

class Uri {
  constructor(readonly scheme: string, readonly path: string) {}
  static from(value: { scheme: string; path: string }) { return new Uri(value.scheme, value.path); }
  static joinPath(base: Uri, name: string) { return new Uri(base.scheme, base.path + '/' + name); }
  toString() { return this.scheme + ':' + this.path; }
}
function fixture(mode = 'disabled') {
  assert.ok(existsSync('src/markdown-preview.ts'), 'Markdown preview adapter is implemented');
  const calls: { kind: string; value: string; argument?: string }[] = [];
  const commands = new Map<string, (...args: any[]) => any>();
  const providers = new Map<string, any>();
  const listeners: ((event: any) => unknown)[] = [];
  let choice: string | undefined;
  let extension: { activate(): Promise<unknown> } | undefined;
  let previewFails = false;
  const vscode = {
    Uri,
    workspace: {
      getConfiguration: () => ({ get: (_key: string, fallback: string) => mode ?? fallback }),
      registerTextDocumentContentProvider(scheme: string, provider: any) { providers.set(scheme, provider); return { dispose() {} }; },
      onDidChangeConfiguration(listener: (event: any) => unknown) { listeners.push(listener); return { dispose() {} }; },
      fs: { readFile: async (uri: Uri) => { calls.push({ kind: 'read', value: uri.path }); return Buffer.from('# Dynsight ' + uri.path); } },
      openTextDocument: async (uri: Uri) => ({ uri, getText: () => providers.get(uri.scheme).provideTextDocumentContent(uri) })
    },
    extensions: { getExtension: (id: string) => { assert.equal(id, 'shd101wyy.markdown-preview-enhanced'); return extension; } },
    window: {
      showTextDocument: async (document: any) => { calls.push({ kind: 'text', value: document.uri.toString() }); return document; },
      showInformationMessage: async (message: string) => { calls.push({ kind: 'notice', value: message }); return choice; },
      showWarningMessage: async (message: string) => { calls.push({ kind: 'warning', value: message }); return undefined; },
      showErrorMessage: async (message: string) => { calls.push({ kind: 'error', value: message }); return undefined; }
    },
    commands: {
      registerCommand(id: string, run: (...args: any[]) => any) { commands.set(id, run); return { dispose() {} }; },
      executeCommand: async (id: string, argument: any) => {
        calls.push({ kind: 'command', value: id, argument: String(argument) });
        if (previewFails && id === 'markdown-preview-enhanced.openPreview') throw Error('Preview unavailable');
      }
    }
  };
  const code = transformSync(readFileSync('src/markdown-preview.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  const module = { exports: {} as any };
  runInNewContext(code, { module, exports: module.exports, Buffer, require: (name: string) => { assert.equal(name, 'vscode'); return vscode; } });
  const open = module.exports.registerMarkdownPreview({ subscriptions: [], extensionUri: new Uri('file', '/extension') });
  return {
    open, calls, providers, commands,
    choose(value?: string) { choice = value; },
    install(activate: () => Promise<unknown> = async () => { calls.push({ kind: 'activate', value: 'enhanced' }); }) { extension = { activate }; },
    failPreview() { previewFails = true; },
    async change(value: string, relevant = true) { mode = value; await Promise.all(listeners.map(listener => listener({ affectsConfiguration: () => relevant }))); },
    setMode(value: string) { mode = value; }
  };
}

test('one native dropdown defaults off and provides explicit extension-management links', () => {
  const properties = JSON.parse(readFileSync('package.json', 'utf8')).contributes.configuration.properties;
  const setting = properties['dynsight.markdownPreview'];
  assert.ok(setting, 'Markdown Preview setting exists');
  assert.equal(setting.default, 'disabled');
  assert.deepEqual(setting.enum, ['disabled', 'enhanced']);
  assert.match(setting.markdownDescription, /command:dynsight.manageBuiltinMarkdown/);
  assert.match(setting.markdownDescription, /command:dynsight.manageMarkdownPreviewEnhanced/);
  assert.match(setting.markdownDescription, /does not disable/i);
});

test('default Help reads only bundled localized guides without preview activation or installation', async () => {
  const f = fixture();
  assert.equal(f.calls.length, 0, 'registration is quiet');
  f.install();
  for (const [language, filename] of [['en', 'USER_GUIDE'], ['ko-KR', 'USER_GUIDE.ko'], ['fr', 'USER_GUIDE']]) {
    const document = await f.open(language);
    assert.equal(document.uri.scheme, 'dynsight-guide');
    assert.equal(document.uri.path, '/' + filename + '.txt');
    assert.match(await document.getText(), new RegExp(filename + '\\.md'));
  }
  assert.ok(f.calls.every(call => call.kind === 'read' || call.kind === 'text'));
});

test('read-only guide provider refuses arbitrary paths', async () => {
  const f = fixture();
  await assert.rejects(async () => f.providers.get('dynsight-guide').provideTextDocumentContent(new Uri('dynsight-guide', '/other.txt')));
  assert.equal(f.calls.length, 0);
});

test('Enhanced selection focuses the matching guide before invoking its preview command', async () => {
  const f = fixture('enhanced'); f.install();
  await f.open('ko');
  assert.deepEqual(f.calls, [
    { kind: 'activate', value: 'enhanced' },
    { kind: 'text', value: 'dynsight-guide:/USER_GUIDE.ko.txt' },
    { kind: 'command', value: 'markdown-preview-enhanced.openPreview', argument: 'file:/extension/USER_GUIDE.ko.md' }
  ]);
});

test('missing or disabled Enhanced leaves a readable text guide on cancellation', async () => {
  const f = fixture('enhanced'); await f.open('en');
  assert.ok(f.calls.some(call => call.kind === 'text'));
  assert.ok(f.calls.some(call => call.kind === 'notice'));
  assert.ok(!f.calls.some(call => call.kind === 'command'));
});

test('missing Enhanced opens only its native install/enable page when selected', async () => {
  const f = fixture('enhanced'); f.choose('Open Extension'); await f.open('en');
  assert.deepEqual(f.calls.filter(call => call.kind === 'command'), [
    { kind: 'command', value: 'workbench.extensions.search', argument: '@id:shd101wyy.markdown-preview-enhanced' }
  ]);
});

test('activation and preview failures retain text Help without a builtin fallback', async () => {
  for (const failure of ['activation', 'preview']) {
    const f = fixture('enhanced');
    f.install(failure === 'activation' ? async () => { throw Error('Unavailable'); } : undefined);
    if (failure === 'preview') f.failPreview();
    await f.open('en');
    assert.ok(f.calls.some(call => call.kind === 'text'));
    assert.ok(f.calls.some(call => call.kind === 'warning'));
    assert.ok(!f.calls.some(call => /^(markdown\.|workbench\.extensions\.install)/.test(call.value)));
  }
});

test('switching off while Enhanced activates prevents a late preview', async () => {
  const f = fixture('enhanced'); let ready!: () => void;
  f.install(() => new Promise<void>(resolve => { ready = resolve; }));
  const opening = f.open('en');
  f.setMode('disabled'); ready(); await opening;
  assert.ok(f.calls.some(call => call.kind === 'text'));
  assert.ok(!f.calls.some(call => call.kind === 'command'));
});

test('selecting missing Enhanced offers its page without installing or opening a guide', async () => {
  const f = fixture(); f.choose('Open Extension');
  await f.change('enhanced');
  assert.ok(f.calls.some(call => call.argument === '@id:shd101wyy.markdown-preview-enhanced'));
  assert.ok(!f.calls.some(call => call.kind === 'text' || /installExtension/.test(call.value)));
  f.calls.length = 0;
  await f.change('enhanced', false); await f.change('disabled');
  assert.equal(f.calls.length, 0);
});

test('native management commands guide workspace disable without changing any extension state', async () => {
  const f = fixture();
  await f.commands.get('dynsight.manageBuiltinMarkdown')!();
  assert.deepEqual(f.calls.filter(call => call.kind === 'command'), [
    { kind: 'command', value: 'workbench.extensions.search', argument: '@builtin @id:vscode.markdown-language-features' }
  ]);
  assert.ok(f.calls.some(call => /Disable \(Workspace\)/.test(call.value)));
  assert.ok(f.calls.some(call => /Markdown Language Basics/.test(call.value)));
  f.calls.length = 0;
  await f.commands.get('dynsight.manageMarkdownPreviewEnhanced')!();
  assert.deepEqual(f.calls, [{ kind: 'command', value: 'workbench.extensions.search', argument: '@id:shd101wyy.markdown-preview-enhanced' }]);
});
