import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisWorkBudget } from '../src/analysis-budget';
import { createAnalyzer } from '../src/analyzer';
test('work is cumulative across repeated evaluations of a function', () => {
  const budget = new AnalysisWorkBudget({functionWork:3,projectWork:20});
  assert.equal(budget.consume('run',2),'ok');
  assert.equal(budget.consume('other',1),'ok');
  assert.equal(budget.consume('run',2),'function-limit');
});
test('project budget covers many independent functions', () => {
  const budget = new AnalysisWorkBudget({functionWork:10,projectWork:3});
  assert.equal(budget.consume('a',2),'ok');
  assert.equal(budget.consume('b',2),'project-limit');
});
test('progressive batches retain cumulative function guards without starving the next phase', () => {
  const budget = new AnalysisWorkBudget({functionWork:10,projectWork:3}, true);
  assert.equal(budget.consume('macro-a',2,'macros'),'ok');
  assert.equal(budget.consume('macro-b',2,'macros'),'ok');
  assert.equal(budget.consume('callback',2),'ok');
  assert.equal(budget.batches,2);
  assert.equal(budget.consume('macro-a',9,'macros'),'function-limit');
  assert.equal(budget.usage().total,15);
});
test('callback propagation completes after macro work crosses multiple project batches',async()=>{
  const parser=await createAnalyzer('node_modules/web-tree-sitter/web-tree-sitter.wasm','node_modules/tree-sitter-c/tree-sitter-c.wasm');
  const raw=parser.analyze('file:///batches.c','#define TARGET target\ntypedef void(*CB)(void);void target(void){}void run(void){CB cb=TARGET;cb();}');
  const budget=new AnalysisWorkBudget({functionWork:1000,projectWork:3},true);
  const [result]=parser.derive([raw],undefined,undefined,true,{workBudget:budget});
  assert.ok(budget.usage().macros>3);assert.ok(budget.usage().callbacks>0);
  assert.ok(result.references.some(ref=>ref.callKind==='inferred'&&ref.name==='target'&&ref.inference?.incomplete===false));
  assert.ok(!result.issues.some(issue=>/limit|cancelled/.test(issue)),result.issues.join('\n'));
});
test('hard project exhaustion skips macro environments and reparses in later files',async()=>{
  const parser=await createAnalyzer('node_modules/web-tree-sitter/web-tree-sitter.wasm','node_modules/tree-sitter-c/tree-sitter-c.wasm');
  const raws=['first','later'].map(name=>parser.analyze(`file:///${name}.c`,'#define CALL target()\nvoid target(void){}void run(void){CALL;}'));
  let environments=0;const laterEvents=raws[1].preprocessor;
  Object.defineProperty(laterEvents,Symbol.iterator,{value:function(){environments++;return Array.prototype[Symbol.iterator].call(this);}});
  let reparses=0;const calls=parser.calls;parser.calls=(...args)=>{reparses++;return calls(...args);};
  const result=parser.derive(raws,undefined,undefined,true,{workLimits:{functionWork:100,projectWork:1}});
  assert.equal(reparses,0,'an exhausted environment must not produce a partial expansion');
  assert.equal(environments,0,'later files must not traverse includes after hard project exhaustion');
  assert.ok(result.every(file=>file.issues.some(issue=>/Macro analysis work limit/.test(issue))));
});
test('work accounting separates macro scans from callback evaluations',()=>{
  const budget=new AnalysisWorkBudget({functionWork:20,projectWork:40});
  budget.consume('run',3,'macros');budget.consume('run',2,'callbacks');budget.consume('other',4,'macros');
  assert.deepEqual(budget.usage('run'),{macros:3,callbacks:2,total:5});
  assert.deepEqual(budget.usage(),{macros:7,callbacks:2,total:9});
});
test('an exhausted body is not repeatedly evaluated while independent callbacks remain',async()=>{
  const parser=await createAnalyzer('node_modules/web-tree-sitter/web-tree-sitter.wasm','node_modules/tree-sitter-c/tree-sitter-c.wasm');
  const budget=new AnalysisWorkBudget({functionWork:30,projectWork:100000});let exceeded=0;
  const consume=budget.consume.bind(budget);budget.consume=(id,n,phase)=>{const result=consume(id,n,phase);if(result==='function-limit')exceeded++;return result;};
  const source='typedef void(*CB)(void);void target(void){}void busy(CB cb){cb();'+ 'cb=cb;'.repeat(100)+'}void run(void){busy(target);}void good(void){CB cb=target;cb();}';
  const raw=parser.analyze('file:///work.c',source,true,{expandMacros:false,propagateCallbacks:true});
  const [result]=parser.derive([raw],undefined,undefined,true,{workBudget:budget});
  assert.equal(exceeded,1,'the exhausted body must stop spending work');
  const cost=result.callbackDiagnostics?.flatMap(detail=>detail.costs??[]).find(cost=>cost.symbol==='busy');
  assert.equal(cost?.runs,1,'later propagation rounds must not re-run an exhausted function');
  assert.ok(result.references.some(ref=>ref.callKind==='inferred'&&ref.name==='target'));
  assert.ok(result.issues.some(issue=>issue.includes('function work limit')));
});
test('engine retains direct calls and records partial reasons when project work is exhausted',async()=>{
  const parser=await createAnalyzer('node_modules/web-tree-sitter/web-tree-sitter.wasm','node_modules/tree-sitter-c/tree-sitter-c.wasm');
  const raw=parser.analyze('file:///budget.c','typedef void(*CB)(void);void target(void){}void direct(void){}void run(CB cb){direct();cb();}');
  const [result]=parser.derive([raw],undefined,undefined,true,{workLimits:{functionWork:1,projectWork:1}});
  assert.ok(result.references.some(ref=>ref.kind==='call'&&ref.name==='direct'));
  assert.ok(result.issues.some(issue=>/work limit/.test(issue)));
  assert.ok(result.references.some(ref=>ref.analysis?.status==='work-limit'),'unresolved calls retain the work limit reason');
});
test('one expensive function does not remove an independent callback target',async()=>{
  const parser=await createAnalyzer('node_modules/web-tree-sitter/web-tree-sitter.wasm','node_modules/tree-sitter-c/tree-sitter-c.wasm');
  const source='typedef void(*CB)(void);void target(void){}void busy(void){int i=0;'+('i=i+1;').repeat(100)+'}void good(void){CB cb=target;cb();}';
  const raw=parser.analyze('file:///independent.c',source,true,{expandMacros:false,propagateCallbacks:true});
  const [result]=parser.derive([raw],undefined,undefined,true,{workLimits:{functionWork:100,projectWork:10000}});
  assert.ok(result.issues.some(issue=>issue.includes('function work limit')));
  assert.ok(result.references.some(ref=>ref.callKind==='inferred'&&ref.name==='target'));
});

