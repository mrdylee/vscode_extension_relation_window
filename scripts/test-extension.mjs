import { runTests } from '@vscode/test-electron';
import path from 'node:path';
import { mkdtemp, mkdir, cp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { existsSync } from 'node:fs';
const scratch = await mkdtemp(path.join(os.tmpdir(), 'dynsight-host-'));
const workspace = path.join(scratch, 'workspace');
await mkdir(workspace);
await cp('examples/demo', workspace, { recursive: true });
await mkdir(path.join(workspace, '.vscode'), { recursive: true });
await writeFile(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({ 'cRelation.calleeSort': 'source', 'cRelation.include': ['**/*.{c,h}'] }));
// Exceed VS Code's unopened-document cache to catch close/reopen indexing loops.
for (let n = 0; n < 90; n++) await writeFile(path.join(workspace, `index-${n}.h`), `#define INDEX_FIXTURE_${n} ${n}\n`);
await runTests({
  vscodeExecutablePath: process.env.VSCODE_EXECUTABLE || (existsSync('/Applications/Visual Studio Code.app/Contents/MacOS/Code') ? '/Applications/Visual Studio Code.app/Contents/MacOS/Code' : undefined),
  extensionDevelopmentPath: path.resolve(process.env.EXTENSION_PATH || '.'),
  extensionTestsPath: path.resolve('dist/extension.test.cjs'),
  launchArgs: [workspace, '--user-data-dir=' + path.join(scratch, 'profile'), '--extensions-dir=' + path.join(scratch, 'extensions'), '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates'],
  extensionTestsEnv: { C_RELATION_TEST_OUTPUT: path.resolve('test-results/extension.json') }
});
