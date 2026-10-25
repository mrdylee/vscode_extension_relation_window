import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCompileContext } from '../src/build-context';
import { maskInactive, preparePreprocessorContext } from '../src/preprocessor-context';
import { AnalysisWorkBudget } from '../src/analysis-budget';
import { buildFixture } from './build-fixtures';

async function prepare(text: string, args: string[] = [], files: Record<string, string> = {}, allowed: (uri: string) => boolean = () => true) {
  const f = buildFixture(files);
  const unit = await normalizeCompileContext({ profileId: 'A', sourceUri: 'file:///p/a.c', cwdUri: 'file:///p', argv: ['gcc', ...args, '-c', 'a.c'], dialect: 'posix', evidence: [] }, f.fs);
  const result = await preparePreprocessorContext(unit, f.fs, text, { workBudget: new AnalysisWorkBudget(), eligibleHeader: allowed });
  return { ...f, result };
}
test('inactive masks preserve UTF-16 offsets and CRLF', () => {
  const text = 'a😀\r\nwrong();\r\nz';
  const masked = maskInactive(text, [{ start: 5, end: 15 }]);
  assert.equal(masked.length, text.length); assert.equal(masked.slice(0, 5), text.slice(0, 5));
  assert.equal(masked.indexOf('z'), text.indexOf('z'));
  assert.ok(!masked.includes('wrong'));
});
test('defined zero, source redefine and undef use the environment at each position', async () => {
  const source = '#ifdef FLAG\nvoid defined_zero(){}\n#endif\n#if FLAG\nvoid wrong(){}\n#endif\n#undef FLAG\n#define FLAG 1\n#if FLAG\nvoid active(){}\n#endif';
  const { result } = await prepare(source, ['-DFLAG=0']);
  const masked = result.occurrences.at(-1)!.maskedText;
  assert.ok(masked.includes('defined_zero')); assert.ok(!masked.includes('wrong'));
  assert.ok(masked.includes('void active')); assert.equal(masked.length, source.length);
});
test('unknown builtins and unknown conditional redefinitions remain uncertain', async () => {
  const text = '#define X 0\n#if __UNKNOWN__\n#undef X\n#define X 1\n#endif\n#if X\nvoid yes(){}\n#else\nvoid no(){}\n#endif';
  const { result } = await prepare(text);
  const masked = result.occurrences.at(-1)!.maskedText;
  assert.ok(masked.includes('void yes')); assert.ok(masked.includes('void no'));
});
test('include search order and returned header defines affect following source', async () => {
  const { result } = await prepare('#include "config.h"\n#if MODE==1\nvoid yes(){}\n#else\nvoid wrong(){}\n#endif', ['-Ione', '-Itwo'],
    { 'one/config.h': '#define MODE 1', 'two/config.h': '#define MODE 2' });
  assert.equal(result.occurrences.length, 2);
  assert.equal(result.occurrences[0].uri, 'file:///p/one/config.h');
  assert.ok(!result.occurrences.at(-1)!.maskedText.includes('wrong'));
  assert.ok(result.missingCandidates.includes('file:///p/config.h'));
});
test('excluded header is not read and cannot be skipped in favor of a later matching header', async () => {
  const { result, reads } = await prepare('#include "config.h"\n#if MODE\nvoid yes(){}\n#else\nvoid no(){}\n#endif', ['-Ione', '-Itwo'],
    { 'one/config.h': '#define MODE 1', 'two/config.h': '#define MODE 0' }, uri => !uri.includes('/one/'));
  assert.ok(!reads.includes('file:///p/one/config.h')); assert.ok(!reads.includes('file:///p/two/config.h'));
  assert.ok(result.issues.some(i => i.code === 'header-out-of-scope'));
  assert.ok(result.occurrences.at(-1)!.maskedText.includes('void yes'));
  assert.ok(result.occurrences.at(-1)!.maskedText.includes('void no'));
});
test('a conventional guard prevents repeated definitions even when its initial value is unknown',async()=>{
  const {result}=await prepare('#include "guard.h"\n#include "guard.h"',[],{'guard.h':'#ifndef GUARD_H\n#define GUARD_H\nstatic void guarded(void){}\n#endif'});
  const headers=result.occurrences.filter(file=>file.uri.endsWith('/guard.h'));
  assert.equal(headers.filter(file=>file.maskedText.includes('void guarded')).length,1);
});
test('idirafter cannot bypass unknown compiler default search directories',async()=>{
  const {result,reads}=await prepare('#include <config.h>\n#if MODE\nvoid yes(){}\n#else\nvoid no(){}\n#endif',['-idirafter','after'],{'after/config.h':'#define MODE 1'});
  assert.ok(!reads.includes('file:///p/after/config.h'));
  assert.ok(result.occurrences.at(-1)!.maskedText.includes('void no'));
});
test('angle header names preserve literal spaces',async()=>{
  const {result}=await prepare('#include <a b.h>', ['-Ione'], {'one/a b.h':'#define FOUND 1'});
  assert.ok(result.occurrences.some(file=>file.uri==='file:///p/one/a%20b.h'));
});
