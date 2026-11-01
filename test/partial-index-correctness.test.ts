import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAnalyzer} from '../src/analyzer';
import {AnalysisWorkBudget} from '../src/analysis-budget';
import {RelationIndex} from '../src/relations';
import {AnalysisCache} from '../src/analysis-cache';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

async function analyze(source: string, work?: number) {
  const analyzer = await createAnalyzer('node_modules/web-tree-sitter/web-tree-sitter.wasm', 'node_modules/tree-sitter-c/tree-sitter-c.wasm');
  const uri = 'file:///fix-review.c';
  const raw=analyzer.analyze(uri, source, true, {expandMacros: work === undefined, propagateCallbacks: true});
  const [file] = analyzer.derive([raw], undefined, undefined, true,
    work === undefined ? {} : {workBudget: new AnalysisWorkBudget({functionWork: work, projectWork: 1000000}, true)});
  const index = new RelationIndex(); index.update(file);
  return {raw,file, at: (call: string) => index.callbackAt(uri, source.indexOf(call) + 1)!};
}
function macroSource(bits: number, context: string) {
  const targets = Array.from({length: 2 ** bits}, (_, n) => 'target_' + n.toString(2).padStart(bits, '0'));
  const definitions = Array.from({length: bits}, (_, n) => `#if FLAG${n}\n#define B${n} 0\n#else\n#define B${n} 1\n#endif\n`).join('');
  const args = Array.from({length: bits}, (_, n) => 'p' + n).join(','), values = Array.from({length: bits}, (_, n) => 'B' + n).join(',');
  const cat = '#define CAT_(' + args + ') target_##' + args.split(',').join('##') + '\n#define CAT(' + args + ') CAT_(' + args + ')\n';
  const value = `CAT(${values})`;
  const body = context === 'getter' ? `void get(CB*out){*out=${value};}void run(void){CB cb;get(&cb);cb();}` :
    context === 'global' ? `static CB cb=${value};void run(void){cb();}` : `void run(void){CB cb=${value};cb();}`;
  return 'typedef void(*CB)(void);\n' + targets.map(name => `void ${name}(void){}`).join('\n') + '\n' + definitions + cat + body;
}
test('all32macro targets inside the bound remain complete', async () => {
  const result = await analyze(macroSource(5, 'local'));
  assert.equal(result.at('cb();').targets.length, 32);
  assert.equal(result.at('cb();').incomplete, false);
});
for (const context of ['local', 'global', 'getter']) test(`truncated macro candidates remain incomplete through ${context}`, async () => {
  const result = await analyze(macroSource(6, context));
  assert.ok(result.file.issues.some(issue => /alternative limit/.test(issue)));
  assert.equal(result.at('cb();').targets.length, 32, '32 of64possible targets were omitted');
  assert.equal(result.at('cb();').incomplete, true, 'bounded candidates cannot establish a complete target set');
});
const workSource = 'typedef void(*CB)(void);void first(void){}void second(void){}static CB cb=first,noise;void setup(void){noise=first;' +
  'noise=noise;'.repeat(50) + 'cb=second;}void run(void){setup();cb();}void independent(void){CB local=second;local();}';
test('a work-limited helper cannot prove its caller retained the old callback', async () => {
  const result = await analyze(workSource, 100);
  assert.ok(result.file.issues.some(issue => /function work limit/.test(issue)));
  assert.equal(result.at('cb();').incomplete, true, 'the omitted late write must invalidate completeness in the caller');
});
test('an independent callback remains complete despite another helper work limit', async () => {
  const result = await analyze(workSource, 100);
  assert.deepEqual(result.at('local();').targets.map(target => target.name), ['second']);
  assert.equal(result.at('local();').incomplete, false);
});
test('the full helper reaches the replacement callback', async () => {
  const result = await analyze(workSource, 10000);
  assert.deepEqual(result.at('cb();').targets.map(target => target.name), ['second']);
  assert.equal(result.at('cb();').incomplete, false);
});
test('a truncated helper invalidates omitted output-pointer writes in its caller',async()=>{
  const source='typedef void(*CB)(void);void first(void){}void second(void){}static CB cb=first,noise;void setup(CB*out){noise=first;'+'noise=noise;'.repeat(50)+'*out=second;}void run(void){setup(&cb);cb();}';
  const result=await analyze(source,100);
  assert.ok(result.file.issues.some(issue=>/function work limit/.test(issue)));
  assert.equal(result.at('cb();').incomplete,true);
});
test('omitted transitive writes invalidate their globals while independent globals remain complete',async()=>{
  const source='typedef void(*CB)(void);void first(void){}void second(void){}static CB cb=first,noise,other=second;void replace(void){cb=second;}void setup(void){noise=first;'+'noise=noise;'.repeat(50)+'replace();}void run(void){setup();cb();}void independent(void){other();}';
  const result=await analyze(source,100);
  assert.equal(result.at('cb();').incomplete,true);
  assert.deepEqual(result.at('other();').targets.map(target=>target.name),['second']);
  assert.equal(result.at('other();').incomplete,false);
});
test('truncated macro candidates retain their uncertainty after disk restoration',async()=>{
  const source=macroSource(6,'getter'),result=await analyze(source),directory=await mkdtemp(join(tmpdir(),'dynsight-partial-'));
  try {
    const cache=await AnalysisCache.open(directory,'partial-test');
    assert.equal((await cache.save([{raw:result.raw,derived:result.file,skip:true,expandMacros:true}])).saved,true);
    const restored=await (await AnalysisCache.open(directory,'partial-test')).restore(result.file.uri,source,true,true);
    assert.ok(restored);
    const index=new RelationIndex();index.update(restored.derived);
    const site=index.callbackAt(result.file.uri,source.indexOf('cb();')+1)!;
    assert.equal(site.targets.length,32);assert.equal(site.incomplete,true);
  }finally{await rm(directory,{recursive:true,force:true});}
});
