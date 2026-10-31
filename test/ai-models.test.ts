import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {listCliModels} from '../src/cli-callback-provider';

async function fixture(t:{after(fn:()=>Promise<void>):void},body:string) {
  const root=await mkdtemp(path.join(tmpdir(),'dynsight-models-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const executable=path.join(root,'catalog.cjs'),record=path.join(root,'requests.jsonl');
  await writeFile(executable,`const readline=require('node:readline');const fs=require('node:fs');readline.createInterface({input:process.stdin}).on('line',line=>{const request=JSON.parse(line);fs.appendFileSync(${JSON.stringify(record)},line+'\\n');const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');${body}});`);
  return{executable,record};
}
test('Codex catalog initializes first, paginates and returns display names without starting inference',async t=>{
  const f=await fixture(t,`if(request.method==='initialize')send({id:request.id,result:{}});
if(request.method==='model/list')send({id:request.id,result:request.params.cursor?{data:[{model:'second',displayName:'Second Model'}],nextCursor:null}:{data:[{model:'first',displayName:'First Model',isDefault:true},{model:'hidden',displayName:'Hidden',hidden:true}],nextCursor:'page2'}});`);
  const models=await listCliModels({provider:'codex',executable:f.executable,model:''},new AbortController().signal);
  assert.deepEqual(models.map(value=>[value.id,value.label]),[['first','First Model'],['second','Second Model']]);
  const requests=(await readFile(f.record,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(requests.map(value=>value.method),['initialize','initialized','model/list','model/list']);
  assert.ok(!requests.some(value=>/thread|turn|prompt/.test(JSON.stringify(value))));
});
test('Claude catalog uses only the initialize control request and discards account information',async t=>{
  const f=await fixture(t,`send({type:'control_response',response:{subtype:'success',request_id:request.request_id,response:{models:[{value:'sonnet',displayName:'Sonnet',description:'Balanced'},{value:'opus',displayName:'Opus'}],account:{email:'unused@example.invalid'}}}});`);
  const models=await listCliModels({provider:'claude',executable:f.executable,model:''},new AbortController().signal);
  assert.deepEqual(models.map(value=>[value.id,value.label]),[['sonnet','Sonnet'],['opus','Opus']]);
  const requests=(await readFile(f.record,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(requests.length,1);assert.equal(requests[0].type,'control_request');assert.equal(requests[0].request.subtype,'initialize');
  assert.ok(!JSON.stringify(models).includes('email'));
});
test('model discovery is cancellable and bounded by a timeout',async t=>{
  const f=await fixture(t,'');
  await assert.rejects(listCliModels({provider:'codex',executable:f.executable,model:'',timeoutMs:40},new AbortController().signal),/timed out/);
  const abort=new AbortController(),pending=listCliModels({provider:'claude',executable:f.executable,model:''},abort.signal);
  setTimeout(()=>abort.abort(),40);await assert.rejects(pending,/cancel/i);
});
test('model-list errors are rejected rather than treated as a completed selection',async t=>{
  const f=await fixture(t,`if(request.method==='initialize')send({id:request.id,error:{message:'unavailable'}});`);
  await assert.rejects(listCliModels({provider:'codex',executable:f.executable,model:''},new AbortController().signal),/model|catalog/i);
});
