import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { RelationIndex } from '../src/relations';
import { FileAnalysis } from '../src/model';

function fixture(uri: string, count: number): FileAnalysis {
  const location = { uri, start: 0, end: 6, line: 0, column: 0, endLine: 0, endColumn: 6 };
  const symbol = { id: `${uri}#0`, name: 'caller', kind: 'function' as const, definition: true,
    storage: 'static' as const, location, extent: location, conditions: [], pointer: false };
  return { uri, text: '', symbols: [symbol], includes: [], issues: [], references: Array.from({ length: count }, (_, n) => ({
    id: `${uri}@${n + 10}`, name: 'target', kind: 'call' as const, ownerId: symbol.id,
    location: { ...location, start: n + 10, end: n + 16 }, conditions: []
  })) };
}
const samples = [];
for (const count of [10000, 20000, 40000]) {
  const index = new RelationIndex(), file = fixture('file:///hot.c', count);
  const started = performance.now(); index.update(file);
  const addMs = performance.now() - started;
  const replacement = fixture(file.uri, count / 2);
  const edited = performance.now(); index.update(replacement);
  const replaceMs = performance.now() - edited;
  assert.equal(index.files.get(file.uri)!.references.length, count / 2);
  index.remove(file.uri); assert.equal(index.symbols().length, 0);
  samples.push({ references: count, addMs, replaceMs });
}
// More files than the reported 12,297-file workspace, with common symbol names.
const index = new RelationIndex();
let totalUpdateMs = 0, maxUpdateMs = 0;
for (let n = 0; n < 12500; n++) {
  const file = fixture(`file:///large/${n}.c`, 10);
  const started = performance.now(); index.update(file);
  const elapsed = performance.now() - started;
  totalUpdateMs += elapsed; maxUpdateMs = Math.max(maxUpdateMs, elapsed);
}
assert.equal(index.files.size, 12500);
const changed = fixture('file:///large/6000.c', 20);
const started = performance.now(); index.update(changed);
const editMs = performance.now() - started;
assert.equal(index.files.get(changed.uri)!.references.length, 20);
const result = { platform: process.platform, node: process.version, samples,
  manyFiles: { files: index.files.size, references: 125010, totalUpdateMs, maxUpdateMs, editMs } };
mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/index-performance.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
