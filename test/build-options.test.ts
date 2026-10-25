import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverBuildEntries } from '../src/build-discovery';
import { extractStaticBuildOptions } from '../src/build-options';
import { buildFixture } from './build-fixtures';

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
