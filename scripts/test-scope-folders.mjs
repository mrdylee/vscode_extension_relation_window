import { runTests } from '@vscode/test-electron';
import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = await mkdtemp(path.join(os.tmpdir(), 'dynsight-scope-host-'));
try {
  const roots = ['first', 'second'].map(name => path.join(scratch, name));
  for (const root of roots) {
    await mkdir(path.join(root, '.vscode'), { recursive: true });
    await mkdir(path.join(root, 'App'));
    await writeFile(path.join(root, 'App', 'main.c'), 'void scope_test(void) {}');
    await writeFile(path.join(root, '.vscode', 'settings.json'), JSON.stringify({ 'dynsight.include': ['App/**'], 'dynsight.exclude': ['Generated/**'] }));
  }
  const profile = path.join(scratch, 'profile');
  await mkdir(path.join(profile, 'User'), { recursive: true });
  // JSON editor exposes the exact settings resource through activeTextEditor.
  await writeFile(path.join(profile, 'User', 'settings.json'), JSON.stringify({ 'workbench.settings.editor': 'json' }));
  const workspace = path.join(scratch, 'scope.code-workspace');
  await writeFile(workspace, JSON.stringify({ folders: roots.map(root => ({ path: root })) }));
  const tests = path.join(scratch, 'scope.test.cjs');
  await build({ entryPoints: ['test/scope-folders-host.test.ts'], outfile: tests, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'] });
  await runTests({
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE || (existsSync('/Applications/Visual Studio Code.app/Contents/MacOS/Code') ? '/Applications/Visual Studio Code.app/Contents/MacOS/Code' : undefined),
    extensionDevelopmentPath: path.resolve('.'), extensionTestsPath: tests,
    launchArgs: [workspace, '--user-data-dir=' + profile, '--extensions-dir=' + path.join(scratch, 'extensions'), '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates']
  });
} finally { await rm(scratch, { recursive: true, force: true }); }
