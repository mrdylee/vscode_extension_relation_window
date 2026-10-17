import { runTests } from '@vscode/test-electron';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const scratch = await mkdtemp(path.join(os.tmpdir(), 'c-relation-large-'));
const workspace = path.join(scratch, 'workspace');
await mkdir(path.join(workspace, 'Tools', 'Polyspace'), { recursive: true });
await mkdir(path.join(workspace, '.vscode'));
await writeFile(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({ 'cRelation.exclude': ['**/Tools/Polyspace/**'] }));
await writeFile(path.join(workspace, 'target.c'), 'void target(void){}\nvoid other(void){}\n');
// Excluded files alone exceed the initial index limit. Filtering must happen first.
for (let start = 0; start < 10050; start += 100) await Promise.all(Array.from({ length: Math.min(100, 10050 - start) }, (_, i) =>
  writeFile(path.join(workspace, 'Tools', 'Polyspace', `tool-${start + i}.h`), '#define UNUSED 1\n')));
for (let start = 0; start < 2500; start += 100) await Promise.all(Array.from({ length: 100 }, (_, i) =>
  writeFile(path.join(workspace, `caller-${start + i}.c`), `void target(void); static void caller(void){${'target();'.repeat(20)}}\n`)));
await runTests({
  vscodeExecutablePath: process.env.VSCODE_EXECUTABLE || (existsSync('/Applications/Visual Studio Code.app/Contents/MacOS/Code') ? '/Applications/Visual Studio Code.app/Contents/MacOS/Code' : undefined),
  extensionDevelopmentPath: path.resolve('.'), extensionTestsPath: path.resolve('dist/large-workspace.test.cjs'),
  launchArgs: [workspace, '--user-data-dir=' + path.join(scratch, 'profile'), '--extensions-dir=' + path.join(scratch, 'extensions'), '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates'],
  extensionTestsEnv: { C_RELATION_TEST_OUTPUT: path.resolve('test-results/large-workspace.json') }
});
