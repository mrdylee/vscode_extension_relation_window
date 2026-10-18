import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createAnalyzer } from '../src/analyzer';
import { RelationIndex } from '../src/relations';

let analyzer: Awaited<ReturnType<typeof createAnalyzer>>;
before(async () => { analyzer = await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'), path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm')); });
function project(sources: Record<string, string>) {
  const files = Object.entries(sources).map(([name, text]) => analyzer.analyze('file:///demo/' + name, text));
  const index = new RelationIndex();
  for (const file of analyzer.derive(files)) index.update(file);
  return index;
}
const calls = (index: RelationIndex, name = 'run') => index.relations(index.symbols().find(s => s.name === name && s.kind === 'function' && s.definition)!.id, 'callees');

test('include traversal is bounded even when repeated headers produce no macro events', () => {
  const sources: Record<string, string> = { 'main.c': '#include "h18.h"\nvoid target(void){} void run(void){target();}', 'h0.h': '' };
  for (let n = 1; n <= 18; n++) sources[`h${n}.h`] = `#include "h${n-1}.h"\n#include "h${n-1}.h"\n`;
  const index = project(sources), file = index.files.get('file:///demo/main.c')!;
  assert.ok(file.issues.some(issue => /Macro include.*limit/.test(issue)));
  const target = calls(index).find(group => group.name === 'target'); assert.ok(target);
  assert.ok(target.sites.every(site => site.ambiguous && site.inference?.incomplete));
});

test('incomplete include environments retain source calls without fabricated expansions', () => {
  const sources: Record<string, string> = { 'main.c': '#define CALL() stale_target()\n#include "h18.h"\n#undef CALL\n#define CALL() actual_target()\nvoid stale_target(void){}void actual_target(void){}void run(void){CALL();}', 'h0.h': '' };
  for (let n = 1; n <= 18; n++) sources[`h${n}.h`] = `#include "h${n-1}.h"\n#include "h${n-1}.h"\n`;
  const index = project(sources), file = index.files.get('file:///demo/main.c')!;
  assert.ok(file.issues.some(issue => /Macro include.*limit/.test(issue)));
  assert.equal(file.references.some(ref => ref.expansion), false);
  assert.ok(file.references.some(ref => ref.name === 'CALL' && ref.kind === 'call' && ref.inference?.incomplete));
});

test('limited include results reuse cache identity and recover after header edits', () => {
  const sources: Record<string, string> = { 'main.c': '#define CALL() target()\n#include "h18.h"\nvoid target(void){}void run(void){CALL();}', 'h0.h': '' };
  for (let n = 1; n <= 18; n++) sources[`h${n}.h`] = `#include "h${n-1}.h"\n#include "h${n-1}.h"\n`;
  const raw = Object.entries(sources).map(([name, text]) => analyzer.analyze('file:///demo/' + name, text));
  const limited = analyzer.derive(raw);
  assert.ok(limited[0].issues.some(issue => /Macro include.*limit/.test(issue)));
  assert.equal(analyzer.derive(raw)[0], limited[0]);
  const edited = raw.map(file => file.uri.endsWith('/h18.h') ? analyzer.analyze(file.uri, '') : file);
  const recovered = analyzer.derive(edited)[0];
  assert.equal(recovered.issues.some(issue => /Macro include.*limit/.test(issue)), false);
  assert.ok(recovered.references.some(ref => ref.name === 'target' && ref.expansion));
});

test('existing include-depth limits preserve previously supported macro expansions', () => {
  const sources: Record<string, string> = { 'main.c': '#define CALL() target()\n#include "h65.h"\nvoid target(void){}void run(void){CALL();}', 'h0.h': '' };
  for (let n = 1; n <= 65; n++) sources[`h${n}.h`] = `#include "h${n-1}.h"\n`;
  const index = project(sources), file = index.files.get('file:///demo/main.c')!;
  assert.ok(file.issues.some(issue => /Macro include\/event limit/.test(issue)));
  assert.ok(calls(index).some(group => group.name === 'target' && group.callKind === 'expanded'));
});

test('source sorting interleaves expanded, direct and inferred calls at their original sites', () => {
  const source = '#define EARLY() zulu()\ntypedef void (*CB)(void); void alpha(void){} void beta(void){} void zulu(void){} void run(void){EARLY();beta();CB cb=alpha;cb();zulu();EARLY();}';
  const index = project({ 'main.c': source });
  const run = index.symbols().find(s => s.name === 'run')!;
  const groups = index.relations(run.id, 'callees', 'all', 'source');
  assert.deepEqual(groups.map(g => g.name), ['zulu', 'beta', 'alpha']);
  assert.deepEqual(groups[0].sites.map(s => s.location.start), [source.indexOf('EARLY();'), source.indexOf('zulu();'), source.lastIndexOf('EARLY();')]);
  assert.equal(groups[2].callKind, 'inferred');
});

