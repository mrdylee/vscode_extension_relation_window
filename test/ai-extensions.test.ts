import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require=createRequire(path.resolve('package.json'));
const bundle=buildSync({entryPoints:['src/ai-extensions.ts'],bundle:true,write:false,platform:'node',format:'cjs',external:['vscode']}).outputFiles[0].text;
test('AI is the only visible AI setting and links the complete guided setup',async()=>{
  const manifest=JSON.parse(await readFile('package.json','utf8')),properties=manifest.contributes.configuration.properties;
  const visible=['dynsight.smartAnalysis.ai','dynsight.smartAnalysis.provider','dynsight.copilotModel'].filter(key=>properties[key]?.included!==false);
  assert.deepEqual(visible,['dynsight.smartAnalysis.ai']);
  assert.match(properties['dynsight.smartAnalysis.ai'].markdownDescription,/command:dynsight.configureAi/);
});
function load(installed:Record<string,unknown>={}) {
  const module={exports:{} as any};
  runInNewContext(bundle,{module,exports:module.exports,process,require:(name:string)=>name==='vscode'?{extensions:{getExtension:(id:string)=>installed[id]}}:require(name)});
  return module.exports;
}
test('installed choices enumerate extensions without activating them',()=>{
  const api=load(Object.fromEntries(['GitHub.copilot-chat','anthropic.claude-code','openai.chatgpt'].map(id=>[id,{activate(){throw new Error('must not activate');}}])));
  assert.equal(JSON.stringify(api.installedAiExtensions().map((item:any)=>item.value)),JSON.stringify(['copilot','claude','codex']));
});
for(const [provider,platform,arch,relative] of [
  ['codex','darwin','arm64','bin/macos-aarch64/codex'],
  ['codex','linux','x64','bin/linux-x86_64/codex'],
  ['codex','win32','x64','bin/windows-x86_64/codex.exe'],
  ['claude','darwin','arm64','resources/native-binary/claude'],
  ['claude','linux','arm64','resources/native-binaries/linux-arm64/claude'],
  ['claude','win32','x64','resources/native-binary/claude.exe']
] as const)test(`${provider} resolves its ${platform}/${arch} bundled engine`,async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'dynsight-extension-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const binary=path.join(root,relative);await mkdir(path.dirname(binary),{recursive:true});await writeFile(binary,'fixture');await chmod(binary,0o755);
  assert.equal(await load().resolveBundledEngine(provider,root,platform,arch),binary);
});
test('missing or foreign-platform engines never fall back to PATH',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'dynsight-extension-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const binary=path.join(root,'bin/windows-x86_64/codex.exe');await mkdir(path.dirname(binary),{recursive:true});await writeFile(binary,'fixture');
  await assert.rejects(load().resolveBundledEngine('codex',root,'linux','x64'),/extension|host/i);
  await assert.rejects(load().bundledAiEngine('codex'),/install|enable/i);
});
