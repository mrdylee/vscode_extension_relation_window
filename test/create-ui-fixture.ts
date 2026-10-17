import { createAnalyzer } from '../src/analyzer';
import { RelationIndex } from '../src/relations';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { highlightC } from '../src/syntax';
async function main() {
  const analyzer = await createAnalyzer(path.resolve('dist/web-tree-sitter.wasm'), path.resolve('dist/tree-sitter-c.wasm'));
  const index = new RelationIndex();
  for (const name of ['fault.c', 'fault.h', 'control.c']) index.update(analyzer.analyze('file:///demo/' + name, await readFile('examples/demo/' + name, 'utf8')));
  const target = index.symbols().find(s => s.name === 'check_fault' && s.definition)!;
  index.update(analyzer.analyze('file:///demo/variable-access.c', await readFile('test/fixtures/variable-access.c', 'utf8')));
  const variable = index.symbols().find(s => s.name === 'state')!;
  const variableGraphs = Object.fromEntries((['all', 'read', 'write', 'readwrite', 'address'] as const).map(filter => [filter, index.graph(variable.id, 'callers', 2, {}, filter)]));
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/ui-fixture.json', JSON.stringify({ graph: index.graph(target.id, 'references', 1), expandedGraph: index.graph(target.id, 'references', 2), variableGraphs, files: [...index.files.values()].map(file => ({ ...file, tokens: highlightC(file.text) })) }));
}
void main();
