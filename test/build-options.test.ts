import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverBuildEntries } from '../src/build-discovery';
import { extractStaticBuildOptions } from '../src/build-options';
import { buildFixture } from './build-fixtures';

const makeEntry = { id: 'repair', rootUri: 'file:///p', entryUri: 'file:///p/Makefile', cwdUri: 'file:///p', dialect: 'make' as const, args: [], evidence: [] };
for (const compiler of ['gcc', 'dcc']) {
  test(`${compiler}: quoted Make conditions select the active compile options`, async () => {
    const f = buildFixture({ Makefile: `CC=${compiler}\nMODE=A\nifeq "$(MODE)" "A"\nFLAGS=-DACTIVE\nelse\nFLAGS=-DWRONG\nendif\na.o: a.c\n\t$(CC) $(FLAGS) -c $<\n` });
    const p = await extractStaticBuildOptions(f.fs, makeEntry, ['file:///p/a.c'], {});
    assert.deepEqual(p.units.map(u => u.argv), [[compiler, '-DACTIVE', '-c', 'a.c']]);
    assert.equal(p.units[0].status, 'resolved');
  });
  test(`${compiler}: define preserves command-line variable precedence`, async () => {
    const f = buildFixture({ Makefile: `CC=${compiler}\ndefine FLAGS\n-DNEW\nendef\na.o: a.c\n\t$(CC) $(FLAGS) -c $<\n` });
    const p = await extractStaticBuildOptions(f.fs, { ...makeEntry, args: ['FLAGS=-DCOMMAND'] }, ['file:///p/a.c'], {});
    assert.deepEqual(p.units.map(u => u.argv), [[compiler, '-DCOMMAND', '-c', 'a.c']]);
    assert.equal(p.units[0].status, 'resolved');
  });
  test(`${compiler}: computed Make variable names resolve selected options`, async () => {
    const f = buildFixture({ Makefile: `CC=${compiler}\nMODE=A\nFLAGS_A=-DACTIVE\na.o: a.c\n\t$(CC) $(FLAGS_$(MODE)) -c $<\n` });
    const p = await extractStaticBuildOptions(f.fs, makeEntry, ['file:///p/a.c'], {});
    assert.deepEqual(p.units.map(u => u.argv), [[compiler, '-DACTIVE', '-c', 'a.c']]);
  });
  test(`${compiler}: foreach builds flags with a local loop variable`, async () => {
    const f = buildFixture({ Makefile: `CC=${compiler}\nx=OUTER\nFEATURES=A B\nFLAGS=$(foreach x,$(FEATURES),-D$(x))\na.o: a.c\n\t$(CC) $(FLAGS) -D$(x) -c $<\n` });
    const p = await extractStaticBuildOptions(f.fs, makeEntry, ['file:///p/a.c'], {});
    assert.deepEqual(p.units.map(u => u.argv), [[compiler, '-DA', '-DB', '-DOUTER', '-c', 'a.c']]);
  });
}
test('nested pure Make functions and per-target flags preserve module and inherited defines', async () => {
  const f = buildFixture({Makefile: 'CC=gcc\nNAMES=a.o b.o\nOBJECTS := $(filter-out out/unused.o,$(addprefix out/,$(NAMES)))\nall: $(OBJECTS)\nCFLAGS=-DBASE=1\nout/a.o: CFLAGS := $(CFLAGS) -DMODE=1\nout/b.o: CFLAGS += -DMODE=2\nout/%.o: %.c\n\t$(CC) $(CFLAGS) -c $< -o $@'});
  const p=await extractStaticBuildOptions(f.fs,makeEntry,['file:///p/a.c','file:///p/b.c'],{});
  assert.equal(p.units.length,2);
  assert.deepEqual(p.units.map(u=>u.macroActions.map(a=>a.name+'='+a.replacement)),[['BASE=1','MODE=1'],['BASE=1','MODE=2']]);
  assert.ok(p.units.every(u=>u.membership==='included'&&u.status==='resolved'));
});
test('Make define blocks are lazy and unused shell work does not poison compilation',async()=>{
  const f=buildFixture({Makefile:'define PACKAGE\nNAME := $(shell unsafe-generator)\nendef\nCC=gcc\na.o: a.c\n\t$(CC) -DOK -c $<'});
  const p=await extractStaticBuildOptions(f.fs,makeEntry,['file:///p/a.c'],{});
  assert.equal(p.units[0].status,'resolved');assert.equal(p.units[0].membership,'included');assert.equal(p.issues.length,0);
});
test('metadata generation and direct batch transfer reach Make without mutating disk inputs',async()=>{
  const files={'Build.bat':'PATH=C:\\cygwin64\\bin\ncd source\ndel make.cfg\necho MODE := 1 >> make.cfg\ncd ..\nbuild.bat\nunknown-after-transfer.exe',
    'build.bat':'set PATH=C:\\compiler;%path%\ncompile.bat', 'compile.bat':'make -C source\ncall post.bat\npause', 'post.bat':'setlocal enabledelayedexpansion\nfor /f %%x in (output.txt) do echo %%x',
    'source/make.cfg':'MODE := 2', 'source/Makefile':'include make.cfg\nCC=gcc\na.o: a.c\n\t$(CC) -DMODE=$(MODE) -c $<'};
  const f=buildFixture(files),before=new Map(f.texts);
  const p=await extractStaticBuildOptions(f.fs,{...makeEntry,entryUri:'file:///p/Build.bat',dialect:'cmd'},['file:///p/source/a.c'],{Path:'C:\\system'});
  assert.equal(p.units.length,1);assert.equal(p.units[0].membership,'included');assert.equal(p.units[0].status,'resolved');
  assert.equal(p.units[0].macroActions[0].replacement,'1');assert.deepEqual(f.texts,before);
  assert.ok(!p.issues.some(i=>i.message.includes('unknown-after-transfer')));
  assert.ok(p.issues.some(i=>/Delayed|Unresolved/.test(i.message)),'uninterpreted postprocessing stays visible');
  assert.ok(p.dependencies.some(d=>d.uri.endsWith('/make.cfg')));
});
test('unknown commands before compilation retain uncertainty while postprocessing preserves established facts',async()=>{
  for(const before of [true,false]){
    const f=buildFixture({'build.bat':before?'unknown.exe\nmake':'make\nunknown.exe',Makefile:'CC=gcc\na.o: a.c\n\t$(CC) -c $<'});
    const p=await extractStaticBuildOptions(f.fs,{...makeEntry,entryUri:'file:///p/build.bat',dialect:'cmd'},['file:///p/a.c'],{});
    assert.equal(p.units[0].membership,before?'unknown':'included');
  }
});
test('generated artifact recipes retain unavailable-output notices without erasing known compile flags',async()=>{
  const f=buildFixture({Makefile:'CC=gcc\nall: a.o\na.o: a.c | generated.h\n\t$(CC) -DMODE=1 -c $<\ngenerated.h:\n\tsh gen.sh > $@'});
  const p=await extractStaticBuildOptions(f.fs,makeEntry,['file:///p/a.c'],{});
  assert.equal(p.units[0].membership,'included');assert.equal(p.units[0].macroActions[0].replacement,'1');
  assert.ok(p.issues.some(i=>i.code==='unresolved-artifact'));
});
test('pure path and substitution functions resolve module paths and configuration',async()=>{
  const f=buildFixture({Makefile:'CC=gcc\nDIRS := $(sort $(dir out/b.o out/a.o))\nD := $(DIRS:/=)\nNAME := $(notdir module/board)\nall: a.o\na.o: a.c\n\t$(CC) -I$(D) -DNAME=$(NAME) -DUP=$(shell basename board | tr [a-z] [A-Z]) -c $<'});
  const p=await extractStaticBuildOptions(f.fs,makeEntry,['file:///p/a.c'],{});
  assert.equal(p.units[0].status,'resolved');assert.equal(p.units[0].includeSearch[0].uri,'file:///p/out');
  assert.deepEqual(p.units[0].macroActions.map(a=>a.replacement),['board','BOARD']);
});
test('an unresolved target option does not downgrade a sibling compile unit',async()=>{
  const f=buildFixture({Makefile:'CC=gcc\nall: a.o b.o\na.o: CFLAGS = $(shell unknown-generator)\nb.o: CFLAGS = -DMODE=2\n%.o: %.c\n\t$(CC) $(CFLAGS) -c $<'});
  const p=await extractStaticBuildOptions(f.fs,makeEntry,['file:///p/a.c','file:///p/b.c'],{});
  const b=p.units.find(u=>u.sourceUri.endsWith('/b.c'))!;
  assert.equal(b.membership,'included');assert.equal(b.status,'resolved');
  assert.equal(b.macroActions[0].replacement,'2');assert.ok(p.issues.length>0);
});
test('sequential target-specific immediate assignments use the preceding target value',async()=>{
  const f=buildFixture({Makefile:'CC=gcc\nCFLAGS=-DGLOBAL\nall: a.o\na.o: CFLAGS := -DFIRST\na.o: CFLAGS := $(CFLAGS) -DSECOND\n%.o: %.c\n\t$(CC) $(CFLAGS) -c $<'});
  const p=await extractStaticBuildOptions(f.fs,makeEntry,['file:///p/a.c'],{});
  assert.deepEqual(p.units[0].macroActions.map(a=>a.name),['FIRST','SECOND']);
});
test('oversized pure functions and unsupported shell effects remain bounded and unresolved',async()=>{
  for(const expression of ['$(addprefix '+ 'x'.repeat(4000) +','+'a '.repeat(1000)+')','$(shell touch must-not-run)','$(shell cat settings;touch must-not-run)']){
    const f=buildFixture({Makefile:`CC=gcc\nFLAGS := ${expression}\na.o: a.c\n\t$(CC) $(FLAGS) -c $<`});
    const p=await extractStaticBuildOptions(f.fs,makeEntry,['file:///p/a.c'],{});
    assert.ok(p.issues.some(i=>/limit|expression/.test(i.code)));assert.equal(p.units.length,0);
  }
});
test('nested functions and combinatorial Make filters obey extraction limits',async()=>{
  for(const expression of ['$(strip '.repeat(100)+'x'+')'.repeat(100),`$(filter ${Array.from({length:200},(_,n)=>'p'+n).join(' ')},${Array.from({length:200},(_,n)=>'q'+n).join(' ')})`]){
    const f=buildFixture({Makefile:`CC=gcc\nFLAGS := ${expression}\na.o: a.c\n\t$(CC) $(FLAGS) -c $<`});
    const p=await extractStaticBuildOptions(f.fs,makeEntry,['file:///p/a.c'],{});
    assert.ok(p.issues.some(i=>i.code==='extraction-limited'));assert.ok(p.units.every(u=>u.membership!=='included'));
  }
});
test('reassigning an exported shell variable keeps it exported for Make',async()=>{
  const f=buildFixture({'build.sh':'export MODE=1\nMODE=2\nmake',Makefile:'CC=gcc\na.o: a.c\n\t$(CC) -DMODE=$(MODE) -c $<'});
  const p=await extractStaticBuildOptions(f.fs,{...makeEntry,entryUri:'file:///p/build.sh',dialect:'sh'},['file:///p/a.c'],{});
  assert.equal(p.units[0].macroActions[0].replacement,'2');
});
test('unknown generator commands retain the effect on later recursive Make invocations',async()=>{
  const f=buildFixture({Makefile:'all:\n\tcustom-generator flags.mk\n\t$(MAKE) -f child.mk','child.mk':'CC=gcc\na.o: a.c\n\t$(CC) -DMODE=1 -c $<'});
  const p=await extractStaticBuildOptions(f.fs,makeEntry,['file:///p/a.c'],{});
  assert.equal(p.units[0].membership,'unknown');
});
test('cmd generated metadata follows case-insensitive Windows file names',async()=>{
  const f=buildFixture({'build.bat':'del make.cfg\necho MODE := 1 >> make.cfg\nmake',
    'make.cfg':'MODE := 2',Makefile:'include MAKE.CFG\nCC=gcc\na.o: a.c\n\t$(CC) -DMODE=$(MODE) -c $<'});
  const fs={...f.fs,readText:async(uri:string)=>[...f.texts].find(([name])=>name.toLowerCase()===uri.toLowerCase())?.[1]};
  const p=await extractStaticBuildOptions(fs,{...makeEntry,entryUri:'file:///p/build.bat',dialect:'cmd'},['file:///p/a.c'],{});
  assert.equal(p.units[0].macroActions[0].replacement,'1');
});
test('only referenced environment variables are retained as build dependencies',async()=>{
  const f=buildFixture({Makefile:'CC=gcc\na.o: a.c\n\t$(CC) -DMODE=$(MODE) -c $<'});
  const p=await extractStaticBuildOptions(f.fs,makeEntry,['file:///p/a.c'],{MODE:'1',UNUSED:'value'});
  assert.deepEqual(p.relevantEnvironment,['MODE']);
});
test('exact target flags take precedence over later pattern-specific defaults',async()=>{
  const f=buildFixture({Makefile:'CC=gcc\nall: a.o\na.o: CFLAGS = -DEXACT\n%.o: CFLAGS = -DPATTERN\n%.o: %.c\n\t$(CC) $(CFLAGS) -c $<'});
  const p=await extractStaticBuildOptions(f.fs,makeEntry,['file:///p/a.c'],{});
  assert.deepEqual(p.units[0].macroActions.map(a=>a.name),['EXACT']);
});
test('read-only product-name transforms track input files without executing a shell',async()=>{
  const text=String.raw`CC=gcc
NAME := $(shell sed 's/[\t ]//g' product.txt | tr -d \\n)
all: a.o
a.o: a.c
\t$(CC) -DPRODUCT=$(NAME) -c $<`.replace('\n\\t','\n\t');
  const f=buildFixture({Makefile:text,'product.txt':'A B\tC\n'});
  const p=await extractStaticBuildOptions(f.fs,makeEntry,['file:///p/a.c'],{});
  assert.equal(p.units[0].macroActions[0].replacement,'ABC');assert.equal(p.units[0].status,'resolved');
  assert.ok(p.dependencies.some(d=>d.uri.endsWith('/product.txt')));
});