test('numeric compensation before a callback getter does not starve callback propagation',async()=>{
  const parser=await createAnalyzer('node_modules/web-tree-sitter/web-tree-sitter.wasm','node_modules/tree-sitter-c/tree-sitter-c.wasm');
  const source=`typedef void(*CB)(void);void target(void){}struct Ops{CB cb;};
    static struct Ops ops={target};static struct Ops*non_safety_cb;static unsigned volts[200];
    static void get(struct Ops**out){*out=&ops;}void run(void){`+
    Array.from({length:200},(_,n)=>`volts[${n}]=volts[${n}]*2+1;`).join('')+
    'if(!non_safety_cb)get(&non_safety_cb);non_safety_cb->cb();}';
  const raw=parser.analyze('file:///compensation.c',source,true,{expandMacros:false,propagateCallbacks:true});
  const [result]=parser.derive([raw],undefined,undefined,true,{workLimits:{functionWork:600,projectWork:1000000}});
  assert.deepEqual(result.issues,[]);
  assert.ok(result.references.some(ref=>ref.callKind==='inferred'&&ref.name==='target'&&!ref.inference?.incomplete));
});

for (const effect of ['select()', '(selected=1)', 'volts[(selected=1)]', '(get(&non_safety_cb),0)'])
  test(`discarded numeric writes preserve callback dependencies and side effects: ${effect}`,async()=>{
    const parser=await createAnalyzer('node_modules/web-tree-sitter/web-tree-sitter.wasm','node_modules/tree-sitter-c/tree-sitter-c.wasm');
    const source=`typedef void(*CB)(void);void first(void){}void second(void){}
      struct Ops{CB cb;};static struct Ops ops={second};static struct Ops*non_safety_cb;
      static CB table[2]={first,second};static unsigned selected,volts[2];
      static unsigned select(void){selected=1;return 0;}static void get(struct Ops**out){*out=&ops;}
      void run(void){selected=0;volts[0]=${effect};`+
      (effect.includes('get(')?'non_safety_cb->cb();':'table[selected]();')+'}';
    const raw=parser.analyze('file:///numeric-side-effect.c',source,true,{expandMacros:false,propagateCallbacks:true});
    const [result]=parser.derive([raw]);
    const names=result.references.filter(ref=>ref.callKind==='inferred').map(ref=>ref.name);
    assert.deepEqual([...new Set(names)],['second']);
    assert.ok(result.references.filter(ref=>ref.callKind==='inferred').every(ref=>!ref.inference?.incomplete));
  });

