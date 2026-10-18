import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createAnalyzer } from '../src/analyzer';
import { RelationIndex } from '../src/relations';

let analyzer: Awaited<ReturnType<typeof createAnalyzer>>;
before(async () => { analyzer = await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'), path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm')); });
const parse = (text: string, uri = 'file:///demo/a.c', skip = true) => analyzer.analyze(uri, text, skip);
function index(files: Record<string, string>) {
  const value = new RelationIndex();
  for (const [file, text] of Object.entries(files)) value.update(parse(text, `file:///demo/${file}`));
  return value;
}
test('Callees groups direct and unresolved calls with exact sites, not address references', () => {
  const source = 'int read(void){return 1;} void task(void){int value=read(); read(); missing(); void *p=&read;} void entry(void){task();}';
  const value = index({ 'a.c': source });
  const task = value.symbols().find(s => s.name === 'task')!;
  const groups = value.relations(task.id, 'callees');
  assert.deepEqual(groups.map(g => [g.name, g.callKind, g.sites.length]), [['missing', 'unresolved', 1], ['read', 'direct', 2]]);
  assert.equal(groups[1].sites[0].location.start, source.indexOf('read();'));
  assert.equal(groups[1].sites[0].access, undefined, 'outgoing calls are not variable reads');
  assert.deepEqual(value.relations(task.id, 'callers').map(g => g.name), ['entry']);
});
test('optional source sorting follows first calls at every depth and preserves incoming name order', () => {
  const source = 'void alpha(void){inside_z();inside_a();} void zulu(void){} void run(void){zulu();alpha();zulu();missing();} void zebra(void){run();} void aardvark(void){run();}';
  const value = index({ 'a.c': source });
  const run = value.symbols().find(s => s.name === 'run')!;
  assert.deepEqual(value.relations(run.id, 'callees').map(g => g.name), ['alpha', 'missing', 'zulu']);
  const graph = value.graph(run.id, 'callees', 2, {}, 'all', 'source')!;
  assert.deepEqual(graph.root.children.map(n => n.name), ['zulu', 'alpha', 'missing']);
  assert.deepEqual(graph.root.children[1].children.map(n => n.name), ['inside_z', 'inside_a']);
  assert.equal(graph.root.children[0].sites.length, 2);
  assert.deepEqual(value.relations(run.id, 'callers', 'all', 'source').map(g => g.name), ['aardvark', 'zebra']);
});
test('both-direction graphs have a single root with independent caller and callee expansion', () => {
  const value = index({ 'a.c': 'void leaf(void){} void next(void){leaf();} void run(void){next();run();} void entry(void){run();} void launch(void){entry();}' });
  const run = value.symbols().find(s => s.name === 'run')!;
  const graph = value.graph(run.id, 'both', 1)!;
  assert.deepEqual(graph.root.children.map(n => n.name), ['next', 'run']);
  assert.deepEqual(graph.callers!.map(n => n.name), ['entry', 'run']);
  assert.ok(graph.root.children.find(n => n.name === 'run')!.cycle);
  assert.ok(graph.callers!.find(n => n.name === 'run')!.cycle);
  const entry = graph.callers![0], next = graph.root.children[0];
  assert.equal(new Set([...graph.callers!, ...graph.root.children].map(n => n.key)).size, 4);
  const expanded = value.graph(run.id, 'both', 1, { [entry.key]: 1, [next.key]: 1 })!;
  assert.equal(expanded.callers![0].children[0].name, 'launch');
  assert.equal(expanded.root.children[0].children[0].name, 'leaf');
  const collapsed = value.graph(run.id, 'both', 2, { [entry.key]: 0 })!;
  assert.equal(collapsed.callers![0].children.length, 0);
  assert.equal(collapsed.root.children[0].children[0].name, 'leaf');
  const closed = value.graph(run.id, 'both', 2, { root: 0 })!;
  assert.deepEqual(closed.root.children, []); assert.deepEqual(closed.callers, []);
});
test('both-direction graphs share the 300-node budget and retain both sides', () => {
  const source = Array.from({ length: 200 }, (_, i) => `void leaf${i}(void){}`).join('')
    + 'void root(void){' + Array.from({ length: 200 }, (_, i) => `leaf${i}();`).join('') + '}'
    + Array.from({ length: 200 }, (_, i) => `void entry${i}(void){root();}`).join('');
  const value = index({ 'a.c': source });
  const graph = value.graph(value.symbols().find(s => s.name === 'root')!.id, 'both', 1)!;
  assert.equal(1 + graph.root.children.length + graph.callers!.length, 300);
  assert.ok(graph.root.children.length >= 149 && graph.callers!.length >= 149);
  assert.equal(graph.truncated, true);
});
test('Callees resolves static scope and retains conditional candidates', () => {
  const value = index({ 'a.c': 'static void helper(void){} void task(void){helper();}', 'b.c': 'static void helper(void){}',
    'c.c': '#if BOARD\nvoid target(void){}\n#endif', 'd.c': 'void target(void){}', 'use.c': 'void use(void){target();}' });
  const task = value.symbols().find(s => s.name === 'task')!;
  assert.ok(value.relations(task.id, 'callees')[0].symbol!.location.uri.endsWith('a.c'));
  const use = value.symbols().find(s => s.name === 'use')!;
  const candidates = value.relations(use.id, 'callees');
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every(g => g.sites[0].ambiguous));
});
test('Callees shows macro and indirect leaves without inventing function targets', () => {
  const value = index({ 'a.c': '#define CHECK() target()\nvoid target(void){} void handler(void){} void task(void (*handler)(void), struct Ops *ops){CHECK();handler();(*handler)();ops->run();}' });
  const task = value.symbols().find(s => s.name === 'task')!;
  const graph = value.graph(task.id, 'callees', 4)!;
  assert.deepEqual(graph.root.children.map(n => [n.name, n.callKind]).sort(),
    [['CHECK', 'macro'], ['handler', 'indirect'], ['(*handler)', 'indirect'], ['ops->run', 'indirect']].sort());
  assert.ok(graph.root.children.every(n => n.children.length === 0));
  assert.equal(graph.root.children.find(n => n.name === 'handler')!.kind, 'variable');
});
test('Callees handles depth, repeated expansion and recursive paths', () => {
  const value = index({ 'a.c': 'void c(void){} void b(void){c();} void a(void){b();a();}' });
  const a = value.symbols().find(s => s.name === 'a')!;
  const one = value.graph(a.id, 'callees', 1)!;
  const b = one.root.children.find(n => n.name === 'b')!;
  assert.equal(b.children.length, 0);
  assert.ok(one.root.children.find(n => n.name === 'a')!.cycle);
  assert.equal(value.graph(a.id, 'callees', 1, { [b.key]: 1 })!.root.children.find(n => n.name === 'b')!.children[0].name, 'c');
});
test('Callees excludes inactive and unevaluated calls and preserves unknown conditions', () => {
  const value = index({ 'a.c': 'void task(void){\n#if 0\ndisabled();\n#endif\n#if BOARD\nmaybe();\n#endif\nsizeof(hidden()); sizeof((*ptr)()); outer(inner());}' });
  const task = value.symbols().find(s => s.name === 'task')!;
  const groups = value.relations(task.id, 'callees');
  assert.deepEqual(groups.map(g => g.name), ['inner', 'maybe', 'outer']);
  assert.ok(groups.find(g => g.name === 'maybe')!.sites[0].conditions.length);
});
test('Callees updates only changed file owners and resolves target changes on demand', () => {
  const value = index({ 'a.c': 'void task(void){target();}', 'b.c': 'void target(void){}', 'untouched.c': 'void other(void){target();}' });
  const task = value.symbols().find(s => s.name === 'task')!;
  Object.defineProperty(value.files.get('file:///demo/untouched.c')!, 'references', { get() { throw new Error('unrelated file scanned'); } });
  assert.equal(value.relations(task.id, 'callees')[0].callKind, 'direct');
  value.remove('file:///demo/b.c');
  assert.equal(value.relations(task.id, 'callees')[0].callKind, 'unresolved');
  value.update(parse('void task(void){new_target();}'));
  assert.deepEqual(value.relations(task.id, 'callees').map(g => g.name), ['new_target']);
  value.remove('file:///demo/a.c');
  assert.deepEqual(value.relations(task.id, 'callees'), []);
});
test('Callees preference preserves variable use and incoming caller traversal', () => {
  const value = index({ 'a.c': 'int state; void writer(void){state=1;} void entry(void){writer();}' });
  const variable = value.symbols().find(s => s.name === 'state')!;
  for (const mode of ['callees', 'both'] as const) {
    const graph = value.graph(variable.id, mode, 2, {}, 'write')!;
    assert.equal(graph.root.children[0].name, 'writer');
    assert.equal(graph.root.children[0].children[0].name, 'entry');
    assert.equal(graph.callers, undefined);
  }
});
test('Callees indirect records do not hide ordinary variable selection', () => {
  const source = 'void task(struct Ops *ops){ops->run();}';
  const value = index({ 'a.c': source });
  assert.equal(value.resolveAt('file:///demo/a.c', source.indexOf('ops->'))[0]?.name, 'ops');
});
test('extracts repeated actual calls and exact Unicode locations, excluding comment/string/declaration', () => {
  const file = parse('void fault(int);\nvoid task(void) { /* 한글 😀 */ fault(1);\n fault(2); /* fault(3); */ const char *s="fault(4)"; }');
  assert.equal(file.symbols.find(s => s.name === 'task')?.kind, 'function');
  const calls = file.references.filter(r => r.kind === 'call');
  assert.deepEqual(calls.map(r => [r.name, r.location.line]), [['fault', 1], ['fault', 2]]);
  assert.equal(calls[0].location.start, file.text.indexOf('fault(1)'));
});
test('filters inactive definitions and nested calls, keeps elif and unknown conditions', () => {
  const source = '#if 0\nvoid old(void) {}\n#endif\nvoid task(void) {\n#if 0\n#if 1\nold();\n#endif\n#elif 1\ncurrent();\n#else\nother();\n#endif\n#if BOARD\na();\n#else\nb();\n#endif\n}';
  const file = parse(source);
  assert.equal(file.symbols.some(s => s.name === 'old'), false);
  assert.deepEqual(file.references.filter(r => r.kind === 'call').map(r => r.name), ['current', 'a', 'b']);
  assert.ok(file.references.find(r => r.name === 'a')!.conditions.length);
  assert.ok(parse(source, 'file:///demo/a.c', false).symbols.some(s => s.name === 'old'));
});
test('file-local static calls never join same-named static functions in another file', () => {
  const value = index({ 'a.c': 'static void helper(void){}\nvoid a(void){helper();}', 'b.c': 'static void helper(void){}\nvoid b(void){helper();}' });
  const a = value.symbols().find(s => s.name === 'helper' && s.location.uri.endsWith('a.c'))!;
  assert.ok(a);
  assert.deepEqual(value.relations(a.id, 'callers').map(g => g.name), ['a']);
});
test('references include declarations and variable tables but callers exclude both', () => {
  const value = index({ 'a.c': 'void fault(void){}\nvoid task(void){fault(); fault();}', 'a.h': 'void fault(void);\nvoid (*handlers[])(void) = { fault };' });
  const fault = value.symbols().find(s => s.name === 'fault' && s.definition)!;
  assert.ok(fault);
  const refs = value.relations(fault.id, 'references');
  assert.ok(refs.some(g => g.name === 'handlers' && g.kind === 'variable'));
  assert.ok(refs.some(g => g.sites.some(s => s.kind === 'declaration')));
  const callers = value.relations(fault.id, 'callers');
  assert.deepEqual(callers.map(g => g.name), ['task']);
  assert.equal(callers[0].sites.length, 2);
});
test('parameter and local pointer shadowing are not calls to a same-named global function', () => {
  const value = index({ 'a.c': 'void fault(void){}\nvoid task(void (*fault)(void)){fault();}\nvoid other(void){void (*fault)(void)=0; fault();}' });
  const fault = value.symbols().find(s => s.name === 'fault' && s.kind === 'function' && s.definition)!;
  assert.ok(fault);
  assert.equal(value.relations(fault.id, 'callers').length, 0);
});
test('graph distinguishes function bodies, prototypes and unowned reference sites', () => {
  const value = index({ 'a.c': 'void fault(void){}\nvoid task(void){fault();}', 'a.h': 'void fault(void);' });
  // An incomplete analysis can retain a reference without its containing symbol.
  const incomplete = parse('void unknown(void){(void)&fault;}', 'file:///demo/incomplete.c');
  incomplete.symbols = [];
  incomplete.references.forEach(ref => { ref.ownerId = undefined; ref.functionId = undefined; });
  value.update(incomplete);
  const definition = value.symbols().find(s => s.name === 'fault' && s.definition)!;
  const declaration = value.symbols().find(s => s.name === 'fault' && !s.definition)!;
  const graph = value.graph(definition.id, 'references', 1)!;
  assert.equal(graph.root.definition, true);
  assert.equal(graph.root.children.find(n => n.name === 'task')!.definition, true);
  assert.equal(graph.root.children.find(n => n.sites[0]?.kind === 'declaration')!.definition, false);
  assert.equal(graph.root.children.find(n => !n.symbolId && n.sites[0]?.kind === 'reference')!.definition, undefined);
  assert.equal(value.graph(declaration.id, 'references', 0)!.root.definition, false);
});
test('ambiguous external definitions remain labelled candidates', () => {
  const value = index({ 'a.c': 'void fault(void){}', 'b.c': 'void fault(void){}', 'use.c': 'void task(void){fault();}' });
  assert.equal(value.resolveAt('file:///demo/use.c', 17).length, 2);
  const fault = value.symbols().find(s => s.name === 'fault')!;
  assert.equal(value.relations(fault.id, 'callers')[0].sites[0].ambiguous, true);
});
test('depth, selected-node expansion, and recursion produce finite graphs', () => {
  const value = index({ 'a.c': 'void c(void){}\nvoid b(void){c();}\nvoid a(void){b(); a();}' });
  const c = value.symbols().find(s => s.name === 'c')!;
  assert.ok(c);
  const one = value.graph(c.id, 'callers', 1)!;
  assert.equal(one.root.children[0].name, 'b');
  assert.equal(one.root.children[0].children.length, 0);
  const two = value.graph(c.id, 'callers', 1, { [one.root.children[0].key]: 1 })!;
  assert.equal(two.root.children[0].children[0].name, 'a');
  const a = value.symbols().find(s => s.name === 'a')!;
  assert.ok(value.graph(a.id, 'callers', 5)!.root.children.some(n => n.cycle));
});
test('editing and removing files invalidates old relationships', () => {
  const value = index({ 'a.c': 'void fault(void){}', 'b.c': 'void task(void){fault();}' });
  const id = value.symbols().find(s => s.name === 'fault')?.id;
  assert.ok(id);
  assert.equal(value.relations(id, 'callers').length, 1);
  value.update(parse('void task(void){}', 'file:///demo/b.c'));
  assert.equal(value.relations(id, 'callers').length, 0);
  value.remove('file:///demo/a.c');
  assert.equal(value.symbols().length, 1);
});
test('macro uses and compiler declaration attributes are not invented direct function calls', () => {
  const value = index({ 'a.c': '#define CHECK(x) fault(x)\nvoid fault(int x){}\nvoid irq(void) __interrupt(1) { CHECK(1); fault(2); }' });
  const file = value.files.get('file:///demo/a.c')!;
  assert.equal(file.references.some(r => r.name === '__interrupt' && r.kind === 'call'), false);
  const macro = value.symbols().find(s => s.name === 'CHECK')!;
  assert.equal(macro.kind, 'macro');
  const fault = value.symbols().find(s => s.name === 'fault')!;
  assert.equal(value.relations(fault.id, 'callers')[0].sites.length, 1);
});