test('macro expansion creates outgoing and incoming calls at the original invocation', () => {
  const source = '#define CALL(x) foo(x)\nvoid foo(int x){} void run(void){CALL(1);}';
  const index = project({ 'main.c': source });
  const call = calls(index).find(g => g.name === 'foo')!;
  assert.ok(call); assert.equal(call.callKind, 'expanded');
  assert.equal(call.sites[0].location.start, source.indexOf('CALL(1)'));
  assert.equal(call.sites[0].expansion!.chain[0].name, 'CALL');
  assert.equal(index.relations(call.symbol!.id, 'callers')[0].name, 'run');
});
test('nested macros, aliases and repeated invocation sites expand without duplicate raw calls', () => {
  const source = '#define INNER(x) foo(x)\n#define OUTER(x) INNER(x)\n#define ALIAS OUTER\nvoid foo(int x){} void run(void){ALIAS(1);OUTER(2);}';
  const index = project({ 'main.c': source });
  const call = calls(index).find(g => g.name === 'foo')!;
  assert.equal(call.sites.length, 2);
  assert.equal(call.sites[0].expansion!.chain.map(s => s.name).join(' → '), 'ALIAS → OUTER → INNER');
});
test('discarded, stringized and unevaluated macro arguments are not executed calls', () => {
  const source = '#define IGNORE(x) 0\n#define STR(x) #x\n#define SIZE(x) sizeof(x)\n#define EXEC(x) sink(x)\nvoid foo(void){} void sink(int x){} void run(void){IGNORE(foo());STR(foo());SIZE(foo());EXEC(foo());}';
  const index = project({ 'main.c': source });
  const call = calls(index).find(g => g.name === 'foo')!;
  assert.equal(call.sites.length, 1);
  assert.equal(call.sites[0].location.start, source.lastIndexOf('foo()'));
  assert.ok(calls(index).some(g => g.name === 'sink'));
});

