import { runTests } from '@vscode/test-electron';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
const scratch = await mkdtemp(path.join(os.tmpdir(), 'dynsight-freertos-'));
await runTests({
  vscodeExecutablePath: process.env.VSCODE_EXECUTABLE || '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
  extensionDevelopmentPath: path.resolve(process.env.EXTENSION_PATH || '.'),
  extensionTestsPath: path.resolve('dist/freertos.test.cjs'),
  launchArgs: [path.resolve('test-sources/FreeRTOS-Kernel'), '--user-data-dir=' + path.join(scratch, 'profile'), '--extensions-dir=' + path.join(scratch, 'extensions'), '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates'],
  extensionTestsEnv: { DYNSIGHT_TEST_DETAILED: process.env.DYNSIGHT_TEST_DETAILED || 'basic', C_RELATION_TEST_OUTPUT: path.resolve(`test-results/freertos-${process.env.DYNSIGHT_TEST_DETAILED || 'basic'}.json`) }
});
