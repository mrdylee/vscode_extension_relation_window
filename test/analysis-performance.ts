import { Worker } from 'node:worker_threads';
import { readdir, readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';

async function main() {
const root = path.resolve(process.argv[2] ?? 'test-sources/FreeRTOS-Kernel');
const mode = process.argv.find(value => value.startsWith('--mode='))?.split('=')[1] ?? 'full';
const output = process.argv.find(value => value.startsWith('--output='))?.split('=')[1] ?? 'test-results/analysis-baseline.json';
const callbacksEnabled=mode!=='basic'&&!process.argv.includes('--callbacks=off'),stopProbe=process.argv.includes('--stop');
const fixtures:Record<string,string>=process.argv.includes('--fixtures')?{
  'bench-data.c':'typedef void(*CB)(void);void data_target(void){}int data[650];void regular(void){int i=0;'+('data[i%650]=i;i++;').repeat(500)+'}void independent(void){CB cb=data_target;cb();}',
  'bench-objects.c':'typedef void(*CB)(void);struct Ops{CB cb;};void left_target(void){}void right_target(void){}struct Ops left={left_target},right={right_target};void separate(void){left.cb();right.cb();}',
  'bench-chain.c':'typedef void(*CB)(void);void chain_target(void){}void array_target(void){}CB saved;CB get(void){return chain_target;}void save(int a,int b,CB cb){saved=cb;}void register_target(void){save(0,0,get());}void run(void){saved();}CB table[2]={chain_target,array_target};void select_target(int n){table[n]();}'
}:{};
if(!['basic','partial','full'].includes(mode))throw new Error('Use basic, partial or full mode.');
const cacheDir=await mkdtemp(path.join(tmpdir(),'dynsight-performance-'));
const spawn=()=>new Worker(path.resolve('dist/analysis-worker.cjs'), { workerData: { assets: path.resolve('dist') }, resourceLimits: { maxOldGenerationSizeMb: 1024 } });
let worker = spawn();
let id = 0, diagnostics: any, failure: string | undefined, peakHeap=0,peakExternal=0;
let activeCancellation:Int32Array|undefined,stopRequestedAt:number|undefined;
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
const onMessage=(message:any) => {
  if (message.type === 'diagnostics') {
    diagnostics = structuredClone(message.diagnostics);
    peakHeap=Math.max(peakHeap,diagnostics.peakHeap??0);peakExternal=Math.max(peakExternal,diagnostics.sample?.external??0);
    if(stopProbe&&activeCancellation&&diagnostics.phase==='macros'&&stopRequestedAt===undefined){stopRequestedAt=performance.now();Atomics.store(activeCancellation,0,1);}
  }
  const job = pending.get(message.id); if (!job) return;
  pending.delete(message.id); message.error ? job.reject(new Error(message.error)) : job.resolve(message.result);
};
const onError=(error:Error) => { failure = String(error); for (const job of pending.values()) job.reject(error); pending.clear(); };
worker.on('message',onMessage);worker.on('error',onError);
const request = (data: Record<string, unknown>) => {
  const requestId = ++id;
  return { id: requestId, promise: new Promise<any>((resolve, reject) => { pending.set(requestId, { resolve, reject }); worker.postMessage({ ...data, id: requestId }); }) };
};
async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.filter(item => !['.git', 'node_modules'].includes(item.name)).map(item => {
    const filename = path.join(directory, item.name);
    return item.isDirectory() ? sources(filename) : /\.[ch]$/i.test(item.name) ? [filename] : [];
  }));
  return nested.flat().sort();
}
const started = performance.now(), versions: [string, number, number][] = [], samples: unknown[] = [];
const hostFiles=new Map<string,any>(),inputs:{uri:string;text:string;skip:boolean;expandMacros:boolean;propagateCallbacks:boolean}[]=[];
const fingerprint=createHash('sha256');
let timer: ReturnType<typeof setTimeout> | undefined;
function sample(stage:string,began:number,extra:Record<string,unknown>={}) {
  const files=[...hostFiles.values()],issues=files.flatMap(file=>file.issues);
  samples.push({stage,elapsedMs:performance.now()-began,files:files.length,
    complete:!issues.some(issue=>/limit|budget|cancelled/i.test(issue)),candidates:files.flatMap(file=>file.references).filter(ref=>ref.callKind==='inferred').length,
    candidateNames:[...new Set(files.flatMap(file=>file.references).filter(ref=>ref.callKind==='inferred').map(ref=>ref.name))],
    references:files.reduce((n,file)=>n+file.references.length,0),issues,diagnostics,
    phaseMs:Object.fromEntries(Object.entries(diagnostics?.phases??{}).map(([key,value]:[string,any])=>[key,value.after?value.after.at-value.before.at:null])),
    host:process.memoryUsage(),peakHeap,peakExternal,...extra});
}
async function derive(stage:string,began=performance.now()) {
  const cancellation = new Int32Array(new SharedArrayBuffer(4));
  activeCancellation=cancellation;
  timer=setTimeout(()=>Atomics.store(cancellation,0,1),60_000);
  const result=await request({type:'derive',versions,analyzeCallbacks:callbacksEnabled,cancellation:cancellation.buffer}).promise;clearTimeout(timer);activeCancellation=undefined;
  for(const file of result.files)hostFiles.set(file.uri,file);
  for(const [uri,stamp] of result.versions)versions.find(value=>value[0]===uri)![2]=stamp;
  sample(stage,began,{changed:result.files.length,cancelled:!!Atomics.load(cancellation,0),stopResponseMs:stopRequestedAt===undefined?undefined:performance.now()-stopRequestedAt});
  if(stopProbe){if(stopRequestedAt===undefined||![...hostFiles.values()].some(file=>file.issues.some((issue:string)=>/cancelled/i.test(issue))))throw new Error('Stop was not observed by the Worker.');}
  else if(Atomics.load(cancellation,0))throw new Error('Benchmark cancelled after 60 seconds; partial sample retained.');
}
async function restoreFresh() {
  await worker.terminate();worker=spawn();worker.on('message',onMessage);worker.on('error',onError);
  diagnostics=undefined;versions.length=0;hostFiles.clear();
  await request({type:'cache-init',directory:cacheDir,key:mode}).promise;
  for(const input of inputs){const job=request({type:'cache-restore',...input}),restored=await job.promise;if(!restored.hit)throw new Error('Warm disk cache miss');hostFiles.set(input.uri,restored.file);versions.push([input.uri,job.id,restored.stamp]);}
  return request({type:'cache-validate',versions,analyzeCallbacks:callbacksEnabled}).promise;
}
try {
  const files = Object.keys(fixtures).length?Object.keys(fixtures):await sources(root);
  await request({type:'cache-init',directory:cacheDir,key:mode}).promise;
  for (const [n, filename] of files.entries()) {
    const detailed = mode === 'full' || (mode === 'partial' && n < Math.ceil(files.length / 10));
    const input={uri:pathToFileURL(fixtures[filename]?path.join(root,filename):filename).href,text:fixtures[filename]??await readFile(filename,'utf8'),skip:true,expandMacros:detailed,propagateCallbacks:detailed&&callbacksEnabled};
    inputs.push(input);fingerprint.update(input.uri).update(input.text);
    const job=request(input);hostFiles.set(input.uri,await job.promise);versions.push([input.uri,job.id,-job.id]);
  }
  sample('basic',started);
  await derive(stopProbe?'stop-detail':'cold-detail');
  if(Object.keys(fixtures).length){
    const candidates=[...hostFiles.values()].flatMap(file=>file.references).filter(ref=>ref.callKind==='inferred');
    if(mode==='full'&&callbacksEnabled){
      assert.deepEqual([...new Set(candidates.map(ref=>ref.name))].sort(),['data_target','left_target','right_target','chain_target','array_target'].sort());
      assert.equal(candidates.length,6,'independent data, separate objects, getter/third-argument chain and array selection retain their targets');
    }else if(mode==='basic'||!callbacksEnabled)assert.equal(candidates.length,0);
  }
  if(!stopProbe){await derive('warm-detail');
  const saved=await request({type:'cache-save',versions}).promise;if(!saved.saved)throw new Error(saved.reason??'Cache save failed');
  const warmStarted=performance.now(),validation=await restoreFresh();
  if(validation.valid)sample('warm-disk',warmStarted,{cacheValidated:true});else await derive('warm-disk-partial-retry',warmStarted);
  if(inputs.length){await restoreFresh();const input={...inputs[0],text:inputs[0].text+'\nvoid __dynsight_benchmark_save(void){}\n'},began=performance.now();const job=request(input);hostFiles.set(input.uri,await job.promise);versions[0]=[input.uri,job.id,-job.id];await derive('one-file-save',began);}
  }
} catch (error) { failure = String(error); }
finally {
  clearTimeout(timer); await worker.terminate();await rm(cacheDir,{recursive:true,force:true});await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ platform: process.platform, node: process.version, root, mode,callbacksEnabled,fixtures:!!Object.keys(fixtures).length,stopProbe, fingerprint:fingerprint.digest('hex'),failure, samples }, null, 2));
  console.log(JSON.stringify({ output, mode, failure, samples: samples.map((sample: any) => ({ stage: sample.stage, elapsedMs: Math.round(sample.elapsedMs), cancelled: sample.cancelled })) }));
  if (failure) process.exitCode = 1;
}
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