test('local initializer calls belong to the enclosing function and preserve caller depth', () => {
  const value = index({ 'a.c': 'int target(void){return 1;} void task(void){int result=target(); int (*handler)(void)=target;} void entry(void){task();}' });
  const target = value.symbols().find(s => s.name === 'target' && s.definition)!;
  assert.deepEqual(value.relations(target.id, 'callers').map(g => [g.name, g.kind]), [['task', 'function']]);
  assert.equal(value.graph(target.id, 'callers', 2)!.root.children[0].children[0].name, 'entry');
  assert.ok(value.relations(target.id, 'references').some(g => g.name === 'handler' && g.kind === 'variable'));
});

test('prototype parameters do not shadow functions outside their parameter list', () => {
  for (const declarations of [
    'void register_cb(void (*target)(void));',
    'void register_cb(void (*callback)(int target));',
    'void register_cb(void (*callback)(int target)){}',
  ]) {
    const value = index({ 'impl.c': 'void target(void){}', 'use.c': `void target(void); ${declarations} void task(void){target();}` });
    const target = value.symbols().find(s => s.name === 'target' && s.kind === 'function' && s.definition)!;
    assert.deepEqual(value.relations(target.id, 'callers').map(g => g.name), ['task']);
  }
  const value = index({ 'a.c': 'void target(void){} void task(void){void register_cb(int target); target();}' });
  const target = value.symbols().find(s => s.name === 'target' && s.kind === 'function' && s.definition)!;
  assert.deepEqual(value.relations(target.id, 'callers').map(g => g.name), ['task']);
});