test('token pasting, stringizing, variadics and nested argument prescan follow C token rules', () => {
  const source = '#define CAT(a,b) a##b\n#define CALL(n, ...) CAT(do_,n)(__VA_ARGS__)\n#define LOG(...) sink(0 __VA_OPT__(,) __VA_ARGS__)\nvoid do_work(int x){} void sink(int x,...){} void run(void){CALL(work,1);LOG();LOG(2,3);}';
  const index = project({ 'main.c': source });
  assert.ok(calls(index).some(g => g.name === 'do_work'));
  assert.equal(calls(index).find(g => g.name === 'sink')!.sites.length, 2);
});
test('header definitions, undef and redefinitions obey source order', () => {
  const source = '#include "api.h"\nvoid run(void){CALL();}\n#undef CALL\n#define CALL() bar()\nvoid second(void){CALL();}';
  const index = project({ 'main.c': source, 'api.h': '#include "types.h"', 'types.h': '#define CALL() foo()\nvoid foo(void){} void bar(void){}' });
  assert.deepEqual(calls(index).map(g => g.name), ['foo']);
  assert.deepEqual(calls(index, 'second').map(g => g.name), ['bar']);
  const before = project({ 'main.c': 'void foo(void){} void run(void){CALL();}\n#define CALL() foo()' });
  assert.equal(calls(before).some(g => g.name === 'foo'), false);
});
test('multiline macros parse statements without inventing prototype or sizeof calls', () => {
  const source = '#define CALL() do { \\\n void declared(void); \\\n foo(); sizeof(hidden()); \\\n } while(0)\nvoid foo(void){} void run(void){CALL();}';
  const index = project({ 'main.c': source });
  assert.deepEqual(calls(index).map(g => g.name), ['foo']);
});
test('unknown macro branches remain candidates and inactive branches stay excluded', () => {
  const source = '#if BOARD\n#define CALL() foo()\n#else\n#define CALL() bar()\n#endif\nvoid foo(void){} void bar(void){} void run(void){CALL();\n#if 0\nCALL();hidden();\n#endif\n}';
  const index = project({ 'main.c': source });
  const known = calls(index).filter(g => ['foo','bar'].includes(g.name));
  assert.deepEqual(known.map(g => g.name).sort(), ['bar', 'foo']);
  assert.ok(known.every(g => g.sites.length === 1 && g.sites[0].conditions.length));
  assert.equal(calls(index).some(g => g.name === 'hidden'), false);
});
test('macro arguments retain nested comma expressions and comments or string literals do not call', () => {
  const source = '#define CALL(x) foo(x)\n#define TEXT "fake()" /* ghost() */\nvoid foo(int x){} void nested(int a,int b){} void run(void){CALL((nested(1,2),3));TEXT;}';
  const index = project({ 'main.c': source });
  assert.deepEqual(calls(index).map(g => g.name), ['foo','nested']);
});
test('self-recursive and mutually recursive macros terminate with explicit leaves', () => {
  const source = '#define A() B()\n#define B() A()\nvoid run(void){A();}';
  const index = project({ 'main.c': source });
  assert.equal(calls(index).length, 1);
  assert.equal(calls(index)[0].callKind, 'unresolved');
  assert.ok(calls(index)[0].sites[0].expansion);
});
test('re-derivation reflects header edits and removals without stale expanded targets', () => {
  const main = analyzer.analyze('file:///demo/main.c', '#include "api.h"\nvoid foo(void){} void bar(void){} void run(void){CALL();}');
  for (const name of ['foo','bar']) {
    const header = analyzer.analyze('file:///demo/api.h', `#define CALL() ${name}()`);
    const value = new RelationIndex(); for (const file of analyzer.derive([main, header])) value.update(file);
    assert.deepEqual(calls(value).map(g => g.name), [name]);
  }
  const value = new RelationIndex(); for (const file of analyzer.derive([main])) value.update(file);
  assert.equal(calls(value).some(g => ['foo','bar'].includes(g.name)), false);
});
test('ordinary include guards do not create exponential undefined macro alternatives', () => {
  const defines = Array.from({length: 8}, (_, n) => `#define M${n}() foo()`).join('\n');
  const source = '#include "api.h"\nvoid foo(void){} void run(void){' + Array.from({length: 8}, (_, n) => `M${n}();`).join('') + '}';
  const index = project({ 'main.c': source, 'api.h': '#ifndef API_H\n#define API_H\n' + defines + '\n#endif' });
  assert.equal(calls(index).find(g => g.name === 'foo')!.sites.length, 8);
  assert.ok([...index.files.values()].every(file => !file.issues.some(issue => /alternative limit/.test(issue))));
});
test('effective direct calls are not duplicated in References after unrelated macro expansion', () => {
  const source = '#define VALUE 1\nvoid foo(void){} void run(void){int x=VALUE;foo();}';
  const index = project({ 'main.c': source });
  const foo = index.symbols().find(s => s.name === 'foo' && s.definition)!;
  assert.equal(index.relations(foo.id, 'references')[0].sites.length, 1);
});
test('GNU variadic comma removal and exponential numeric literals remain valid expanded C', () => {
  const source = '#define LOG(fmt, ...) sink(fmt, ##__VA_ARGS__)\nvoid sink(int x,...){} void run(void){LOG(1);LOG(2,1e+3);}';
  const index = project({ 'main.c': source });
  assert.equal(calls(index).find(g => g.name === 'sink')!.sites.length, 2);
  assert.equal(index.files.get('file:///demo/main.c')!.issues.length, 0);
});
test('spliced strings containing a hash are not mistaken for directives', () => {
  const source = '#define CALL() foo()\nvoid foo(void){} void run(void){char *s="abc\\\n#fake()";CALL();}';
  const index = project({ 'main.c': source });
  assert.deepEqual(calls(index).map(g => g.name), ['foo']);
  assert.equal(index.files.get('file:///demo/main.c')!.issues.length, 0);
});
test('unchanged translation units reuse derived results when an unrelated file changes', () => {
  const main = analyzer.analyze('file:///demo/main.c', '#include "api.h"\nvoid foo(void){} void run(void){CALL();}');
  const header = analyzer.analyze('file:///demo/api.h', '#define CALL() foo()');
  const first = analyzer.derive([main, header, analyzer.analyze('file:///demo/other.c', 'void unrelated(void){}')]);
  const next = analyzer.derive([main, header, analyzer.analyze('file:///demo/other.c', 'void unrelated(void){missing();}')]);
  assert.equal(next[0], first[0]);
});
test('undefined and not-yet-defined macros do not mask real functions or become active leaves', () => {
  const source = '#define CALL foo\n#undef CALL\nvoid CALL(void){} void run(void){CALL();LATER();}\n#define LATER() foo()';
  const index = project({ 'main.c': source });
  assert.deepEqual(calls(index).map(g => [g.name,g.callKind]), [['CALL','direct'], ['LATER','unresolved']]);
});
test('unrelated translation-unit macro definitions do not resolve another files calls', () => {
  const index = project({ 'main.c': 'void run(void){OTHER();}', 'other.c': '#define OTHER() foo()\n' });
  assert.deepEqual(calls(index).map(g => [g.name,g.callKind]), [['OTHER','unresolved']]);
});
test('self-wrapping macros call the real same-named function after rescan suppression', () => {
  const source = 'void foo(int x){}\n#define foo(x) foo(x)\nvoid run(void){foo(1);}';
  const index = project({ 'main.c': source });
  assert.deepEqual(calls(index).map(g => [g.name,g.callKind]), [['foo','expanded']]);
});
test('source selection retains conditional macro definitions even when an unexpanded alternative remains', () => {
  const source = '#if BOARD\n#include "a.h"\n#else\n#include "b.h"\n#endif\nvoid run(void){READY();}';
  const index = project({ 'main.c': source, 'a.h': '#define READY() 1', 'b.h': '#define READY() 2' });
  assert.equal(index.resolveAt('file:///demo/main.c', source.indexOf('READY()')).length, 2);
});
test('bounded expansion reports a limit instead of silently claiming all targets', () => {
  const definitions = Array.from({length: 36}, (_, n) => `#define A${n}() ${n === 35 ? 'foo()' : `A${n + 1}()`}`).join('\n');
  const index = project({ 'main.c': definitions + '\nvoid foo(void){} void run(void){A0();}' });
  assert.ok(index.files.get('file:///demo/main.c')!.issues.some(issue => /Macro expansion limit/.test(issue)));
  assert.equal(calls(index).some(g => g.name === 'foo'), false);
});
