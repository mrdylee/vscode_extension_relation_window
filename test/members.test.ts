import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createAnalyzer } from '../src/analyzer';
import { RelationIndex } from '../src/relations';

let analyzer: Awaited<ReturnType<typeof createAnalyzer>>;
before(async () => { analyzer = await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'), path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm')); });
const uri = (file: string) => `file:///demo/${file}`;
const parse = (text: string, file = 'main.c') => analyzer.analyze(uri(file), text);
function index(files: Record<string, string>) {
  const value = new RelationIndex();
  for (const [file, text] of Object.entries(files)) value.update(parse(text, file));
  return value;
}
const at = (value: RelationIndex, source: string, text: string, file = 'main.c') => value.resolveAt(uri(file), source.indexOf(text) + text.lastIndexOf('state'));

test('members separate identical field names from each other and global variables', () => {
  const source = 'struct Motor { int state; }; struct Sensor { int state; }; int state; void run(struct Motor *m, struct Sensor *s){m->state=1;s->state++;state=3;}';
  const value = index({ 'main.c': source });
  const motor = at(value, source, 'm->state')[0], sensor = at(value, source, 's->state')[0];
  assert.ok(motor); assert.ok(sensor); assert.notEqual(motor.id, sensor.id);
  assert.equal(motor.memberOf, value.symbols().find(s => s.name === 'Motor')!.id);
  assert.deepEqual(value.relations(motor.id, 'references').flatMap(g => g.sites.map(s => s.access)), ['write']);
  assert.deepEqual(value.relations(sensor.id, 'references').flatMap(g => g.sites.map(s => s.access)), ['readwrite']);
  const global = value.symbols().find(s => s.name === 'state' && !s.memberOf)!;
  assert.equal(value.relations(global.id, 'references')[0].sites.length, 1);
  assert.equal(value.graph(motor.id, 'callees', 1)!.root.name, 'Motor.state');
});
test('members retain R W RW address filters and continue into caller trees', () => {
  const source = 'typedef struct { int state; } Motor; void run(Motor *m){m->state=1;int copy=m->state;m->state+=2;use(&m->state);sizeof(m->state);} void entry(Motor *m){run(m);}';
  const value = index({ 'main.c': source });
  const motor = at(value, source, 'm->state')[0]; assert.ok(motor);
  const uses = value.relations(motor.id, 'references').flatMap(g => g.sites);
  assert.deepEqual(uses.map(s => s.access), ['write', 'read', 'readwrite', 'address']);
  assert.equal(value.relations(motor.id, 'references', 'write')[0].sites.length, 2);
  assert.equal(value.graph(motor.id, 'callees', 2, {}, 'write')!.root.children[0].children[0].name, 'entry');
  assert.equal(value.graph(motor.id, 'references', 1)!.root.name, 'Motor.state');
});
test('members follow aliases, nested anonymous fields, arrays, dereference and address', () => {
  const source = 'typedef struct { int state; } Motor; typedef Motor Alias; typedef Alias *Ptr; struct Outer { Motor motors[2]; struct { Motor one; } inner; }; void run(Ptr p, struct Outer *o){p->state++;o->motors[0].state=2;(*p).state=3;(&o->inner.one)->state=4;}';
  const value = index({ 'main.c': source });
  const member = at(value, source, 'p->state')[0]; assert.ok(member);
  for (const expression of ['o->motors[0].state', '(*p).state', '(&o->inner.one)->state']) assert.equal(at(value, source, expression)[0]?.id, member.id, expression);
  assert.equal(value.relations(member.id, 'references')[0].sites.length, 4);
});
test('members use transitive included headers and invalidate after header edits and deletes', () => {
  const source = '#include "api.h"\nvoid run(Motor *m){m->state=1;}';
  const value = index({ 'main.c': source, 'api.h': '#include "types.h"', 'types.h': 'typedef struct { int state; } Motor;', 'unrelated.c': 'typedef struct { int state; } Motor;' });
  const members = at(value, source, 'm->state');
  assert.equal(members.length, 1); assert.ok(members[0].location.uri.endsWith('types.h'));
  value.update(parse('typedef struct { int renamed; } Motor;', 'types.h'));
  assert.deepEqual(at(value, source, 'm->state'), []);
  value.update(parse('typedef struct { int state; } Motor;', 'types.h'));
  assert.equal(at(value, source, 'm->state').length, 1);
  value.remove(uri('types.h'));
  assert.deepEqual(at(value, source, 'm->state'), []);
});
test('members respect local type scopes and typedef declaration context', () => {
  const source = 'typedef struct { int state; } Motor; void run(Motor *outer){ typedef struct { int state; } Motor; Motor local; outer->state=1;local.state=2; { struct Local { int state; }; struct Local l;l.state=3; } }';
  const value = index({ 'main.c': source });
  const outer = at(value, source, 'outer->state')[0], local = at(value, source, 'local.state')[0];
  assert.ok(outer); assert.ok(local); assert.notEqual(outer.id, local.id);
  assert.ok(at(value, source, 'l.state')[0]);
  assert.equal(value.relations(outer.id, 'references')[0].sites.length, 1);
});
test('members keep conditional duplicate types as candidates and skip if zero', () => {
  const source = '#if BOARD\ntypedef struct { int state; } Motor;\n#else\ntypedef struct { int state; } Motor;\n#endif\n#if 0\ntypedef struct { int state; } Motor;\n#endif\nvoid run(Motor *m){m->state=1;}';
  const value = index({ 'main.c': source });
  const members = at(value, source, 'm->state'); assert.equal(members.length, 2);
  assert.ok(members.every(member => value.relations(member.id, 'references')[0].sites[0].ambiguous));
});
test('members do not guess unknown receivers, casts, return types or mismatched operators', () => {
  const source = 'struct Motor { int state; }; int state; void run(struct Motor **pp, struct Motor *p, struct Motor m){unknown->state=1;((struct Motor*)unknown)->state=2;get()->state=3;pp->state=4;p.state=5;m->state=6;}';
  const value = index({ 'main.c': source });
  for (const expression of ['unknown->state', '((struct Motor*)unknown)->state', 'get()->state', 'pp->state', 'p.state', 'm->state']) assert.deepEqual(at(value, source, expression), [], expression);
  const global = value.symbols().find(s => s.name === 'state' && !s.memberOf)!;
  assert.deepEqual(value.relations(global.id, 'references'), []);
});
test('members support union bit fields and forward tags without merging ordinary names', () => {
  const source = 'typedef struct Node NodeAlias; struct Node { unsigned state:2; NodeAlias *next; }; union Data { int state; }; void Node(void){} void run(NodeAlias *p, union Data d){p->next->state++;d.state=1;Node();}';
  const value = index({ 'main.c': source });
  assert.ok(at(value, source, 'p->next->state')[0]);
  assert.ok(at(value, source, 'd.state')[0]);
  const run = value.symbols().find(s => s.name === 'run')!;
  assert.equal(value.relations(run.id, 'callees').find(g => g.name === 'Node')!.symbol!.kind, 'function');
});
test('members inspect callback fields without guessing the runtime call target', () => {
  const source = 'struct Ops { void (*run)(void); }; void task(struct Ops *ops){ops->run();}';
  const value = index({ 'main.c': source });
  const field = value.resolveAt(uri('main.c'), source.indexOf('ops->run') + 5)[0]; assert.ok(field);
  assert.equal(field.name, 'run'); assert.ok(field.memberOf);
  assert.equal(value.relations(field.id, 'references')[0].sites[0].access, 'read');
  const task = value.symbols().find(s => s.name === 'task')!;
  assert.equal(value.relations(task.id, 'callees')[0].callKind, 'indirect');
});

