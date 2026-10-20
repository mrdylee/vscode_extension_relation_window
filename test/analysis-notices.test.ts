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
