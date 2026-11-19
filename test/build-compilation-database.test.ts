import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractStaticBuildOptions} from '../src/build-options';
import {BuildMetadataCache,discoverBuildEntries} from '../src/build-discovery';
import {buildEntryDialect} from '../src/build-context';
import {buildFixture} from './build-fixtures';

const entry={id:'database',rootUri:'file:///p',entryUri:'file:///p/compile_commands.json',cwdUri:'file:///p',dialect:'compilation-database' as const,args:[],evidence:[]};
const command=(extra:Record<string,unknown>={})=>({directory:'/p',file:'app/a.c',arguments:['gcc','-DMODE=1','-c','app/a.c'],...extra});
async function profile(records:unknown,files:Record<string,string>={}) {
  const fixture=buildFixture({'compile_commands.json':JSON.stringify(records),...files});
  return extractStaticBuildOptions(fixture.fs,entry,['file:///p/app/a.c'],{});
}

test('compilation databases are discovered at source ancestors and explicitly below build directories',async()=>{
  const fixture=buildFixture({'compile_commands.json':'[]','app/compile_commands.json':'[]','build/compile_commands.json':'[]','app/a.c':''});
  const result=await discoverBuildEntries(fixture.fs,{rootUri:'file:///p',sourceUris:['file:///p/app/a.c'],explicitEntryUri:'file:///p/build/compile_commands.json'});
  assert.equal(result.entries.length,3);
  assert.ok(result.entries.every(e=>e.dialect==='compilation-database'&&e.cwdUri===e.entryUri.slice(0,e.entryUri.lastIndexOf('/'))));
  assert.equal(buildEntryDialect('file:///p/compile_commands.json'),'compilation-database');
});
test('argv is literal and preferred over command; database absence never proves source exclusion',async()=>{
  const p=await profile([command({arguments:['gcc','-DVALUE=$HOME;literal','-c','app/a.c'],command:'do not execute this'})]);
  assert.equal(p.units.length,1);assert.equal(p.units[0].membership,'included');
  assert.equal(p.units[0].macroActions[0].replacement,'$HOME;literal');
  assert.equal(p.coverage,'partial');assert.ok(!p.units.some(u=>u.sourceUri.endsWith('/unrecorded.c')));
});
test('command quoting, working directories and paths with spaces retain their meaning',async()=>{
  const p=await profile([{directory:'/p/build dir',file:'../app/a.c',command:'gcc "-DMESSAGE=hello world" -I../inc -c ../app/a.c',output:'a.o'}]);
  assert.equal(p.units[0].sourceUri,'file:///p/app/a.c');assert.equal(p.units[0].cwdUri,'file:///p/build%20dir');
  assert.equal(p.units[0].macroActions[0].replacement,'hello world');assert.equal(p.units[0].includeSearch[0].uri,'file:///p/inc');
  assert.equal(p.units[0].outputUri,'file:///p/build%20dir/a.o');
});
test('multiple configurations for the same source stay separate and response inputs are dependencies',async()=>{
  const p=await profile([command(),command({arguments:['gcc','@flags.rsp','-c','app/a.c']})],{'flags.rsp':'-DMODE=2 -Iinc'});
  assert.equal(p.units.length,2);assert.notEqual(p.units[0].id,p.units[1].id);
  assert.deepEqual(p.units.map(u=>u.macroActions[0].replacement),['1','2']);
  assert.ok(p.dependencies.some(d=>d.uri==='file:///p/flags.rsp'));
});
test('unsupported compiler options keep compile membership separate from preprocessing certainty',async()=>{
  const p=await profile([command({arguments:['arm-none-eabi-gcc','-funknown-option','-c','app/a.c']}),command({file:'other.c',arguments:['unknown-compiler','other.c']})]);
  assert.equal(p.units[0].status,'partial');assert.equal(p.units[0].membership,'included');
  assert.equal(p.units[1].membership,'unknown');
});
test('malformed records and shell commands cannot fabricate verified membership',async()=>{
  const p=await profile([null,{},command({arguments:[3]}),{directory:'/p',file:'app/a.c',command:'gcc -c app/a.c;touch /tmp/never'},
    {directory:'/p',file:'app/a.c',command:'gcc $FLAGS -c app/a.c'},command({output:5}),command()]);
  assert.equal(p.units.length,1);assert.ok(p.issues.length>=6);assert.equal(p.coverage,'partial');
  const invalid=buildFixture({'compile_commands.json':'invalid'});
  const broken=await extractStaticBuildOptions(invalid.fs,entry,[],{});
  assert.equal(broken.units.length,0);assert.ok(broken.issues.some(i=>i.code==='invalid-compilation-database'));
  assert.equal((await profile({})).units.length,0);
});
test('Windows and remote WSL paths retain their host namespace',async()=>{
  const windows=await profile([{directory:'C:\\project',file:'src\\a.c',arguments:['gcc','-c','src\\a.c']}]);
  assert.equal(windows.units[0].sourceUri,'file:///C:/project/src/a.c');assert.equal(windows.units[0].dialect,'windows');
  const uri='vscode-remote://wsl+ubuntu/home/project/compile_commands.json';
  const fs={readText:async(name:string)=>name===uri?JSON.stringify([{directory:'/home/project',file:'a.c',arguments:['gcc','-c','a.c']}]):undefined,list:async()=>[]};
  const remote=await extractStaticBuildOptions(fs,{...entry,rootUri:'vscode-remote://wsl+ubuntu/home/project',entryUri:uri},[],{});
  assert.equal(remote.units[0].sourceUri,'vscode-remote://wsl+ubuntu/home/project/a.c');
});
test('database edits invalidate cached profiles and discovery',async()=>{
  const f=buildFixture({'compile_commands.json':JSON.stringify([command()])}),cache=new BuildMetadataCache(f.fs);
  const first=await cache.profile(entry,[],{});
  f.texts.set(entry.entryUri,JSON.stringify([command({arguments:['gcc','-DMODE=2','-c','app/a.c']})]));
  assert.equal(cache.invalidate(entry.entryUri),true);
  const next=await cache.profile(entry,[],{});assert.notEqual(next.fingerprint,first.fingerprint);
  assert.equal(next.units[0].macroActions[0].replacement,'2');
});

test('Windows command quoting yields the same compile context as literal arguments', async () => {
  const record = {directory: 'C:\\project', file: 'a.c'};
  const args = ['gcc', '-DNAME="hello"', '-DTEXT="two & words"', '-IC:\\inc dir\\', '-c', 'a.c'];
  const literal = await profile([{...record, arguments: args}]);
  const parsed = await profile([{...record, command: String.raw`gcc -DNAME=\"hello\" "-DTEXT=\"two & words\"" "-IC:\inc dir\\" -c a.c`}]);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.units, literal.units);
});

test('compilation database resolves filesystem percent and question marks literally', async () => {
  const p = await profile([{directory:'/p/100%', file:'a?b.c', output:'out/a%23.o',
    arguments:['gcc','-Iinc?#','@flags%20.rsp','-c','a?b.c']}], {'100%25/flags%2520.rsp':'-DMODE=2'});
  assert.equal(p.units.length, 1);
  const [unit] = p.units;
  assert.equal(unit.sourceUri, 'file:///p/100%25/a%3Fb.c');
  assert.equal(unit.outputUri, 'file:///p/100%25/out/a%2523.o');
  assert.equal(unit.includeSearch[0].uri, 'file:///p/100%25/inc%3F%23');
  assert.equal(unit.macroActions[0].replacement, '2');
  assert.equal(unit.status, 'resolved');
});
