import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createAnalyzer } from '../src/analyzer';
import { BuildMetadataCache } from '../src/build-discovery';
import { BuildAnalysis } from '../src/build-analysis';
import { AnalysisWorkBudget } from '../src/analysis-budget';
import { buildFixture } from './build-fixtures';

async function main() {
  const count = 12, metadata: Record<string,string> = {}, selected: Record<string,string> = {}, unrelated: Record<string,string> = {};
  metadata['build.sh']='make -f Makefile';
  metadata.Makefile='CC=gcc\nall: '+Array.from({length:count},(_,n)=>`m${n}.o`).join(' ')+'\ninclude '+Array.from({length:count},(_,n)=>`App/m${n}/module.mk`).join(' ');
  for(let n=0;n<count;n++) {
    metadata[`App/m${n}/module.mk`]=`include App/m${n}/options.mk\nm${n}.o: App/m${n}/main.c\n\t$(CC) $(FLAGS${n}) -c $< -o $@`;
    metadata[`App/m${n}/options.mk`]=`FLAGS${n}:=`+Array.from({length:6},(_,k)=>`-DF${k}=1`).join(' ');
    const definitions=Array.from({length:6},(_,k)=>`#if F${k}\n#define PICK${k}() m${n}_yes${k}()\n#else\n#define PICK${k}() m${n}_no${k}()\n#endif\n`).join('');
    selected[`App/m${n}/main.c`]=definitions+Array.from({length:6},(_,k)=>`void m${n}_yes${k}(void){}void m${n}_no${k}(void){}`).join('')+
      `typedef void(*CB)(void);CB saved${n}=m${n}_yes0;void m${n}_run(void){`+Array.from({length:6},(_,k)=>`PICK${k}();`).join('')+`saved${n}();}`;
    unrelated[`Unused/u${n}.c`]=`void unused${n}(void){int i=0;`+'i++;'.repeat(100)+'}';
  }
  const fixture=buildFixture({...metadata,...selected,...unrelated}),cache=new BuildMetadataCache(fixture.fs);
  const sourceUris=Object.keys(selected).map(name=>new URL(name,'file:///p/').href);
  const metadataStart=performance.now(),discovery=await cache.discover({rootUri:'file:///p',sourceUris});
  const entry=discovery.entries.find(entry=>entry.entryUri.endsWith('/build.sh'))!;
  const profile=await cache.profile(entry,sourceUris,{}),metadataMs=performance.now()-metadataStart;
  assert.equal(profile.units.length,count);
  const reads=fixture.reads.length,lists=fixture.lists.length;
  await cache.discover({rootUri:'file:///p',sourceUris});await cache.profile(entry,sourceUris,{});
  assert.equal(fixture.reads.length,reads);assert.equal(fixture.lists.length,lists);
  const parser=await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'),path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm'));
  const samples:Record<string,unknown>[]=[];
  for(const arm of ['A-wide','B-source-only','C-build-context'])for(let run=0;run<5;run++) {
    parser.reset();const start=performance.now(),budget=new AnalysisWorkBudget(undefined,true);
    const raw=Object.entries(arm==='A-wide'?{...selected,...unrelated}:selected).map(([name,text])=>parser.analyze(new URL(name,'file:///p/').href,text,true,{expandMacros:true,propagateCallbacks:true}));
    const rawMs=performance.now()-start;let sampledHeap=process.memoryUsage().heapUsed;
    const prepareStart=performance.now(),input=arm==='C-build-context'?await new BuildAnalysis().prepare(parser,raw,profile,budget):raw;
    const prepareMs=performance.now()-prepareStart;sampledHeap=Math.max(sampledHeap,process.memoryUsage().heapUsed);
    let reparses=0;const parseCalls=parser.calls;parser.calls=(...args)=>{reparses++;return parseCalls(...args);};
    const deriveStart=performance.now(),derived=parser.derive(input,undefined,undefined,true,{workBudget:budget}),deriveMs=performance.now()-deriveStart;
    parser.calls=parseCalls;sampledHeap=Math.max(sampledHeap,process.memoryUsage().heapUsed);
    const issues=[...new Set(derived.flatMap(file=>file.issues))],references=derived.flatMap(file=>file.references),runIds=new Set(input.flatMap(file=>file.symbols.filter(symbol=>/_run$/.test(symbol.name)).map(symbol=>symbol.id)));
    if(arm==='C-build-context') {
      assert.ok(!issues.some(issue=>/alternative limit/.test(issue)));
      assert.equal(new Set(references.filter(ref=>ref.callKind==='inferred').map(ref=>ref.name)).size,count);
    }
    samples.push({arm,run,rawMs,prepareMs,deriveMs,totalMs:performance.now()-start,sourceFiles:raw.length,facts:input.length,reparses,
      variants:derived.flatMap(file=>file.programs??[]).filter(program=>runIds.has(program.id)).length,
      work:budget.usage(),sampledHeapBytes:sampledHeap,inferred:references.filter(ref=>ref.callKind==='inferred').length,expanded:references.filter(ref=>ref.callKind==='expanded').length,issues});
  }
  const summary=Object.fromEntries(['A-wide','B-source-only','C-build-context'].map(arm=>{
    const rows=samples.filter(row=>row.arm===arm),values=rows.map(row=>Number(row.totalMs)).sort((a,b)=>a-b);
    return[arm,{medianMs:values[2],minMs:values[0],maxMs:values.at(-1),reparses:rows[0].reparses,variants:rows[0].variants,work:rows[0].work}];
  }));
  const report={kind:'synthetic; not the team GCC/Diab firmware',metadata:{metadataMs,sourceFiles:sourceUris.length,entries:discovery.entries.length,reads,lists,warmAdditionalReads:fixture.reads.length-reads,warmAdditionalLists:fixture.lists.length-lists,coverage:profile.coverage},summary,samples};
  await mkdir('test-results',{recursive:true});await writeFile('test-results/build-context-performance.json',JSON.stringify(report,null,2)+'\n');
  process.stdout.write(JSON.stringify({metadata:report.metadata,summary},null,2)+'\n');
}
main().catch(error=>{process.stderr.write(String(error)+'\n');process.exitCode=1;});
