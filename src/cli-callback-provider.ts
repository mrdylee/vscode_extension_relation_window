import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CopilotProvider } from './copilot-callbacks';

export type CliProvider = 'claude' | 'codex';
interface Options { provider: CliProvider; executable: string; model: string; timeoutMs?: number }
export interface AiModelChoice { id: string; label: string; description?: string }
type Protocol = (message: any, send: (message: unknown) => void, done: () => void) => void;
const labels = {claude:'Claude Code', codex:'Codex'};
const maxOutput = 1024 * 1024;
async function run(options: Options, args: string[], input: string, signal: AbortSignal, protocol?: Protocol) {
  if (signal.aborted) throw new Error('AI request cancelled');
  const executable = /\.[cm]?js$/i.test(options.executable)
    ? {file:process.execPath,prefix:[options.executable]} : {file:options.executable,prefix:[]};
  const cwd = await mkdtemp(path.join(tmpdir(),'dynsight-ai-'));
  const env: NodeJS.ProcessEnv = {...process.env, ELECTRON_RUN_AS_NODE:'1'};
  // Use the CLI's login; inherited API keys must not silently change billing.
  for (const key of ['OPENAI_API_KEY','CODEX_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','NODE_OPTIONS','CLAUDECODE']) delete env[key];
  try {
    return await new Promise<string>((resolve,reject) => {
      if (signal.aborted) { reject(new Error('AI request cancelled')); return; }
      const child = spawn(executable.file,[...executable.prefix,...args],{cwd,env,shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});
      let output = '', stderr = '', pending = '', bytes = 0, complete = false, failure: Error | undefined;
      const terminate = () => {
        if (!child.pid) return;
        if (process.platform === 'win32') {
          const killer=spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
          killer.on('error',()=>child.kill());
        } else try { process.kill(-child.pid,'SIGKILL'); } catch { child.kill('SIGKILL'); }
      };
      const fail = (message: string) => { if(failure)return;failure = new Error(message); terminate(); };
      const abort = () => fail('AI request cancelled');
      signal.addEventListener('abort',abort,{once:true});
      const timer=setTimeout(()=>fail(`${labels[options.provider]} request timed out`),options.timeoutMs ?? 60_000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data',(chunk:string)=>{
        bytes+=Buffer.byteLength(chunk);if(bytes>maxOutput){fail('AI response too large');return;}output+=chunk;
        if(!protocol||complete||failure)return;
        pending+=chunk;
        let end: number;
        while(!complete&&!failure&&(end=pending.indexOf('\n'))>=0) {
          const line=pending.slice(0,end).trim();pending=pending.slice(end+1);if(!line)continue;
          try {protocol(JSON.parse(line),message=>child.stdin.write(JSON.stringify(message)+'\n'),()=>{complete=true;terminate();});}
          catch {fail('The extension could not provide its model catalog.');}
        }
      });
      child.stderr.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>maxOutput)fail('AI output limit exceeded');else if(stderr.length<16*1024)stderr+=chunk.toString('utf8');});
      child.on('error',()=>{failure ??= new Error(`${labels[options.provider]} bundled engine could not start. Update or reinstall its VS Code extension in this environment.`);});
      child.stdin.on('error',()=>{ /* The exit status reports early CLI failures. */ });
      child.once('close',code=>{
        clearTimeout(timer);signal.removeEventListener('abort',abort);
        if (failure) reject(failure);
        else if(complete)resolve(output);
        else if(code!==0)reject(new Error(/unknown (?:option|argument)|unexpected argument|unrecognized option/i.test(stderr)
          ? `Update the ${labels[options.provider]} VS Code extension: its bundled engine does not support Smart Analysis options.`
          : `${labels[options.provider]} analysis failed. Open its VS Code extension, check the selected model and account limits, and sign in there. No other provider was used.`));
        else if(protocol)reject(new Error('The extension returned no model catalog.'));
        else resolve(output);
      });
      if(protocol)child.stdin.write(input);else child.stdin.end(input);
      if(signal.aborted)abort();
    });
  } finally { await rm(cwd,{recursive:true,force:true}); }
}
export async function listCliModels(options: Options, signal: AbortSignal): Promise<AiModelChoice[]> {
  const models: AiModelChoice[]=[],seen=new Set<string>();
  const add=(rows:unknown)=>{
    if(!Array.isArray(rows))throw new Error('Invalid model catalog');
    for(const value of rows) {
      const id=options.provider==='claude'?value?.value:value?.model ?? value?.id;
      if(typeof id!=='string'||!id||value.hidden||seen.has(id))continue;
      seen.add(id);models.push({id,label:typeof value.displayName==='string'?value.displayName:id,
        description:typeof value.description==='string'?value.description.slice(0,500):undefined});
    }
  };
  if(options.provider==='claude') {
    const args=['--print','--input-format','stream-json','--output-format','stream-json','--verbose','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--setting-sources','','--settings','{"disableAllHooks":true}','--no-session-persistence','--disable-slash-commands'];
    const input=JSON.stringify({type:'control_request',request_id:'dynsight-models',request:{subtype:'initialize',hooks:{}}})+'\n';
    await run({...options,timeoutMs:options.timeoutMs??15_000},args,input,signal,(message,_send,done)=>{
      if(message.type!=='control_response'||message.response?.request_id!=='dynsight-models')return;
      if(message.response.subtype!=='success')throw new Error('Model catalog unavailable');
      add(message.response.response?.models);done();
    });
  } else {
    let id=2;const cursors=new Set<string>();
    const input=JSON.stringify({method:'initialize',id:1,params:{clientInfo:{name:'dynsight',title:'Dynsight',version:'1'}}})+'\n';
    await run({...options,timeoutMs:options.timeoutMs??15_000},['app-server','--listen','stdio://','-c','features.apps=false','-c','features.hooks=false'],input,signal,(message,send,done)=>{
      if(message.id!==1&&message.id!==id)return;
      if(message.error)throw new Error('Model catalog unavailable');
      if(message.id===1){send({method:'initialized',params:{}});send({method:'model/list',id,params:{limit:100,includeHidden:false}});return;}
      add(message.result?.data);const cursor=message.result.nextCursor;
      if(typeof cursor==='string'&&cursor){
        if(cursors.has(cursor)||cursors.size>=8)throw new Error('Model catalog page limit');
        cursors.add(cursor);send({method:'model/list',id:++id,params:{cursor,limit:100,includeHidden:false}});
      }else done();
    });
  }
  return models;
}
export async function createCliCallbackProvider(options: Options): Promise<CopilotProvider> {
  const version=(await run({...options,timeoutMs:5000},['--version'],'',new AbortController().signal)).trim();
  const args = options.provider==='claude'
    ? ['--print','--output-format','json','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--setting-sources','','--settings','{"disableAllHooks":true}','--no-session-persistence','--disable-slash-commands']
    : ['exec','--json','--ephemeral','--ignore-user-config','--skip-git-repo-check','--sandbox','read-only','-c','approval_policy="never"','-c','features.shell_tool=false','-c','features.unified_exec=false','-c','features.multi_agent=false','-c','features.apps=false','-c','features.js_repl=false','-c','features.hooks=false','-c','web_search="disabled"'];
  if(options.model)args.push('--model',options.model);
  if(options.provider==='codex')args.push('-');
  return {
    modelKey:JSON.stringify([options.provider,options.executable,version,options.model || 'default']),
    async complete(prompt,signal) {
      if(Buffer.byteLength(prompt)>64*1024)throw new Error('AI context size limit exceeded');
      const text=await run(options,args,prompt,signal);
      try {
        if(options.provider==='claude') {
          const result=JSON.parse(text);
          if(result.is_error)throw new Error('CLI login or request failed');
          if(result.type==='result'&&typeof result.result==='string')return result.result;
        } else {
          let answer: string | undefined, completed=false;
          for(const line of text.split(/\r?\n/).filter(value=>value.trim())) {
            const event=JSON.parse(line);
            if(event.type==='error'||event.type==='turn.failed')throw new Error('CLI login or request failed');
            if(event.type==='item.completed'&&event.item?.type==='agent_message')answer=event.item.text;
            if(event.type==='turn.completed')completed=true;
          }
          if(completed&&typeof answer==='string')return answer;
        }
      } catch { throw new Error(`${labels[options.provider]} returned an invalid response or login/request failure. Check sign-in and update its VS Code extension.`); }
      throw new Error(`${labels[options.provider]} returned no final AI response. Check sign-in and update its VS Code extension.`);
    }
  };
}