test('photo compensation pattern retains the late callback under the unchanged default work limit',async()=>{
  const parser=await createAnalyzer('node_modules/web-tree-sitter/web-tree-sitter.wasm','node_modules/tree-sitter-c/tree-sitter-c.wasm');
  const source=`typedef void(*CB)(void);void target(void){}struct Ops{CB cb;};static struct Ops ops={target};
    static unsigned volts[200];void run(void){`+
    Array.from({length:26000},(_,n)=>`volts[${n%200}]=volts[${n%200}]*2+1;`).join('')+'ops.cb();}';
  const raw=parser.analyze('file:///default-compensation.c',source,true,{expandMacros:false,propagateCallbacks:true});
  const budget=new AnalysisWorkBudget();
  const [result]=parser.derive([raw],undefined,undefined,true,{workBudget:budget});
  assert.equal(budget.maximum.functionWork,100000);
  assert.deepEqual(result.issues,[]);
  assert.ok(result.references.some(ref=>ref.callKind==='inferred'&&ref.name==='target'&&!ref.inference?.incomplete));
});

test('numeric compound assignments retain calls that configure callback selection',async()=>{
  const parser=await createAnalyzer('node_modules/web-tree-sitter/web-tree-sitter.wasm','node_modules/tree-sitter-c/tree-sitter-c.wasm');
  const source='typedef void(*CB)(void);void first(void){}void second(void){}static CB table[2]={first,second};static unsigned selected,voltage;static unsigned select(void){selected=1;return 0;}void run(void){selected=0;voltage+=select();table[selected]();}';
  const raw=parser.analyze('file:///compound-selection.c',source,true,{expandMacros:false,propagateCallbacks:true});
  const [result]=parser.derive([raw]);
  assert.deepEqual([...new Set(result.references.filter(ref=>ref.callKind==='inferred').map(ref=>ref.name))],['second']);
});

test('compensation macros, nested loops and memcpy retain the following callback getter',async()=>{
  const parser=await createAnalyzer('node_modules/web-tree-sitter/web-tree-sitter.wasm','node_modules/tree-sitter-c/tree-sitter-c.wasm');
  const source=`#define COMPENSATE(x) ((x)=((x)*2+1))
    typedef void(*CB)(void);void target(void){}struct Ops{CB cb;};static struct Ops ops={target};static struct Ops*non_safety_cb;
    static unsigned volts[200],temporary[200];void*memcpy(void*,const void*,unsigned);
    static void get(struct Ops**out){*out=&ops;}void run(void){memcpy(temporary,volts,sizeof(volts));
    for(unsigned i=0;i<4;i++){for(unsigned j=0;j<4;j++){`+
    Array.from({length:1000},(_,n)=>`COMPENSATE(temporary[${n%200}]);`).join('')+
    '}}memcpy(volts,temporary,sizeof(volts));if(!non_safety_cb)get(&non_safety_cb);non_safety_cb->cb();}';
  const [result]=parser.derive([parser.analyze('file:///macro-compensation.c',source)]);
  assert.deepEqual(result.issues,[]);
  assert.ok(result.references.some(ref=>ref.callKind==='inferred'&&ref.name==='target'&&!ref.inference?.incomplete));
});

test('discarded scalar destinations still execute callback selector side effects',async()=>{
  const parser=await createAnalyzer('node_modules/web-tree-sitter/web-tree-sitter.wasm','node_modules/tree-sitter-c/tree-sitter-c.wasm');
  const source='typedef void(*CB)(void);void first(void){}void second(void){}static CB table[2]={first,second};static unsigned selected,voltage[2];void run(void){selected=0;voltage[(selected=1)]=0;table[selected]();}';
  const [result]=parser.derive([parser.analyze('file:///destination-effect.c',source)]);
  assert.deepEqual([...new Set(result.references.filter(ref=>ref.callKind==='inferred').map(ref=>ref.name))],['second']);
});
