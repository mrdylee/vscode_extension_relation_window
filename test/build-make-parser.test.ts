import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMakefile } from '../src/build-make-parser';

const uri = 'file:///p/Makefile';
test('Make syntax preserves conditional branches, target selectors and definition flavor', async () => {
  const result = await parseMakefile('ifeq "$(MODE)" "A"\nX=1\nY=2\nelse ifneq ($(MODE),B)\nX=3\nelse\nX=4\nendif\na.o: FLAGS += -DLOCAL\ndefine FLAGS :=\n-DONE\n-DTWO\nendef\n', uri);
  assert.equal(result.length, 3);
  const condition = result[0];
  assert.equal(condition.kind, 'condition');
  if (condition.kind !== 'condition') return;
  assert.deepEqual(condition.branches.map(b => [b.operator, b.left, b.right, b.body.length]), [
    ['ifeq', '$(MODE)', 'A', 2], ['ifneq', '$(MODE)', 'B', 1], [undefined, undefined, undefined, 1]
  ]);
  assert.equal(result[1].kind, 'assignment');
  if (result[1].kind === 'assignment') assert.equal(result[1].targets, 'a.o');
  assert.equal(result[2].kind, 'assignment');
  if (result[2].kind === 'assignment') {
    assert.equal(result[2].operator, ':=');
    assert.equal(result[2].value, '-DONE\n-DTWO');
  }
});

test('Make syntax retains inline recipes, order-only prerequisites and original locations', async () => {
  const result = await parseMakefile('# note\r\n-include optional.mk\r\na.o: a.c | generated.h; $(CC) -c $<', uri);
  assert.equal(result[0].kind, 'include');
  if (result[0].kind === 'include') assert.equal(result[0].optional, true);
  assert.equal(result[1].kind, 'rule');
  if (result[1].kind !== 'rule') return;
  assert.equal(result[1].prerequisites, 'a.c');
  assert.equal(result[1].orderOnly, 'generated.h');
  assert.equal(result[1].recipes[0].text, '$(CC) -c $<');
  assert.equal(result[1].recipes[0].evidence.line, 2);
});

test('Make assignment comments and continuations retain escaped hash and value spacing', async () => {
  const result = await parseMakefile('FLAGS = -DA \\\n  -DHASH=\\#x # comment\n', uri);
  assert.equal(result[0].kind, 'assignment');
  if (result[0].kind === 'assignment') assert.equal(result[0].value, '-DA -DHASH=#x ');
});

test('empty Make input is empty and unsupported rule semantics remain explicit', async () => {
  assert.deepEqual(await parseMakefile('', uri), []);
  for (const source of ['a.o:: a.c\n\tgcc -c $<\n', 'a.o b.o &: a.c\n\tgcc -c $<\n', '.RECIPEPREFIX=>\n', 'VPATH=src\n', 'load extension.so\n']) {
    const result = await parseMakefile(source, uri);
    assert.ok(result.some(s => s.kind === 'unsupported'), source);
  }
});

test('malformed conditions cannot become resolved ordinary statements', async () => {
  const result = await parseMakefile('ifeq (A,B)\nX=1\n', uri);
  assert.ok(result.some(s => s.kind === 'unsupported' && s.code === 'make-syntax-error'));
});

test('Make substitution references permit empty replacements', async () => {
  const result = await parseMakefile('DIRS=out/\nD := $(DIRS:/=)\n', uri);
  assert.equal(result[1].kind, 'assignment');
  if (result[1].kind === 'assignment') assert.equal(result[1].value, '$(DIRS:/=)');
});

test('Make parser returns independent plain data across repeated extractions', async () => {
  for (let n = 0; n < 100; n++) {
    const result = await parseMakefile(`MODE=${n}\n`, uri);
    assert.equal(result[0].kind, 'assignment');
    if (result[0].kind === 'assignment') assert.equal(result[0].value, String(n));
  }
});

test('Make syntax extraction bounds oversized files and statement counts', async () => {
  for (const source of ['#'.repeat(1_048_577), 'X=1\n'.repeat(20_001)]) {
    const result = await parseMakefile(source, uri);
    assert.ok(result.some(s => s.kind === 'unsupported' && /limited/.test(s.code)));
  }
});

test('standalone packaged Make parser loads its sibling assets and reports missing or corrupt grammar', async () => {
  const { build } = await import('esbuild');
  const { mkdtemp, copyFile, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const scratch = await mkdtemp(join(tmpdir(), 'make-package-'));
  try {
    await build({ entryPoints: ['src/build-make-parser.ts'], outfile: join(scratch, 'parser.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['web-tree-sitter/web-tree-sitter.wasm'], define: { 'import.meta.url': 'moduleUrl' }, banner: { js: 'const moduleUrl = require("node:url").pathToFileURL(__filename).href;' } });
    await copyFile('node_modules/web-tree-sitter/web-tree-sitter.wasm', join(scratch, 'web-tree-sitter.wasm'));
    const parse = () => JSON.parse(execFileSync(process.execPath, ['-e', "require('./parser.cjs').parseMakefile('X=1\\n','file:///Makefile').then(r=>console.log(JSON.stringify(r)))"], {cwd:scratch, encoding:'utf8'}));
    assert.equal(parse()[0].code, 'make-parser-unavailable');
    await writeFile(join(scratch, 'tree-sitter-make.wasm'), 'invalid wasm');
    assert.equal(parse()[0].code, 'make-parser-unavailable');
    await copyFile('vendor/tree-sitter-make/tree-sitter-make.wasm', join(scratch, 'tree-sitter-make.wasm'));
    const valid = parse(); assert.equal(valid[0].kind, 'assignment', JSON.stringify(valid));
  } finally { await rm(scratch, {recursive:true, force:true}); }
});
