import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCliCallbackProvider } from '../src/cli-callback-provider';

const reply = '{"status":"not-found","candidates":[]}';
async function fixture(t: { after(fn: () => Promise<void>): void }, body: string) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dynsight-cli-test-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  const executable = path.join(dir, 'fake cli.cjs');
  await writeFile(executable, `if(process.argv.includes('--version')){console.log('fixture 1');process.exit(0);}
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',value=>input+=value);process.stdin.on('end',()=>{${body}});`);
  return {dir, executable};
}
for (const provider of ['claude', 'codex'] as const) test(`${provider} receives source on stdin and returns only its final response`, async t => {
  const record = path.join(await mkdtemp(path.join(tmpdir(), 'dynsight-cli-record-')), 'record.json');
  t.after(() => rm(path.dirname(record), {recursive:true, force:true}));
  const f = await fixture(t, `require('node:fs').writeFileSync(${JSON.stringify(record)},JSON.stringify({args:process.argv.slice(2),input,cwd:process.cwd()}));
console.log(${JSON.stringify(provider === 'claude' ? JSON.stringify({type:'result',is_error:false,result:reply}) : [JSON.stringify({type:'thread.started',thread_id:'test'}),JSON.stringify({type:'item.completed',item:{type:'agent_message',text:reply}}),JSON.stringify({type:'turn.completed'})].join('\n'))});`);
  const model = 'model; $(touch unsafe)';
  const api = await createCliCallbackProvider({provider, executable:f.executable, model});
  assert.equal(await api.complete('source; `private`\nhello',new AbortController().signal), reply);
  const recordValue = JSON.parse(await readFile(record,'utf8'));
  assert.equal(recordValue.input,'source; `private`\nhello');
  assert.ok(recordValue.args.includes(model));
  assert.ok(!recordValue.args.some((arg:string)=>arg.includes('private')));
  assert.notEqual(recordValue.cwd,process.cwd());
  await assert.rejects(access(recordValue.cwd),/ENOENT/);
  assert.ok(api.modelKey.includes(provider));
  if(provider==='claude') {assert.equal(recordValue.args[recordValue.args.indexOf('--tools')+1],'');assert.ok(recordValue.args.includes('--strict-mcp-config'));}
  else {assert.ok(recordValue.args.includes('--ignore-user-config'));assert.ok(recordValue.args.includes('read-only'));assert.ok(recordValue.args.includes('features.shell_tool=false'));}
});
for (const [name, body, expected] of [
  ['login failure', 'console.error("login required");process.exitCode=1;', /login|sign in/i],
  ['unsupported CLI', 'console.error("unknown option --tools");process.exitCode=1;', /update.*Claude Code/i],
  ['Claude result error', 'console.log(JSON.stringify({type:"result",is_error:true,result:"login required"}));', /login|sign in/i],
  ['invalid result', 'console.log("not a protocol response");', /response/i],
  ['oversized output', 'process.stdout.write("x".repeat(2*1024*1024));', /large|limit/i],
  ['timeout', 'setTimeout(()=>{},10000);', /timed out/i]
] as const) test(`CLI ${name} fails without accepting a hint`, async t => {
  const f = await fixture(t, body);
  const api = await createCliCallbackProvider({provider:'claude',executable:f.executable,model:'',timeoutMs:name==='timeout'?40:3000});
  await assert.rejects(api.complete('source',new AbortController().signal), expected);
});
test('Codex turn failure rejects even after an agent message',async t=>{
  const f=await fixture(t, `console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:${JSON.stringify(reply)}}}));console.log(JSON.stringify({type:'turn.failed',error:{message:'login required'}}));`);
  const api=await createCliCallbackProvider({provider:'codex',executable:f.executable,model:''});
  await assert.rejects(api.complete('source',new AbortController().signal),/login|sign in/i);
});
test('stop terminates a running CLI and an already cancelled request never starts', async t => {
  const f = await fixture(t,'setTimeout(()=>{},10000);');
  const api = await createCliCallbackProvider({provider:'codex',executable:f.executable,model:''});
  const cancellation = new AbortController();
  const pending = api.complete('source',cancellation.signal);
  setTimeout(()=>cancellation.abort(),60);
  await assert.rejects(pending,/cancel/i);
  await assert.rejects(api.complete('source',cancellation.signal),/cancel/i);
});
test('missing CLI gives an installation/path error',async()=>{
  await assert.rejects(createCliCallbackProvider({provider:'claude',executable:path.join(tmpdir(),'missing-dynsight-cli'),model:''}),/install|path|found/i);
});
