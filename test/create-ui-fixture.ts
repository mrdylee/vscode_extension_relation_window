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
  const graph = index.graph(target.id, 'references', 1), expandedGraph = index.graph(target.id, 'references', 2);
  index.update(analyzer.analyze('file:///demo/outgoing.c', '#define CHECK() check_fault(0)\nvoid outgoing(void (*handler)(void), struct Ops *ops){\ncheck_fault(1);\ncheck_fault(2);\nCHECK();\nhandler();\nops->run();\nmissing();\n}'));
  const outgoing = index.symbols().find(s => s.name === 'outgoing')!;
  const calleeGraph = index.graph(outgoing.id, 'callees', 2);
  index.update(analyzer.analyze('file:///demo/members.c', 'typedef struct { int state; } Motor;\ntypedef struct { int state; } Sensor;\nvoid motor_run(Motor *m){m->state=1;}\nvoid sensor_run(Sensor *s){s->state++;}\nvoid start(Motor *m){motor_run(m);}\n'));
  const motorField = index.symbols().find(s => s.containerName === 'Motor' && s.name === 'state')!;
  const memberGraph = index.graph(motorField.id, 'callees', 2);
  const macroFiles = analyzer.derive([
    analyzer.analyze('file:///demo/macro.c', '#include "macro.h"\nvoid leaf(void){} void macro_target(int x){leaf();}\nvoid macro_run(void){WRAP(7);}\n'),
    analyzer.analyze('file:///demo/macro.h', '#ifndef MACRO_H\n#define MACRO_H\n#define CALL(x) macro_target(x)\n#define WRAP(x) CALL(x)\n#endif\n')
  ]);
  macroFiles.forEach(file => index.update(file));
  const macroGraph = index.graph(index.symbols().find(s => s.name === 'macro_run')!.id, 'callees', 2);
  analyzer.derive([analyzer.analyze('file:///demo/pointer.c', 'typedef void (*CB)(void);\nvoid callback_leaf(void){} void callback_target(void){callback_leaf();}\nstruct CallbackOps{CB run;};struct CallbackOps callbacks={.run=callback_target};\nvoid pointer_run(void){callbacks.run();}\n')]).forEach(file=>index.update(file));
  const pointerGraph = index.graph(index.symbols().find(s => s.name === 'pointer_run')!.id, 'callees', 2);
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/ui-fixture.json', JSON.stringify({ graph, expandedGraph, calleeGraph, macroGraph, pointerGraph, memberGraph, variableGraphs, files: [...index.files.values()].map(file => ({ ...file, tokens: highlightC(file.text) })) }));
}
void main();
