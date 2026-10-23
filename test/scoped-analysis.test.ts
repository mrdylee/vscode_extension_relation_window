import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyzer } from '../src/analyzer';
import { RelationIndex } from '../src/relations';
const create = () => createAnalyzer('node_modules/web-tree-sitter/web-tree-sitter.wasm', 'node_modules/tree-sitter-c/tree-sitter-c.wasm');
test('basic macro binding selects the included definition without expanding or reparsing the body', async () => {
  const parser=await create(),off={expandMacros:false,propagateCallbacks:false};
  const raw=[parser.analyze('file:///a.h','#define CHECK_FAULT1(x) ((x)>0)\n',true,off),
    parser.analyze('file:///b.h','#define CHECK_FAULT1(x) ((x)<0)\n',true,off),
    parser.analyze('file:///main.c','#include "a.h"\nint run(int x){return CHECK_FAULT1(x);}',true,off)];
  let reparses=0;const calls=parser.calls;parser.calls=(...args)=>{reparses++;return calls(...args);};
  for(const files of [parser.basic(raw),parser.derive(raw)]){
    const index=new RelationIndex();files.forEach(file=>index.update(file));
    const run=index.symbols().find(symbol=>symbol.name==='run')!,groups=index.relations(run.id,'callees');
    assert.equal(groups.length,1);assert.equal(groups[0].symbol?.location.uri,'file:///a.h');
    assert.equal(groups[0].sites.length,1);assert.equal(groups[0].sites[0].ambiguous,false);
    assert.equal(files[2].references.some(ref=>ref.expansion),false);
    assert.equal(files[2].programs,undefined);
  }
  assert.equal(reparses,0);
});
test('conditional basic macro definitions share one use node with all definition candidates',async()=>{
  const parser=await create(),off={expandMacros:false,propagateCallbacks:false};
  const files=parser.basic([parser.analyze('file:///a.h','#define CHECK_FAULT1(x) ((x)>0)',true,off),
    parser.analyze('file:///b.h','#define CHECK_FAULT1(x) ((x)<0)',true,off),
    parser.analyze('file:///main.c','#if BOARD\n#include "a.h"\n#else\n#include "b.h"\n#endif\nint run(int x){return CHECK_FAULT1(x);}',true,off)]);
  const index=new RelationIndex();files.forEach(file=>index.update(file));const run=index.symbols().find(symbol=>symbol.name==='run')!;
  const groups=index.relations(run.id,'callees');assert.equal(groups.length,1);assert.equal(groups[0].sites.length,1);
  assert.equal(groups[0].sites[0].candidates.length,2);assert.equal(groups[0].sites[0].ambiguous,true);
  const node=index.graph(run.id,'callees',1)!.root.children[0];assert.equal(node.definitionCandidates?.length,2);
  for(const id of groups[0].sites[0].candidates)assert.equal(index.relations(id,'references')[0].sites.length,1);
});
test('basic use bindings retain distinct same-name definitions before and after redefinition',async()=>{
  const parser=await create(),off={expandMacros:false,propagateCallbacks:false};
  const [file]=parser.basic([parser.analyze('file:///order.c','#define CHECK(x) ((x)>0)\nint run(void){CHECK(1);\n#undef CHECK\n#define CHECK(x) ((x)<0)\nCHECK(2);}',true,off)]);
  const index=new RelationIndex();index.update(file);const run=index.symbols().find(symbol=>symbol.name==='run')!,groups=index.relations(run.id,'callees');
  assert.equal(groups.length,2);assert.ok(groups.every(group=>group.sites.length===1&&!group.sites[0].ambiguous));
  assert.notEqual(groups[0].symbol?.id,groups[1].symbol?.id);
  assert.ok(groups[0].symbol!.location.start<groups[0].sites[0].location.start);
});
test('basic include ordering and header edits update bindings while warm input reuses the result',async()=>{
  const parser=await create(),off={expandMacros:false,propagateCallbacks:false};
  const a=parser.analyze('file:///a.h','#define CHECK(x) ((x)>0)',true,off),b=parser.analyze('file:///b.h','#undef CHECK\n#define CHECK(x) ((x)<0)',true,off);
  const main=parser.analyze('file:///main.c','#include "a.h"\n#include "b.h"\nint run(void){return CHECK(1);}',true,off);
  const first=parser.basic([a,b,main]);assert.equal(parser.basic([a,b,main])[2],first[2]);
  const active=(files:typeof first)=>{const index=new RelationIndex();files.forEach(file=>index.update(file));return index.relations(index.symbols().find(symbol=>symbol.name==='run')!.id,'callees')[0];};
  assert.equal(active(first).symbol?.location.uri,'file:///b.h');
  const changed=parser.basic([a,parser.analyze('file:///b.h','/* definition removed */',true,off),main]);
  assert.notEqual(changed[2],first[2]);assert.equal(active(changed).symbol?.location.uri,'file:///a.h');
});
test('unrelated, not-yet-defined and undefined macros do not replace a real function in basic analysis',async()=>{
  const parser=await create(),off={expandMacros:false,propagateCallbacks:false};
  const files=parser.basic([parser.analyze('file:///unrelated.h','#define CHECK(x) ((x)>0)',true,off),
    parser.analyze('file:///main.c','int CHECK(int);int run(void){CHECK(1);\n#define CHECK(x) ((x)>0)\n#undef CHECK\nreturn CHECK(2);}',true,off)]);
  const index=new RelationIndex();files.forEach(file=>index.update(file));const groups=index.relations(index.symbols().find(symbol=>symbol.name==='run')!.id,'callees');
  assert.equal(groups.length,1);assert.equal(groups[0].kind,'function');assert.equal(groups[0].sites.length,2);
});
test('a possibly undefined basic macro does not hide a same-name real function',async()=>{
  const parser=await create(),off={expandMacros:false,propagateCallbacks:false};
  const [file]=parser.basic([parser.analyze('file:///maybe.c','int CHECK(int);\n#if BOARD\n#define CHECK(x) ((x)>0)\n#endif\nint run(void){return CHECK(1);}',true,off)]);
  const index=new RelationIndex();index.update(file);const groups=index.relations(index.symbols().find(symbol=>symbol.name==='run')!.id,'callees');
  assert.deepEqual(groups.map(group=>group.kind).sort(),['function','macro']);assert.ok(groups.every(group=>group.sites[0].ambiguous));
});
test('unavailable headers keep basic macro binding uncertain',async()=>{
  const parser=await create(),off={expandMacros:false,propagateCallbacks:false};
  const [file]=parser.basic([parser.analyze('file:///unknown.c','#define CHECK(x) ((x)>0)\n#include "unavailable.h"\nint run(void){return CHECK(1);}',true,off)]);
  const ref=file.references.find(ref=>ref.kind==='call'&&ref.name==='CHECK')!;
  assert.equal(ref.macroIds?.length,1);assert.equal(ref.macroUncertain,true);
});
test('unknown headers only affect later uses and a later definition restores a unique binding',async()=>{
  const parser=await create(),off={expandMacros:false,propagateCallbacks:false};
  const [file]=parser.basic([parser.analyze('file:///positions.c','#define CHECK(x) ((x)>0)\nint before(void){return CHECK(1);}\n#include "missing.h"\n#define CHECK(x) ((x)<0)\nint after(void){return CHECK(2);}',true,off)]);
  const calls=file.references.filter(ref=>ref.kind==='call'&&ref.name==='CHECK');
  assert.equal(calls.length,2);assert.ok(calls.every(ref=>ref.macroIds?.length===1&&!ref.macroUncertain));
  assert.notEqual(calls[0].macroIds![0],calls[1].macroIds![0]);
});
test('conditional guard undef retains a possible guarded definition instead of dropping it',async()=>{
  const parser=await create(),off={expandMacros:false,propagateCallbacks:false};
  const files=parser.basic([parser.analyze('file:///guard.h','#ifndef GUARD\n#define GUARD\n#define CHECK(x) ((x)>0)\n#endif',true,off),
    parser.analyze('file:///guard-use.c','#include "guard.h"\n#undef CHECK\n#if BOARD\n#undef GUARD\n#endif\n#include "guard.h"\nint run(void){return CHECK(1);}',true,off)]);
  const ref=files[1].references.find(ref=>ref.kind==='call'&&ref.name==='CHECK')!;
  assert.equal(ref.macroIds?.length,1);assert.equal(ref.macroUncertain,true);
});
test('repeated unchanged headers are reused while define and undef changes force replay',async()=>{
  const parser=await create(),off={expandMacros:false,propagateCallbacks:false};
  const header=parser.analyze('file:///repeat.h','#define CHECK(x) ((x)>0)',true,off);
  let visits=0;const events=header.preprocessor!;
  Object.defineProperty(events,Symbol.iterator,{value:function(){visits++;return Array.prototype[Symbol.iterator].call(this);}});
  const main=parser.analyze('file:///repeat.c','#include "repeat.h"\n'.repeat(500)+'int before(void){return CHECK(1);}\n#undef CHECK\n#include "repeat.h"\nint after(void){return CHECK(2);}',true,off);
  const files=parser.basic([header,main]);
  assert.ok(visits<=3,'the header is scanned once for itself, once for the caller and once after undef');
  const refs=files[1].references.filter(ref=>ref.kind==='call'&&ref.name==='CHECK');
  assert.equal(refs.length,2);assert.ok(refs.every(ref=>ref.macroIds?.length===1&&!ref.macroUncertain));
});
test('an unconditional include after a conditional include is not incorrectly skipped',async()=>{
  const parser=await create(),off={expandMacros:false,propagateCallbacks:false};
  const files=parser.basic([parser.analyze('file:///again.h','#define CHECK(x) ((x)>0)',true,off),
    parser.analyze('file:///again.c','#if BOARD\n#include "again.h"\n#endif\n#include "again.h"\nint run(void){return CHECK(1);}',true,off)]);
  const ref=files[1].references.find(ref=>ref.kind==='call'&&ref.name==='CHECK')!;
  assert.equal(ref.macroIds?.length,1);assert.equal(ref.macroUncertain,false);
});
test('ambiguous header search joins definition candidates once without exploring expansion worlds',async()=>{
  const parser=await create(),off={expandMacros:false,propagateCallbacks:false};
  let scans=0;
  const headers=['a','b'].map((name,n)=>{
    const file=parser.analyze(`file:///${name}/defs.h`,`#define CHECK(x) ((x)==${n})\n`,true,off),events=file.preprocessor!;
    Object.defineProperty(events,Symbol.iterator,{value:function(){scans++;return Array.prototype[Symbol.iterator].call(this);}});return file;
  });
  const unrelated=parser.analyze('file:///unused.h','#define CHECK(x) ((x)>9)',true,off);
  const main=parser.analyze('file:///main.c','#include "defs.h"\n'.repeat(10)+'int run(void){return CHECK(1);}',true,off);
  const files=parser.basic([...headers,unrelated,main]);
  const index=new RelationIndex();files.forEach(file=>index.update(file));const group=index.relations(index.symbols().find(symbol=>symbol.name==='run')!.id,'callees')[0];
  assert.equal(group.sites.length,1);assert.equal(group.definitionCandidates?.length,2);
  assert.ok(group.definitionCandidates?.every(symbol=>symbol.location.uri!=='file:///unused.h'));
  assert.equal(scans,2,'a shared ambiguous include summary scans each candidate header once');
  assert.ok(!files.some(file=>file.issues.some(issue=>/limit/.test(issue))));
});
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