test('for initializer names stop shadowing after the loop, including unbraced bodies', () => {
  for (const body of ['{target();}', 'target();']) {
    const source = `void target(void){} void task(void){for(void (*target)(void)=0;target;)${body} target();}`;
    const value = index({ 'a.c': source });
    const target = value.symbols().find(s => s.name === 'target' && s.kind === 'function')!;
    const callers = value.relations(target.id, 'callers');
    assert.equal(callers.length, 1);
    assert.equal(callers[0].sites.length, 1);
    assert.equal(callers[0].sites[0].location.start, source.lastIndexOf('target();'));
  }
});

test('unknown conditional static retains external definition or declaration candidates', () => {
  for (const implementation of [true, false]) {
    const source = '#if BOARD\nstatic void target(void){}\n#else\nvoid target(void);\n#endif\nvoid task(void){target();}';
    const files: Record<string, string> = { 'use.c': source, 'unrelated.c': 'static void target(void){}' };
    if (implementation) files['impl.c'] = 'void target(void){}';
    const value = index(files);
    const targets = value.resolveAt('file:///demo/use.c', source.lastIndexOf('target();'));
    assert.equal(targets.length, 2);
    assert.ok(targets.some(s => s.storage === 'static' && s.location.uri.endsWith('/use.c')));
    const external = targets.find(s => s.storage === 'global')!;
    assert.ok(external);
    assert.equal(external.definition, implementation);
    const caller = value.relations(external.id, 'callers')[0];
    assert.equal(caller.name, 'task');
    assert.equal(caller.sites[0].ambiguous, true);
  }
});

