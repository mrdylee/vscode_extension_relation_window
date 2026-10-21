import assert from 'node:assert/strict';
import path from 'node:path';
import { createAnalyzer } from '../../src/analyzer';
import { RelationIndex } from '../../src/relations';

async function main() {
  const analyzer = await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'), path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm'));
  const fields = (n: number) => Array.from({ length: n }, (_, i) => `int status${i};`).join('');
  const repeat = (n: number, item: (i: number) => string) => Array.from({ length: n }, (_, i) => item(i)).join('');
  const anchor = 'typedef void(*CB)(void);static void target(void){}static CB cb=target;void run(void){cb();}';
  const globals = `struct Data{${fields(270)}};static struct Data data;`;
  const writes = (n: number, start = 0) => repeat(n, i => `data.status${i + start}=0;`);
  const logs = (object = 'data') => `void log_int(int);void logger(void){${repeat(270, i => `log_int(${object}.status${i});`)}}`;
  const addresses = (n: number) => repeat(n, i => `opaque(&data.status${i});`);
  const cases: { name: string; source: string; expected: string[]; probeIncomplete?: boolean }[] = [
    { name: '270-unread-global-writes', source: `${globals}void heavy(void){${writes(270)}}`, expected: [] },
    { name: '256-logged-global-writes', source: `${globals}${logs()}void heavy(void){${writes(256)}}`, expected: [] },
    { name: '257-logged-global-writes', source: `${globals}${logs()}void heavy(void){${writes(257)}}`, expected: [] },
    { name: '270-writes-logger-never-called', source: `${globals}${logs()}void heavy(void){${writes(270)}}`, expected: [] },
    { name: '270-writes-unrelated-struct-same-member-names', source: `${globals}struct Other{${fields(270)}};static struct Other other;${logs('other')}void heavy(void){${writes(270)}}`, expected: [] },
    { name: '270-writes-unrelated-struct-different-member-names', source: `${globals}struct Other{int unrelated;};static struct Other other;void log_int(int);void logger(void){log_int(other.unrelated);}void heavy(void){${writes(270)}}`, expected: [] },
    { name: '270-logged-local-writes', source: `struct Data{${fields(270)}};void log_int(int);void heavy(void){struct Data data;${writes(270)}${repeat(270, i => `log_int(data.status${i});`)}}`, expected: [] },
    { name: '270-repeated-writes-one-logged-field', source: `${globals}${logs()}void heavy(void){${repeat(270, () => 'data.status0=0;')}}`, expected: [] },
    { name: 'two-135-effect-helpers', source: `${globals}${logs()}void a(void){${writes(135)}}void b(void){${writes(135, 135)}}void heavy(void){a();b();}`, expected: [] },
    { name: 'two-135-effect-branches', source: `${globals}${logs()}void heavy(int flag){if(flag){${writes(135)}}else{${writes(135, 135)}}}`, expected: [] },
    { name: '256-opaque-field-addresses', source: `${globals}void opaque(void*);void heavy(void){${addresses(256)}}`, expected: [] },
    { name: '257-opaque-field-addresses', source: `${globals}void opaque(void*);void heavy(void){${addresses(257)}}`, expected: [] },
    { name: '270-repeated-opaque-one-field', source: `${globals}void opaque(void*);void heavy(void){${repeat(270, () => 'opaque(&data.status0);')}}`, expected: [] },
    { name: 'parent-address-only', source: `${globals}void opaque(void*);void heavy(void){opaque(&data);}`, expected: [] },
    { name: 'parent-then-255-child-addresses', source: `${globals}void opaque(void*);void heavy(void){opaque(&data);${addresses(255)}}`, expected: [] },
    { name: 'parent-then-256-child-addresses', source: `${globals}void opaque(void*);void heavy(void){opaque(&data);${addresses(256)}}`, expected: [] },
    { name: '256-child-addresses-then-parent', source: `${globals}void opaque(void*);void heavy(void){${addresses(256)}opaque(&data);}`, expected: [] },
    { name: '270-field-addresses-known-empty-body', source: `${globals}void opaque(void*p){}void heavy(void){${addresses(270)}}`, expected: [] },
    { name: '270-field-addresses-const-prototype', source: `${globals}void opaque(const int*);void heavy(void){${addresses(270)}}`, expected: [] },
    ...[256, 257].map(n => ({ name: `${n}-logged-writes-helper-with-unrelated-callback-argument`, source: `${globals}${logs()}struct Ops{CB cb;};void heavy(struct Ops*p){${writes(n)}}void probe(void){struct Ops x={target};heavy(&x);x.cb();}`, expected: [], probeIncomplete: false })),
  ];
  for (const item of cases) {
    analyzer.reset();
    const raw = analyzer.analyze(`file:///budget-audit/${item.name}.c`, anchor + item.source);
    assert.deepEqual(raw.issues, [], item.name + ': parse issues');
    const files = analyzer.derive([raw], undefined, undefined, true);
    const diagnostics = files.flatMap(file => file.callbackDiagnostics ?? []);
    const kinds = [...new Set(diagnostics.map(d => d.message.includes('mutation limit') ? 'mutation' : d.message.includes('region limit') ? 'region' : d.message))].sort();
    const index = new RelationIndex();
    files.forEach(file => index.update(file));
    const run = index.symbols().find(s => s.kind === 'function' && s.name === 'run')!;
    console.log(JSON.stringify({ name: item.name, limits: kinds, diagnostics: diagnostics.map(d => ({ symbol: d.symbol, stage: d.stage })), callbacks: index.relations(run.id, 'callees').filter(g => g.callKind === 'inferred').map(g => ({ name: g.name, incomplete: g.sites.some(s => s.inference?.incomplete) })) }));
    assert.deepEqual(kinds, item.expected, item.name);
    if (item.probeIncomplete !== undefined) {
      const probe = index.symbols().find(s => s.kind === 'function' && s.name === 'probe')!;
      const probeCalls = index.relations(probe.id, 'callees');
      const indirect = probeCalls.filter(g => g.callKind === 'indirect');
      const targets = probeCalls.filter(g => g.callKind === 'inferred').map(g => g.name);
      console.log(JSON.stringify({ probe: item.name, inferredTargets: targets, unresolvedCallbacks: indirect.map(g => g.sites.map(s => s.inference)) }));
      assert.equal(indirect.length > 0, item.probeIncomplete, item.name + ': callback argument');
      assert.deepEqual(targets, item.probeIncomplete ? [] : ['target'], item.name + ': inferred target');
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