test('members retain outer type when a local typedef is conditional', () => {
  const source = 'typedef struct {int state;} Motor; void run(void){\n#if BOARD\ntypedef struct {int state;} Motor;\n#endif\nMotor m;m.state=1;}';
  const value = index({ 'main.c': source });
  assert.equal(at(value, source, 'm.state').length, 2);
});
test('members complete a visible local forward tag without using unrelated headers', () => {
  const source = '#include "types.h"\nvoid run(void){struct Motor; struct Motor *m; struct Motor {int state;};m->state=1;}';
  const value = index({ 'main.c': source, 'types.h': 'struct Motor {int state;};' });
  const members = at(value, source, 'm->state'); assert.equal(members.length, 1);
  assert.equal(members[0].location.uri, uri('main.c'));
});
test('members distinguish pointer-to-array from array-of-pointers', () => {
  const source = 'struct Motor {int state;}; void run(struct Motor (*matrix)[2], struct Motor *items[2]){(*matrix)[0].state=1;items[0]->state=2;matrix->state=3;items[0].state=4;}';
  const value = index({ 'main.c': source });
  assert.ok(at(value, source, '(*matrix)[0].state')[0]);
  assert.ok(at(value, source, 'items[0]->state')[0]);
  assert.deepEqual(at(value, source, 'matrix->state'), []);
  assert.deepEqual(at(value, source, 'items[0].state'), []);
});
test('members header scope uses relative paths before ambiguous include-path candidates', () => {
  const source = '#include "types.h"\nvoid run(Motor *m){m->state=1;}';
  const value = index({ 'app/main.c': source, 'app/types.h': 'typedef struct {int state;} Motor;', 'vendor/types.h': 'typedef struct {int state;} Motor;' });
  assert.equal(at(value, source, 'm->state', 'app/main.c')[0]?.location.uri, uri('app/types.h'));
  value.remove(uri('app/types.h'));
  value.update(parse('typedef struct {int state;} Motor;', 'other/types.h'));
  assert.equal(at(value, source, 'm->state', 'app/main.c').length, 2);
});
test('members stale references disappear after changing caller and include graph', () => {
  const source = '#include "api.h"\nvoid run(Motor *m){m->state=1;}';
  const value = index({ 'main.c': source, 'api.h': '#include "types.h"', 'types.h': 'typedef struct {int state;} Motor;' });
  const member = at(value, source, 'm->state')[0]; assert.ok(member);
  value.update(parse('/* header removed */', 'api.h'));
  assert.deepEqual(value.relations(member.id, 'references'), []);
  value.update(parse('#include "types.h"', 'api.h'));
  assert.equal(value.relations(member.id, 'references')[0].sites.length, 1);
  value.update(parse('#include "api.h"\nvoid run(Motor *m){}'));
  assert.deepEqual(value.relations(member.id, 'references'), []);
  value.clear(); assert.equal(value.symbols().length, 0);
});
test('members tolerate cyclic typedefs without inventing targets', () => {
  const source = 'typedef B A; typedef A B; void run(A *a){a->state=1;}';
  const value = index({ 'main.c': source });
  assert.deepEqual(at(value, source, 'a->state'), []);
});