test('known conditional static still shadows external definitions', () => {
  for (const condition of ['0', '1']) {
    const source = `#if ${condition}\nstatic void target(void){}\n#else\nvoid target(void);\n#endif\nvoid task(void){target();}`;
    const value = index({ 'use.c': source, 'impl.c': 'void target(void){}' });
    const targets = value.resolveAt('file:///demo/use.c', source.lastIndexOf('target();'));
    assert.equal(targets.length, 1);
    assert.equal(targets[0].storage, condition === '1' ? 'static' : 'global');
  }
});

test('prototype with a trailing attribute macro resolves to its function definition', () => {
  const source = 'static void unlock(int target) PRIVILEGED_FUNCTION;\nstatic void unlock(int target){}\nvoid task(void){unlock(1);}';
  const value = index({ 'a.c': source });
  const targets = value.resolveAt('file:///demo/a.c', source.indexOf('unlock') + 2);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].name, 'unlock');
  assert.equal(targets[0].definition, true);
  assert.deepEqual(value.relations(targets[0].id, 'callers').map(g => g.name), ['task']);
  assert.ok(value.relations(targets[0].id, 'references').some(g => g.sites.some(s => s.kind === 'declaration')));
  assert.equal(value.symbols().some(s => s.name === 'PRIVILEGED_FUNCTION'), false);
  assert.ok(value.symbols().filter(s => s.name === 'target').every(s => s.scope));
});

