import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyzer } from '../src/analyzer';
const create = () => createAnalyzer('node_modules/web-tree-sitter/web-tree-sitter.wasm', 'node_modules/tree-sitter-c/tree-sitter-c.wasm');
test('basic policy retains direct calls, registrations and local targets without full programs', async () => {
  const parser = await create();
  const raw = parser.analyze('file:///basic.c', 'typedef void(*CB)(void);void target(void){}void direct(void){}void accept(CB);void run(void){CB fp=target;direct();accept(target);fp();}', true,
    { expandMacros: false, propagateCallbacks: false });
  assert.equal(raw.programs, undefined);
  const result = parser.derive([raw])[0];
  assert.ok(result.references.some(ref => ref.name === 'direct' && ref.kind === 'call'));
  assert.ok(result.callbackRegistrations?.some(ref => ref.name === 'target'));
  assert.ok(result.references.some(ref => ref.name === 'target' && ref.callKind === 'registered'));
  assert.ok(result.functionArguments?.some(ref => ref.name === 'target'));
});
test('selected source uses unchecked header macros without expanding unchecked bodies', async () => {
  const parser = await create();
  const off = { expandMacros: false, propagateCallbacks: false }, on = { expandMacros: true, propagateCallbacks: true };
  const files = parser.derive([
    parser.analyze('file:///api.h', '#define RUN() target()\nvoid target(void);', true, off),
    parser.analyze('file:///app.c', '#include "api.h"\nvoid app(void){RUN();}', true, on),
    parser.analyze('file:///sdk.c', '#include "api.h"\nvoid sdk(void){RUN();}', true, off)
  ]);
  assert.ok(files[1].references.some(ref => ref.name === 'target' && ref.expansion));
  assert.equal(files[2].references.some(ref => ref.expansion), false);
});
test('basic numeric initializers do not retain a large propagation value graph', async () => {
  const parser = await create();
  const file = parser.analyze('file:///data.c', `int data[2000]={${Array.from({length:2000},(_,n)=>n).join(',')}};`, true,
    { expandMacros:false, propagateCallbacks:false });
  assert.equal(file.initializers, undefined);
  assert.ok(JSON.stringify(file.registrationInitializers).length < 500);
});
test('basic registration facts omit scalar update and arithmetic expression graphs',async()=>{
  const parser=await create();
  const raw=parser.analyze('file:///scalar.c','void run(void){int i=0;'+('i++;i+1;').repeat(5000)+'}',true,{expandMacros:false,propagateCallbacks:false});
  assert.ok(JSON.stringify(raw.registrationPrograms).length<2000);
});

test('external callback getter bodies require detailed scope and resolve when added', async () => {
  const parser=await create(),on={expandMacros:false,propagateCallbacks:true},off={expandMacros:false,propagateCallbacks:false};
  const source='typedef void(*CB)(void);void target(void){}CB get(void){return target;}';
  const app=parser.analyze('file:///app.c','typedef void(*CB)(void);CB get(void);void run(void){CB cb=get();cb();}',true,on);
  const outside=parser.derive([parser.analyze('file:///sdk.c',source,true,off),app]);
  assert.equal(outside[1].references.some(ref=>ref.callKind==='inferred'&&ref.name==='target'),false);
  assert.ok(outside[1].references.some(ref=>ref.analysis?.status==='out-of-scope'),'calls depending on excluded bodies explain the scope boundary');
  const inside=parser.derive([parser.analyze('file:///sdk.c',source,true,on),app]);
  assert.ok(inside[1].references.some(ref=>ref.callKind==='inferred'&&ref.name==='target'));
});