test('members do not prefer a local header for an angle-bracket include without build flags', () => {
  const source = '#include <types.h>\nvoid run(Motor *m){m->state=1;}';
  const value = index({ 'app/main.c': source, 'app/types.h': 'typedef struct {int state;} Motor;', 'vendor/types.h': 'typedef struct {int state;} Motor;' });
  assert.equal(at(value, source, 'm->state', 'app/main.c').length, 2);
});

test('members complete a header forward tag in the consuming translation unit', () => {
  const source = '#include "api.h"\nstruct Motor {int state;}; void run(Motor *m){m->state=1;}';
  const value = index({ 'main.c': source, 'api.h': 'typedef struct Motor Motor;' });
  assert.equal(at(value, source, 'm->state')[0]?.location.uri, uri('main.c'));
});

test('members declared in function prototypes do not leak their tag scope', () => {
  const source = 'void proto(struct Local {int state;} *p); void run(struct Local *x){x->state=1;}';
  const value = index({ 'main.c': source });
  assert.deepEqual(at(value, source, 'x->state'), []);
});
test('members declared in function definition parameters remain visible in its body', () => {
  const source = 'void run(struct Local {int state;} *x){x->state=1;}';
  const value = index({ 'main.c': source });
  assert.equal(at(value, source, 'x->state').length, 1);
});

test('members complete implicitly introduced local tags', () => {
  const source = 'void run(void){struct Motor *m; struct Motor {int state;}; m->state=1;}';
  const value = index({ 'main.c': source });
  const members = at(value, source, 'm->state');
  assert.equal(members.length, 1);
  assert.equal(members[0].location.start, source.indexOf('state;'));
});
test('implicit local tags do not replace already visible outer tags', () => {
  for (const header of [false, true]) {
    const outer = 'struct Motor {int state;};';
    const body = 'void run(void){struct Motor *m; struct Motor {int state;}; m->state=1;}';
    const source = (header ? '#include "types.h"\n' : outer) + body;
    const value = index({ 'main.c': source, ...(header ? { 'types.h': outer } : {}) });
    const members = at(value, source, 'm->state');
    assert.equal(members.length, 1);
    assert.equal(members[0].location.uri, uri(header ? 'types.h' : 'main.c'));
    assert.equal(members[0].location.start, outer.indexOf('state'));
  }
});
test('implicit local completion stays separate from later file-scope tags', () => {
  const source = 'void run(void){struct Motor *m; struct Motor {int state;}; m->state=1;} struct Motor {int state;};';
  const value = index({ 'main.c': source });
  assert.equal(at(value, source, 'm->state')[0]?.location.start, source.indexOf('state;'));
});
test('conditional receiver shadows retain outer member candidates', () => {
  const source = 'struct Motor {int state;}; struct Sensor {int state;}; void run(void){struct Motor m;{\n#if BOARD\nstruct Sensor m;\n#endif\nm.state=1;}}';
  const value = index({ 'main.c': source });
  assert.deepEqual(at(value, source, 'm.state').map(s => s.containerName).sort(), ['Motor', 'Sensor']);
  for (const member of at(value, source, 'm.state')) assert.ok(value.relations(member.id, 'references')[0].sites[0].ambiguous);
});
test('unconditional receiver shadows still hide outer member candidates', () => {
  const source = 'struct Motor {int state;}; struct Sensor {int state;}; void run(void){struct Motor m;{struct Sensor m;m.state=1;}}';
  const value = index({ 'main.c': source });
  assert.deepEqual(at(value, source, 'm.state').map(s => s.containerName), ['Sensor']);
});
test('implicit tags do not bind to later definitions in an enclosing block', () => {
  const source = 'void run(void){{struct Motor *m; m->state=1;} struct Motor {int state;};}';
  const value = index({ 'main.c': source });
  assert.deepEqual(at(value, source, 'm->state'), []);
});
test('conditional receiver shadows retain globals through multiple nested scopes', () => {
  const source = 'struct Motor {int state;}; struct Sensor {int state;}; struct Third {int state;}; struct Motor m; void run(void){\n#if A\nstruct Sensor m;\n#endif\n{\n#if B\nstruct Third m;\n#endif\nm.state=1;}}';
  const value = index({ 'main.c': source });
  assert.deepEqual(at(value, source, 'm.state').map(s => s.containerName).sort(), ['Motor', 'Sensor', 'Third']);
});