test('variable accesses distinguish direct reads, writes, updates, addresses and explicit initialization', () => {
  const source = 'int state=0; void task(void){ int copy=state; state=copy; (state)+=2; ++state; (state)--; use(&(state)); use(state); sizeof(state); }';
  const value = index({ 'a.c': source });
  const state = value.symbols().find(s => s.name === 'state')!;
  const sites = value.relations(state.id, 'references').flatMap(g => g.sites).sort((a,b) => a.location.start-b.location.start);
  assert.deepEqual(sites.map(s => s.access), ['write', 'read', 'write', 'readwrite', 'readwrite', 'readwrite', 'address', 'read']);
  assert.equal(value.relations(state.id, 'references').find(g => g.name === 'task')!.sites.length, 7);
  const copy = value.symbols().find(s => s.name === 'copy')!;
  assert.deepEqual(value.relations(copy.id, 'references')[0].sites.map(s => s.access), ['write', 'read']);
});

test('variable filters include readwrite and continue through the using function callers', () => {
  const value = index({ 'a.c': 'int state; void reader(void){use(state);} void writer(void){state=1;} void updater(void){state++;} void escape(void){use(&state);} void entry(void){writer();}' });
  const state = value.symbols().find(s => s.name === 'state')!;
  assert.deepEqual(value.relations(state.id, 'callers', 'read').map(g => g.name), ['reader', 'updater']);
  assert.deepEqual(value.relations(state.id, 'callers', 'write').map(g => g.name), ['updater', 'writer']);
  assert.deepEqual(value.relations(state.id, 'references', 'readwrite').map(g => g.name), ['updater']);
  assert.deepEqual(value.relations(state.id, 'references', 'address').map(g => g.name), ['escape']);
  const graph = value.graph(state.id, 'callers', 2, {}, 'write')!;
  assert.equal(graph.root.children.find(n => n.name === 'writer')!.children[0].name, 'entry');
  assert.equal(graph.root.children.find(n => n.name === 'writer')!.children[0].sites[0].access, undefined);
});