test('root script and multiple module includes provide per-file commands, not nearby unrelated flags', async () => {
  const f = buildFixture({ 'build.sh': 'export BOARD=A\nmake -f Makefile BOARD=$BOARD',
    Makefile: 'CC := arm-none-eabi-gcc\nall: a.o b.o\ninclude config/common.mk\ninclude App/a/module.mk App/b/module.mk',
    'config/common.mk': 'CPPFLAGS := -DBOARD_$(BOARD) -Iinclude',
    'App/a/module.mk': 'AFLAGS := -DMODE=1\na.o: App/a/a.c\n\t$(CC) $(CPPFLAGS) $(AFLAGS) -c $< -o $@',
    'App/b/module.mk': 'BFLAGS := -DMODE=2\nb.o: App/b/b.c\n\t$(CC) $(CPPFLAGS) $(BFLAGS) -c $< -o $@',
    'App/a/unrelated.mk': 'CPPFLAGS := -DWRONG' });
  const sources = ['file:///p/App/a/a.c', 'file:///p/App/b/b.c'];
  const found = await discoverBuildEntries(f.fs, { rootUri: 'file:///p', sourceUris: sources });
  const entry = found.entries.find(e => e.entryUri.endsWith('/build.sh'))!;
  const profile = await extractStaticBuildOptions(f.fs, entry, sources, {});
  assert.equal(profile.units.length, 2);
  assert.deepEqual(profile.units.map(u => u.macroActions.filter(a => a.name === 'MODE').map(a => a.replacement)), [['1'], ['2']]);
  assert.ok(profile.units.every(u => u.macroActions.some(a => a.name === 'BOARD_A')));
  assert.ok(!f.reads.some(u => u.endsWith('unrelated.mk')));
  assert.ok(profile.dependencies.some(d => d.uri.endsWith('/config/common.mk')));
});
test('Make include paths use invocation cwd and static recursive variables preserve flavor', async () => {
  const f = buildFixture({ Makefile: 'CC=gcc\nA=$(B)\nB=1\nS:=$(B)\nB=2\ninclude cfg/flags.mk\na.o: a.c\n\t$(CC) -DLATE=$(A) -DEARLY=$(S) $(CFLAGS) -c $<', 'cfg/flags.mk': 'CFLAGS += -DOK' });
  const entry = { id: 'x', rootUri: 'file:///p', entryUri: 'file:///p/Makefile', cwdUri: 'file:///p', dialect: 'make' as const, args: [], evidence: [] };
  const profile = await extractStaticBuildOptions(f.fs, entry, ['file:///p/a.c'], {});
  assert.deepEqual(profile.units[0].macroActions.map(a => a.replacement), ['2', '1', '1']);
});
test('dynamic shell expressions are never executed and do not become resolved settings', async () => {
  const f = buildFixture({ Makefile: 'CC=gcc\nCFLAGS=$(shell touch should-never-exist)\na.o: a.c\n\t$(CC) $(CFLAGS) -c $<' });
  const entry = { id: 'x', rootUri: 'file:///p', entryUri: 'file:///p/Makefile', cwdUri: 'file:///p', dialect: 'make' as const, args: [], evidence: [] };
  const profile = await extractStaticBuildOptions(f.fs, entry, ['file:///p/a.c'], {});
  assert.equal(profile.coverage, 'partial');
  assert.ok(profile.issues.some(i => i.code === 'unsupported-expression'));
  assert.ok(profile.units.every(u => u.status !== 'resolved'));
});

