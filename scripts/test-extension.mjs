import { runTests } from '@vscode/test-electron';
import path from 'node:path';
import { mkdtemp, mkdir, cp, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { existsSync } from 'node:fs';
const scratch = await mkdtemp(path.join(os.tmpdir(), 'dynsight-host-'));
const workspace = path.join(scratch, 'workspace');
const extensions = path.join(scratch, 'extensions');
const settings = { 'cRelation.calleeSort': 'source', 'cRelation.include': ['**/*.{c,h}'] };
if(process.env.DYNSIGHT_CODEX_ENGINE) {
  const stub=path.join(extensions,'openai.chatgpt-0.0.1');
  const platform={darwin:'macos',linux:'linux',win32:'windows'}[process.platform],arch={arm64:'aarch64',x64:'x86_64'}[process.arch];
  const engine=path.join(stub,'bin',`${platform}-${arch}`,'codex'+(process.platform==='win32'?'.exe':''));
  await mkdir(path.dirname(engine),{recursive:true});
  await writeFile(path.join(stub,'package.json'),JSON.stringify({name:'chatgpt',publisher:'openai',version:'0.0.1',engines:{vscode:'^1.95.0'},extensionKind:['workspace'],main:'./empty.cjs',activationEvents:[]}));
  await writeFile(path.join(stub,'empty.cjs'),'exports.activate=()=>({});');
  await symlink(process.env.DYNSIGHT_CODEX_ENGINE,engine);
  settings['dynsight.smartAnalysis.provider']='codex';
}
await mkdir(workspace);
await cp('examples/demo', workspace, { recursive: true });
await mkdir(path.join(workspace, '.vscode'), { recursive: true });
await writeFile(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify(settings));
// Exceed VS Code's unopened-document cache to catch close/reopen indexing loops.
for (let n = 0; n < 90; n++) await writeFile(path.join(workspace, `index-${n}.h`), `#define INDEX_FIXTURE_${n} ${n}\n`);
await runTests({
  vscodeExecutablePath: process.env.VSCODE_EXECUTABLE || (existsSync('/Applications/Visual Studio Code.app/Contents/MacOS/Code') ? '/Applications/Visual Studio Code.app/Contents/MacOS/Code' : undefined),
  extensionDevelopmentPath: path.resolve(process.env.EXTENSION_PATH || '.'),
  extensionTestsPath: path.resolve('dist/extension.test.cjs'),
  launchArgs: [workspace, '--user-data-dir=' + path.join(scratch, 'profile'), '--extensions-dir=' + extensions, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates'],
  extensionTestsEnv: { C_RELATION_TEST_OUTPUT: path.resolve('test-results/extension.json'), DYNSIGHT_AI_SETUP_TEST: process.env.DYNSIGHT_CODEX_ENGINE?'1':'' }
});