test('extern variables resolve to definitions without hiding cross-file uses', () => {
  const use = 'extern int state; void task(void){state=2;}';
  const value = index({ 'a.c': 'int state;', 'use.c': use });
  const state = value.symbols().find(s => s.name === 'state' && s.definition)!;
  assert.deepEqual(value.resolveAt('file:///demo/use.c', use.indexOf('state')).map(s => s.id), [state.id]);
  assert.deepEqual(value.relations(state.id, 'references').map(g => g.name), ['task']);
  const external = index({ 'use.c': use });
  const declaration = external.symbols().find(s => s.name === 'state')!;
  assert.equal(declaration.definition, false);
  assert.equal(external.relations(declaration.id, 'references')[0].sites[0].access, 'write');
});

test('variable scope, pointer reads, inactive writes and unevaluated operands remain distinct', () => {
  const source = 'int state; void task(int *p){ *p=1; use(&*p); sizeof(*p); int state=1; state++; } void outer(void){state=3;\n#if 0\nstate=4;\n#endif\n}';
  const value = index({ 'a.c': source });
  const state = value.symbols().find(s => s.name === 'state' && !s.scope)!;
  assert.deepEqual(value.relations(state.id, 'references').map(g => [g.name,g.sites.length]), [['outer',1]]);
  const local = value.symbols().find(s => s.name === 'state' && s.scope)!;
  assert.deepEqual(value.relations(local.id, 'references')[0].sites.map(s => s.access), ['write','readwrite']);
  const p = value.symbols().find(s => s.name === 'p')!;
  assert.deepEqual(value.relations(p.id, 'references')[0].sites.map(s => s.access), ['read','read']);
});

