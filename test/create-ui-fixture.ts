import { createAnalyzer } from '../src/analyzer';
import { RelationIndex } from '../src/relations';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { highlightC } from '../src/syntax';
import { analysisNotices } from '../src/analysis-notices';
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
  analyzer.derive([analyzer.analyze('file:///demo/registration.c', 'void registration_target(void){}\nvoid registration_run(void){void (*fp)(void)=registration_target;}\n')], undefined, undefined, false).forEach(file => index.update(file));
  const registrationGraph = index.graph(index.symbols().find(s => s.name === 'registration_run')!.id, 'callees', 1);
  const pointerFile = index.files.get('file:///demo/pointer.c')!;
  const callback = index.callbackAt(pointerFile.uri, pointerFile.text.indexOf('callbacks.run()') + 'callbacks.'.length);
  index.update(analyzer.analyze('file:///demo/navigation.c', 'void nav_leaf(void){} void alpha(void){nav_leaf();} void zulu(void){} void pivot(void){zulu();alpha();zulu();} void entry(void){pivot();} void launch(void){entry();}'));
  const pivot = index.symbols().find(s => s.name === 'pivot')!;
  const navigation = { both: index.graph(pivot.id, 'both', 1), bothExpanded: index.graph(pivot.id, 'both', 2),
    name: index.graph(pivot.id, 'callees', 1), source: index.graph(pivot.id, 'callees', 1, {}, 'all', 'source') };
  analyzer.derive([analyzer.analyze('file:///demo/arguments.c', 'typedef void (*CB)(void);\nvoid arg_leaf(void){}\nvoid arg_target(void){arg_leaf();}\nvoid arg_svc(CB cb);\nvoid arg_origin(void){arg_svc(arg_target);}\nvoid arg_mixed(void){arg_svc(arg_target);arg_target();}\n')]).forEach(file => index.update(file));
  const argumentGraph = index.graph(index.symbols().find(s => s.name === 'arg_origin')!.id, 'callees', 2, {}, 'all', 'source', true);
  const argumentBothGraph = index.graph(index.symbols().find(s => s.name === 'arg_target')!.id, 'both', 1, {}, 'all', 'name', true);
  const limitFile = analyzer.analyze('file:///demo/limits.c', 'void target(void){}void(*data[300])(void);void update(void){'+Array.from({length:270},(_,n)=>`data[${n}]=target;`).join('\n')+'}void run(void){void(*cb)(void)=target;cb();}');
  const limitNotices = analysisNotices(analyzer.derive([limitFile]), uri => uri.replace('file:///demo/', ''));
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/ui-fixture.json', JSON.stringify({ limitNotices, graph, expandedGraph, calleeGraph, macroGraph, pointerGraph, registrationGraph, callback, memberGraph, variableGraphs, navigation, argumentGraph, argumentBothGraph, files: [...index.files.values()].map(file => ({ ...file, tokens: highlightC(file.text) })) }));
}
void main();
