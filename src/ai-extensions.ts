import * as vscode from 'vscode';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import type { CliProvider } from './cli-callback-provider';

const providers = [
  {value:'copilot' as const,label:'GitHub Copilot',ids:['GitHub.copilot-chat','GitHub.copilot']},
  {value:'claude' as const,label:'Claude Code',ids:['anthropic.claude-code']},
  {value:'codex' as const,label:'Codex',ids:['openai.chatgpt']}
];
export function installedAiExtensions() {
  return providers.filter(provider=>provider.ids.some(id=>vscode.extensions.getExtension(id))).map(({value,label})=>({value,label}));
}
export async function resolveBundledEngine(provider: CliProvider, root: string, platform: NodeJS.Platform=process.platform, arch: string=process.arch) {
  const name=provider+(platform==='win32'?'.exe':'');
  const os={darwin:'macos',linux:'linux',win32:'windows'}[platform as 'darwin'|'linux'|'win32'];
  const cpu={arm64:'aarch64',x64:'x86_64'}[arch as 'arm64'|'x64'];
  const candidates=provider==='codex'
    ? [path.join('bin',`${os}-${cpu}`,name),path.join('bin',`${platform}-${arch}`,name),path.join('bin',name)]
    : [path.join('resources','native-binary',name),path.join('resources','native-binaries',`${platform}-${arch}`,name),path.join('resources','native-binaries',`${os}-${cpu}`,name)];
  if(os&&cpu)for(const relative of candidates) {
    const file=path.join(root,relative);
    try {await access(file,constants.X_OK);return file;} catch { /* Try the other supported extension layout. */ }
  }
  throw new Error(`The ${provider==='claude'?'Claude Code':'Codex'} extension has no compatible bundled engine for this extension host (${platform}/${arch}). Update or reinstall that extension in this VS Code environment.`);
}
export async function bundledAiEngine(provider: CliProvider) {
  const info=providers.find(value=>value.value===provider)!;
  const extension=vscode.extensions.getExtension(info.ids[0]);
  if(!extension)throw new Error(`Install or enable the ${info.label} extension in this VS Code environment, then sign in there. Dynsight uses only the selected extension.`);
  return resolveBundledEngine(provider,extension.extensionPath);
}
