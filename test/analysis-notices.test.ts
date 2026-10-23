import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analysisNotices } from '../src/analysis-notices';
import type { CallbackDiagnostic, FileAnalysis } from '../src/model';

test('located limits precede syntax notices and project limits have no arbitrary filename', () => {
  const mutation = 'Callback mutation limit: 256 slots per function; targets may be incomplete';
  const timeout = 'Callback analysis budget: 10 seconds; targets may be incomplete';
  const detail: CallbackDiagnostic = {kind:'mutation',stage:'propagation',message:mutation,symbol:'update',
    location:{uri:'file:///actual.c',start:20,end:30,line:7,column:0,endLine:7,endColumn:10},
    elapsedMs:500,scopeElapsedMs:20,evaluations:900,scopeEvaluations:300,slots:256};
  const files=[{uri:'file:///first.c',issues:Array.from({length:130},(_,n)=>`Line ${n}: incomplete or unsupported C syntax`)},
    {uri:'file:///actual.c',issues:[mutation,timeout],callbackDiagnostics:[detail]}] as FileAnalysis[];
  const result=analysisNotices(files,uri=>uri.replace('file:///',''));
  assert.match(result[0],/actual.c:8.*update.*256/);
  assert.match(result[0],/stage=propagation.*project=500ms.*scope=20ms.*evaluations=300\/900/);
  assert.match(result[1],/^Project callback analysis: Callback analysis budget/);
  assert.equal(result.filter(s=>s.includes('mutation limit')).length,1);
  assert.ok(result.slice(0,100).some(s=>s.includes('10 seconds')));
});

test('local notices expose storage samples and distinguish cumulative function cost from stop location', () => {
  const detail: CallbackDiagnostic = { kind:'mutation',stage:'propagation',message:'Callback mutation limit',
    elapsedMs:500,scopeElapsedMs:20,evaluations:900,scopeEvaluations:300,
    storage:{operation:'write',retained:256,omitted:'data.cb256',sample:['data.cb0','data.cb1']},
    costs:[{symbol:'configure',location:{uri:'file:///actual.c',start:0,end:1,line:2,column:0,endLine:2,endColumn:1},
      runs:3,cacheHits:1,evaluations:800,elapsedMs:70}] };
  const result = analysisNotices([{uri:'file:///actual.c',text:'',symbols:[],references:[],includes:[],issues:[],callbackDiagnostics:[detail]}] as FileAnalysis[],uri=>uri.replace('file:///',''));
  assert.match(result[0], /write.*retained=256.*first omitted=data.cb256/);
  assert.match(result[0], /sample.*data.cb0.*data.cb1/);
  assert.match(result[0], /configure.*runs=3.*cache hits=1.*evaluations=800.*total=70ms/);
});

test('work-limit notices identify both phases, thresholds and an action before retry',()=>{
  const detail:CallbackDiagnostic={kind:'work',stage:'propagation',message:'Callback function work limit reached',elapsedMs:10,scopeElapsedMs:1,evaluations:20,scopeEvaluations:2,
    work:{scope:{macros:99,callbacks:2,total:101},project:{macros:300,callbacks:40,total:340},limits:{functionWork:100,projectWork:1000}},
    costs:[{symbol:'run',runs:2,cacheHits:0,evaluations:2,elapsedMs:1,invalidations:{'first-run':1,callees:1}}]};
  const [text]=analysisNotices([{uri:'file:///work.c',text:'',symbols:[],references:[],includes:[],issues:[],callbackDiagnostics:[detail]}],uri=>uri);
  assert.match(text,/macro=99\/300.*propagation=2\/40.*total=101\/340/);
  assert.match(text,/function limit=100.*project limit=1000/);
  assert.match(text,/cache misses: first-run=1, callees=1/);
  assert.match(text,/Narrow Smart Analysis Include\/Exclude.*Retry local/);
});
