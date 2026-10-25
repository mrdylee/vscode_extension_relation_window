import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintBuildInput, normalizeCompileContext, sameBuildEpoch } from '../src/build-context';
import { buildFixture } from './build-fixtures';

test('GCC and Diab preserve the same ordered explicit macro and include options',async()=>{
  const {fs}=buildFixture({});
  for(const compiler of ['gcc','dcc']){
    const unit=await normalizeCompileContext({profileId:'x',sourceUri:'file:///p/a.c',cwdUri:'file:///p',argv:[compiler,'-DMODE=0','-UMODE','-D','MODE=1','-I','inc','-c','a.c','-o','a.o'],dialect:'posix',evidence:[]},fs);
    assert.equal(unit.status,'resolved');assert.equal(unit.builtins,'unknown');
    assert.deepEqual(unit.macroActions,[{kind:'define',name:'MODE',replacement:'0'},{kind:'undef',name:'MODE'},{kind:'define',name:'MODE',replacement:'1'}]);
    assert.equal(unit.includeSearch[0].uri,'file:///p/inc');assert.equal(unit.outputUri,'file:///p/a.o');
  }
});

test('build fingerprints preserve option order and normalize object key order', () => {
  assert.equal(fingerprintBuildInput({ a: 1, b: 2 }), fingerprintBuildInput({ b: 2, a: 1 }));
  assert.notEqual(fingerprintBuildInput(['-DX=1', '-UX']), fingerprintBuildInput(['-UX', '-DX=1']));
});
test('build epoch rejects old profiles and source revisions', () => {
  const epoch = { profileId: 'a', fingerprint: 'f', contextRevision: 1, sourceRevision: 2 };
  assert.ok(sameBuildEpoch(epoch, { ...epoch }));
  assert.ok(!sameBuildEpoch(epoch, { ...epoch, profileId: 'b' }));
  assert.ok(!sameBuildEpoch(epoch, { ...epoch, sourceRevision: 3 }));
});
test('compile units preserve ordered defines, include categories and original argv', async () => {
  const { fs } = buildFixture({});
  const argv = ['arm-none-eabi-gcc', '-DX=1', '-UX', '-DX=0', '-iquote', 'quotes', '-Iinc', '-isystem', 'sdk', '-include', 'config.h', '-c', 'App/a.c'];
  const unit = await normalizeCompileContext({ profileId: 'A', sourceUri: 'file:///p/App/a.c', cwdUri: 'file:///p/', argv, dialect: 'posix', evidence: [] }, fs);
  assert.deepEqual(unit.macroActions, [{ kind: 'define', name: 'X', replacement: '1' }, { kind: 'undef', name: 'X' }, { kind: 'define', name: 'X', replacement: '0' }]);
  assert.deepEqual(unit.includeSearch.map(i => [i.kind, i.uri]), [['quote', 'file:///p/quotes'], ['user', 'file:///p/inc'], ['system', 'file:///p/sdk']]);
  assert.deepEqual(unit.forcedInputs, [{ kind: 'header', uri: 'file:///p/config.h' }]);
  assert.deepEqual(unit.argv, argv); assert.equal(unit.builtins, 'unknown');
});
test('response dependencies and different invocations are never overwritten', async () => {
  const { fs } = buildFixture({ 'flags.rsp': '-DMODE=1 -I"include dir"' });
  const base = { profileId: 'A', sourceUri: 'file:///p/a.c', cwdUri: 'file:///p/', dialect: 'posix' as const, evidence: [] };
  const a = await normalizeCompileContext({ ...base, argv: ['gcc', '@flags.rsp', '-c', 'a.c'] }, fs);
  const b = await normalizeCompileContext({ ...base, argv: ['gcc', '-DMODE=2', '-c', 'a.c'] }, fs);
  assert.notEqual(a.id, b.id); assert.equal(a.dependencies[0].uri, 'file:///p/flags.rsp');
  assert.equal(a.includeSearch[0].uri, 'file:///p/include%20dir');
});
test('unknown compiler and missing response keep uncertainty', async () => {
  const { fs } = buildFixture({});
  const unit = await normalizeCompileContext({ profileId: 'A', sourceUri: 'file:///p/a.c', cwdUri: 'file:///p/', argv: ['dcc', '@missing.rsp', '-Xunknown', '-c', 'a.c'], dialect: 'windows', evidence: [] }, fs);
  assert.equal(unit.compiler, 'diab'); assert.equal(unit.status, 'partial');
  assert.ok(unit.issues.some(i => i.code === 'unsupported-compiler-options'));
  assert.equal(unit.builtins, 'unknown');
});
test('ordinary GCC dependency outputs and section flags preserve a resolved compile command',async()=>{
  const {fs}=buildFixture({});
  const unit=await normalizeCompileContext({profileId:'A',sourceUri:'file:///p/a.c',cwdUri:'file:///p',argv:['arm-none-eabi-gcc','-mcpu=cortex-m4','-mthumb','-O2','-g3','-ffunction-sections','-fdata-sections','-MMD','-MP','-MF','a.d','-MT','a.o','-DMODE=1','-c','a.c','-o','a.o'],dialect:'posix',evidence:[]},fs);
  assert.equal(unit.status,'resolved');assert.equal(unit.outputUri,'file:///p/a.o');
});