test('block extern shadows an outer parameter and links to the external definition', () => {
  for (const definition of [true, false]) {
    const source = 'void task(int state){state=0; {extern int state; state=1;} state=2;}';
    const value = index({ 'use.c': source, ...(definition ? { 'state.c': 'int state;' } : {}) });
    const local = value.symbols().find(s => s.name === 'state' && s.storage === 'local')!;
    const external = value.symbols().find(s => s.name === 'state' && (definition ? s.definition && s.storage === 'global' : !s.definition))!;
    const positions = (id: string) => value.relations(id, 'references', 'write').flatMap(g => g.sites.map(s => s.location.start));
    assert.deepEqual(positions(local.id), [source.indexOf('state=0'), source.indexOf('state=2')]);
    assert.deepEqual(positions(external.id), [source.indexOf('state=1')]);
    for (const position of [source.indexOf('state;'), source.indexOf('state=1')])
      assert.deepEqual(value.resolveAt('file:///demo/use.c', position).map(s => s.id), [external.id]);
    const block = value.symbols().find(s => s.name === 'state' && !s.definition)!;
    assert.ok(block.scope, 'extern retains lexical scope');
  }
});

test('block extern function calls bypass a shadowed parameter', () => {
  const source = 'void task(int target){ {extern void target(void); target();} }';
  const value = index({ 'use.c': source, 'target.c': 'void target(void){}' });
  const target = value.symbols().find(s => s.name === 'target' && s.kind === 'function' && s.definition)!;
  assert.deepEqual(value.relations(target.id, 'callers').map(g => g.name), ['task']);
  const parameter = value.symbols().find(s => s.name === 'target' && s.kind === 'variable')!;
  assert.deepEqual(value.relations(parameter.id, 'references'), []);
});

test('conditional initialization writes bind only to their own definition', () => {
  for (const storage of ['static ', '']) {
    const source = `#if BOARD\n${storage}int state=1;\n#else\n${storage}int state=2;\n#endif\nvoid task(void){state++;}`;
    const value = index({ 'a.c': source });
    const targets = value.symbols().filter(s => s.name === 'state');
    assert.equal(targets.length, 2);
    for (const target of targets) {
      const writes = value.relations(target.id, 'references', 'write').flatMap(g => g.sites);
      assert.deepEqual(writes.filter(s => s.access === 'write').map(s => s.location.start), [target.location.start]);
      assert.deepEqual(writes.find(s => s.access === 'write')!.candidates, [target.id]);
      assert.equal(writes.find(s => s.access === 'readwrite')!.ambiguous, true, 'ordinary conditional uses retain both candidates');
    }
  }
});