test('selected target and pattern recipes retain command variables and output identity', async () => {
  const f = buildFixture({ Makefile: 'CC=gcc\nMODE=0\nall: a.o b.o\n%.o: %.c\n\t$(CC) -DMODE=$(MODE) -c $< -o $@' });
  const entry = { id: 'x', rootUri: 'file:///p', entryUri: 'file:///p/Makefile', cwdUri: 'file:///p', dialect: 'make' as const, args: ['b.o', 'MODE=3'], evidence: [] };
  const profile = await extractStaticBuildOptions(f.fs, entry, ['file:///p/a.c', 'file:///p/b.c'], {});
  assert.equal(profile.units.length, 1); assert.equal(profile.units[0].sourceUri, 'file:///p/b.c');
  assert.equal(profile.units[0].macroActions[0].replacement, '3');
  assert.equal(profile.units[0].outputUri, 'file:///p/b.o');
});

test('source script changes and cmd call settings flow back to their callers', async () => {
  for (const dialect of ['sh', 'cmd'] as const) {
    const f = buildFixture(dialect === 'sh' ? { 'build.sh': '. ./env.sh\nmake -f Makefile', 'env.sh': 'export MODE=4', Makefile: 'CC=gcc\na.o: a.c\n\t$(CC) -DMODE=$(MODE) -c $<' }
      : { 'build.bat': 'call env.bat\nmake -f Makefile', 'env.bat': 'set MODE=4', Makefile: 'CC=gcc\na.o: a.c\n\t$(CC) -DMODE=$(MODE) -c $<' });
    const entry = { id: dialect, rootUri: 'file:///p', entryUri: `file:///p/build.${dialect === 'sh' ? 'sh' : 'bat'}`, cwdUri: 'file:///p', dialect, args: [], evidence: [] };
    const profile = await extractStaticBuildOptions(f.fs, entry, ['file:///p/a.c'], {});
    assert.equal(profile.units[0].macroActions[0].replacement, '4');
  }
});
test('unexported shell variables do not leak into Make environment',async()=>{
  const f=buildFixture({'build.sh':'MODE=4\nmake -f Makefile',Makefile:'CC=gcc\na.o: a.c\n\t$(CC) -DMODE=$(MODE) -c $<'});
  const entry={id:'x',rootUri:'file:///p',entryUri:'file:///p/build.sh',cwdUri:'file:///p',dialect:'sh' as const,args:[],evidence:[]};
  const profile=await extractStaticBuildOptions(f.fs,entry,['file:///p/a.c'],{});
  assert.equal(profile.units[0].macroActions[0].replacement,'');
});
test('continued Make options keep the real recipe source line',async()=>{
  const f=buildFixture({Makefile:'CC=gcc\nCFLAGS=-DA=1 \\\n -DB=2\na.o: a.c\n\t$(CC) $(CFLAGS) -c $<'});
  const entry={id:'x',rootUri:'file:///p',entryUri:'file:///p/Makefile',cwdUri:'file:///p',dialect:'make' as const,args:[],evidence:[]};
  const profile=await extractStaticBuildOptions(f.fs,entry,['file:///p/a.c'],{});
  assert.equal(profile.units[0].evidence.at(-1)!.line,4);
  assert.deepEqual(profile.units[0].macroActions.map(a=>a.name),['A','B']);
});
test('echo redirection and compound commands cannot silently supply a resolved build',async()=>{
  const f=buildFixture({'build.sh':'echo "-DMODE=2" > flags\nmake -f Makefile',Makefile:'CC=gcc\na.o: a.c\n\t$(CC) -DMODE=1 -c $<'});
  const entry={id:'x',rootUri:'file:///p',entryUri:'file:///p/build.sh',cwdUri:'file:///p',dialect:'sh' as const,args:[],evidence:[]};
  const profile=await extractStaticBuildOptions(f.fs,entry,['file:///p/a.c'],{});
  assert.equal(profile.units[0].status,'partial');assert.equal(profile.units[0].membership,'unknown');
});
test('recursive Make preserves command overrides without exporting unrelated file variables',async()=>{
  const f=buildFixture({Makefile:'CC=gcc\nCFLAGS=-DLEAK=1\nall:\n\t$(MAKE) -f child.mk', 'child.mk':'CC=gcc\nMODE=0\na.o: a.c\n\t$(CC) $(CFLAGS) -DMODE=$(MODE) -c $<'});
  const entry={id:'x',rootUri:'file:///p',entryUri:'file:///p/Makefile',cwdUri:'file:///p',dialect:'make' as const,args:['MODE=2'],evidence:[]};
  const profile=await extractStaticBuildOptions(f.fs,entry,['file:///p/a.c'],{});
  assert.deepEqual(profile.units[0].macroActions,[{kind:'define',name:'MODE',replacement:'2'}]);
});
test('Make variable multiplication is bounded before it creates oversized compile arguments',async()=>{
  const f=buildFixture({Makefile:'CC=gcc\nA='+'x'.repeat(4000)+'\nB='+'$(A)'.repeat(20)+'\nC='+'$(B)'.repeat(20)+'\na.o: a.c\n\t$(CC) -DLARGE=$(C) -c $<'});
  const entry={id:'x',rootUri:'file:///p',entryUri:'file:///p/Makefile',cwdUri:'file:///p',dialect:'make' as const,args:[],evidence:[]};
  const profile=await extractStaticBuildOptions(f.fs,entry,['file:///p/a.c'],{});
  assert.ok(profile.issues.some(issue=>issue.code==='extraction-limited'));
  assert.ok(profile.units.every(unit=>unit.status!=='resolved'));
});
test('implicit Makefile lookup observes the same input size limit as explicit includes',async()=>{
  const f=buildFixture({'build.sh':'make',Makefile:'#'+'x'.repeat(1_048_576)+'\nCC=gcc\na.o: a.c\n\t$(CC) -c $<'});
  const entry={id:'x',rootUri:'file:///p',entryUri:'file:///p/build.sh',cwdUri:'file:///p',dialect:'sh' as const,args:[],evidence:[]};
  const profile=await extractStaticBuildOptions(f.fs,entry,['file:///p/a.c'],{});
  assert.ok(profile.issues.some(issue=>issue.code==='file-limited'));
  assert.equal(profile.units.length,0);
});
test('uninterpreted inherited Make control flags cannot silently establish source membership',async()=>{
  const f=buildFixture({Makefile:'CC=gcc\nMODE=1\na.o: a.c\n\t$(CC) -DMODE=$(MODE) -c $<'});
  const entry={id:'x',rootUri:'file:///p',entryUri:'file:///p/Makefile',cwdUri:'file:///p',dialect:'make' as const,args:[],evidence:[]};
  const profile=await extractStaticBuildOptions(f.fs,entry,['file:///p/a.c'],{MAKEFLAGS:'MODE=2'});
  assert.ok(profile.issues.some(issue=>issue.code==='unsupported-make-environment'));
  assert.equal(profile.units[0].membership,'unknown');
});