test('updating or removing one file does not scan unchanged file records', () => {
  const value = new RelationIndex();
  const untouched = parse('void target(void){}', 'file:///demo/target.c');
  value.update(untouched);
  Object.defineProperty(untouched, 'references', { get() { throw new Error('unchanged references scanned'); } });
  Object.defineProperty(untouched, 'symbols', { get() { throw new Error('unchanged symbols scanned'); } });
  const caller = parse('void caller(void){target();}', 'file:///demo/caller.c');
  value.update(caller);
  value.update(parse('void caller(void){target(); target();}', caller.uri));
  value.remove(caller.uri);
  value.remove('file:///missing.c');
});

test('shared prototypes are not rescanned for every call site', () => {
  const value = new RelationIndex();
  const target = parse('void target(void){}', 'file:///demo/target.c');
  value.update(target);
  let definitionReads = 0;
  for (let n = 0; n < 20; n++) {
    const file = parse(`void target(void); void caller${n}(void){${'target();'.repeat(20)}}`, `file:///demo/caller${n}.c`);
    const declaration = file.symbols.find(s => s.name === 'target')!;
    Object.defineProperty(declaration, 'definition', { get() { definitionReads++; return false; } });
    value.update(file);
  }
  const groups = value.relations(target.symbols[0].id, 'callers');
  assert.equal(groups.length, 20);
  assert.equal(groups.flatMap(g => g.sites).length, 400);
  assert.ok(definitionReads < 1000, `unrelated prototypes scanned ${definitionReads} times`);
});

test('incremental replacement, rename, delete and reinsert match a fresh index', () => {
  const value = index({ 'a.c': 'void target(void){} int state;', 'b.c': 'void caller(void){target(); state++;}',
    'c.c': 'void target(void){} void caller(void){target();}' });
  const equivalent = () => {
    const fresh = new RelationIndex();
    for (const file of value.files.values()) fresh.update(file);
    for (const symbol of fresh.symbols()) {
      assert.deepEqual(value.symbol(symbol.id), fresh.symbol(symbol.id));
      for (const mode of ['references', 'callers'] as const)
        assert.deepEqual(value.graph(symbol.id, mode, 3), fresh.graph(symbol.id, mode, 3));
    }
    assert.deepEqual(value.symbols().map(s => s.id).sort(), fresh.symbols().map(s => s.id).sort());
  };
  equivalent();
  value.update(parse('void target(void){} int other;', 'file:///demo/a.c')); equivalent();
  value.update(parse('void renamed(void){target(); target();}', 'file:///demo/b.c')); equivalent();
  value.remove('file:///demo/c.c'); equivalent();
  value.update(parse('void target(void){}', 'file:///demo/c.c')); equivalent();
  value.update(parse('', 'file:///demo/a.c')); equivalent();
  value.clear(); assert.equal(value.symbols().length, 0); assert.equal(value.files.size, 0);
});

test('conditional local callback retains the direct global callee candidate', () => {
  const source = 'void target(void){} void run(void){\n#if BOARD\nvoid (*target)(void);\n#endif\ntarget();}';
  const value = index({ 'a.c': source });
  const run = value.symbols().find(s => s.name === 'run')!;
  const groups = value.relations(run.id, 'callees');
  assert.deepEqual(groups.map(g => g.callKind).sort(), ['direct', 'indirect']);
  assert.ok(groups.every(g => g.sites[0].ambiguous));
});
test('conditional block extern retains both linked global and outer local uses', () => {
  const source = 'void run(int state){{\n#if BOARD\nextern int state;\n#endif\nstate=1;}}';
  const value = index({ 'a.c': source, 'b.c': 'int state;' });
  const candidates = value.resolveAt('file:///demo/a.c', source.indexOf('state=1'));
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map(s => s.storage).sort(), ['global', 'local']);
  for (const candidate of candidates) assert.equal(value.relations(candidate.id, 'references')[0].sites[0].access, 'write');
});