test('foreach preserves empty iteration separators used by quoted conditions', async () => {
  const f = buildFixture({Makefile:'CC=gcc\nifeq "$(foreach x,A B,$(if $(filter B,$(x)),B))" " B"\nFLAGS=-DOK\nelse\nFLAGS=-DWRONG\nendif\na.o: a.c\n\t$(CC) $(FLAGS) -c $<'});
  const p=await extractStaticBuildOptions(f.fs,makeEntry,['file:///p/a.c'],{});
  assert.deepEqual(p.units[0].macroActions.map(a=>a.name),['OK']);
});
test('inactive unsupported statements do not poison the selected conditional branch', async () => {
  const f=buildFixture({Makefile:'CC=gcc\nifeq (A,B)\noverride FLAGS=-DWRONG\nelse ifeq "A" "A"\nFLAGS=-DOK\nendif\na.o: a.c\n\t$(CC) $(FLAGS) -c $<'});
  const p=await extractStaticBuildOptions(f.fs,makeEntry,['file:///p/a.c'],{});
  assert.equal(p.units[0].status,'resolved');assert.deepEqual(p.units[0].macroActions.map(a=>a.name),['OK']);
});
test('computed variables retain cycles and foreach retains evaluation limits', async () => {
  for(const expression of ['$(FLAGS_$(MODE))','$(foreach x,'+'a '.repeat(10_000)+',$(foreach y,A B C D E,-D$(x)$(y)))']) {
    const f=buildFixture({Makefile:`CC=gcc\nMODE=A\nFLAGS_A=$(FLAGS_$(MODE))\nFLAGS=${expression}\na.o: a.c\n\t$(CC) $(FLAGS) -c $<`});
    const p=await extractStaticBuildOptions(f.fs,makeEntry,['file:///p/a.c'],{});
    assert.ok(p.issues.length);assert.equal(p.units.length,0);
  }
});

test('computed assignment names cannot silently drop compile options', async () => {
  const f=buildFixture({Makefile:'CC=gcc\nMODE=A\nFLAGS_$(MODE)=-DSELECTED\na.o: a.c\n\t$(CC) $(FLAGS_A) -c $<'});
  const p=await extractStaticBuildOptions(f.fs,makeEntry,['file:///p/a.c'],{});
  assert.ok(p.units[0]?.macroActions.some(a=>a.name==='SELECTED') || p.units[0]?.status!=='resolved');
});
