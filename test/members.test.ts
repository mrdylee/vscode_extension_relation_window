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
test('members do not guess unknown receivers, unknown return types or mismatched operators', () => {
  const source = 'struct Motor { int state; }; int state; void run(struct Motor **pp, struct Motor *p, struct Motor m){unknown->state=1;((Unknown*)unknown)->state=2;get()->state=3;pp->state=4;p.state=5;m->state=6;}';
  const value = index({ 'main.c': source });
  for (const expression of ['unknown->state', '((Unknown*)unknown)->state', 'get()->state', 'pp->state', 'p.state', 'm->state']) assert.deepEqual(at(value, source, expression), [], expression);
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

test('explicit casts bind fields using their written lexical types', () => {
  const source = 'struct Motor {int state;}; typedef struct Motor Motor; typedef Motor *Ptr; struct Sensor {int state;}; void run(void *p){((struct Motor*)p)->state=1;((Ptr)p)->state++;{typedef struct Sensor Motor;((Motor*)p)->state=3;}}';
  const value = index({ 'main.c': source });
  for (const expression of ['((struct Motor*)p)->state', '((Ptr)p)->state']) assert.equal(at(value, source, expression)[0]?.containerName, 'Motor');
  assert.equal(at(value, source, '((Motor*)p)->state')[0]?.containerName, 'Sensor');
  const member = at(value, source, '((Ptr)p)->state')[0]; assert.ok(member);
  const sites = value.relations(member.id, 'references')[0].sites;
  assert.deepEqual(sites.map(site => site.access), ['write', 'readwrite']);
  assert.equal(sites[0].location.start, source.indexOf('state=1'));
});

test('declared returns and callback returns bind members in their declaration context', () => {
  const source = '#include "api.h"\nstruct Sensor {int state;}; void run(struct Motor *(*factory)(void)){typedef struct Sensor Motor;get_motor()->state=1;get_value().state++;factory()->state=2;}';
  const value = index({ 'main.c': source, 'api.h': 'typedef struct Motor {int state;} Motor; Motor *get_motor(void); Motor get_value(void);' });
  for (const expression of ['get_motor()->state', 'get_value().state', 'factory()->state']) {
    const member = at(value, source, expression)[0]; assert.ok(member, expression);
    assert.equal(member.location.uri, uri('api.h'));
  }
  assert.deepEqual(value.relations(at(value, source, 'get_motor()->state')[0].id, 'references')[0].sites.map(site => site.access), ['write', 'readwrite', 'write']);
});

test('casts and returns preserve pointer and array layers and conditional types', () => {
  const source = '#if BOARD\ntypedef struct A {int state;} Item;\n#else\ntypedef struct B {int state;} Item;\n#endif\nItem *get(void); void run(void *p){get()->state=1;((Item(*)[2])p)[0][1].state=2;((Item**)p)->state=3;get().state=4;}';
  const value = index({ 'main.c': source });
  for (const expression of ['get()->state', '((Item(*)[2])p)[0][1].state']) {
    const members = at(value, source, expression);
    assert.deepEqual(members.map(s => s.containerName).sort(), ['A', 'B']);
    assert.ok(members.every(member => value.relations(member.id, 'references')[0].sites.every(site => site.ambiguous)));
  }
  assert.deepEqual(at(value, source, '((Item**)p)->state'), []);
  assert.deepEqual(at(value, source, 'get().state'), []);
});

test('anonymous struct and union members promote fields without promoting named fields', () => {
  const source = 'struct Motor {union {struct {int state;};int mode;};struct {int hidden;} named;};struct Sensor {int state;};void run(struct Motor *m,struct Sensor *s){m->state=1;m->mode=2;m->named.hidden=3;m->hidden=4;s->state=5;}';
  const value = index({ 'main.c': source });
  const member = at(value, source, 'm->state')[0]; assert.ok(member);
  assert.equal(member.containerName, 'Motor');
  assert.notEqual(member.id, at(value, source, 's->state')[0]?.id);
  assert.ok(value.resolveAt(uri('main.c'), source.indexOf('mode=2'))[0]);
  const hidden = value.resolveAt(uri('main.c'), source.indexOf('hidden=3'))[0]; assert.ok(hidden);
  assert.deepEqual(value.resolveAt(uri('main.c'), source.indexOf('hidden=4')), []);
  assert.equal(value.relations(member.id, 'references')[0].sites.length, 1);
});

test('anonymous promotion preserves conditional paths and inactive branch exclusion', () => {
  const source = 'struct Motor {\n#if BOARD\nunion {int state;};\n#else\nstruct {int state;};\n#endif\n#if 0\nunion {int state;};\n#endif\n};void run(struct Motor *m){m->state=1;}';
  const value = index({ 'main.c': source });
  const members = at(value, source, 'm->state'); assert.equal(members.length, 2);
  assert.ok(members.every(member => value.relations(member.id, 'references')[0].sites[0].ambiguous));
});

test('field designators are exact writes owned by their variable or containing function', () => {
  const source = 'struct Motor {int state;};struct Motor global={.state=1};void run(void){struct Motor local={.state=2};}';
  const value = index({ 'main.c': source });
  const member = value.resolveAt(uri('main.c'), source.indexOf('state=1'))[0]; assert.ok(member);
  assert.equal(member.id, value.resolveAt(uri('main.c'), source.indexOf('state=2'))[0]?.id);
  const groups = value.relations(member.id, 'references', 'write');
  assert.deepEqual(groups.map(g => g.name), ['global', 'run']);
  assert.deepEqual(groups.flatMap(g => g.sites.map(site => site.location.start)), [source.indexOf('state=1'), source.indexOf('state=2')]);
  assert.deepEqual(value.relations(member.id, 'references', 'read'), []);
});

test('nested field and array designators and compound literals retain receiving types', () => {
  const source = 'typedef struct {int state;} Motor;struct Outer {Motor items[2];};struct Outer a={.items[1].state=1};struct Outer b={.items={[0]={.state=2}}};Motor c=(Motor){.state=3};void run(void){use((Motor){.state=4});sizeof((Motor){.state=5});}';
  const value = index({ 'main.c': source });
  const member = value.resolveAt(uri('main.c'), source.indexOf('state=1'))[0]; assert.ok(member);
  for (const number of [2, 3, 4]) assert.equal(value.resolveAt(uri('main.c'), source.indexOf('state='+number))[0]?.id, member.id);
  const sites = value.relations(member.id, 'references').flatMap(g => g.sites);
  assert.equal(sites.length, 4);
  assert.ok(sites.every(site => site.access === 'write'));
});

test('anonymous initializer designators and safe positional nesting resolve', () => {
  const source = 'struct Outer {struct {int state;};};struct Outer a={.state=1};typedef struct {int state;} Motor;struct Pair {Motor first;Motor second;};struct Pair b={{.state=2},{.state=3}};';
  const value = index({ 'main.c': source });
  assert.ok(value.resolveAt(uri('main.c'), source.indexOf('state=1'))[0]);
  const member = value.resolveAt(uri('main.c'), source.indexOf('state=2'))[0]; assert.ok(member);
  assert.equal(value.resolveAt(uri('main.c'), source.indexOf('state=3'))[0]?.id, member.id);
});

test('cast and returned member references invalidate when their header changes or disappears', () => {
  const source = '#include "api.h"\nvoid run(void *p){((Motor*)p)->state=1;get()->state=2;}';
  const header = 'typedef struct {int state;} Motor;Motor *get(void);';
  const value = index({ 'main.c': source, 'api.h': header });
  assert.ok(at(value, source, 'get()->state')[0]);
  value.update(parse(header.replace('state', 'other'), 'api.h'));
  assert.deepEqual(at(value, source, 'get()->state'), []);
  assert.deepEqual(at(value, source, '((Motor*)p)->state'), []);
  value.update(parse(header, 'api.h'));
  assert.ok(at(value, source, 'get()->state')[0]);
  value.remove(uri('api.h'));
  assert.deepEqual(at(value, source, 'get()->state'), []);
});

test('unsupported member expressions produce notices instead of unrelated field guesses', () => {
  const source = 'struct Motor {int state;};int state;void run(struct Motor *p){(p+1)->state=2;}';
  const file = parse(source), value = new RelationIndex(); value.update(file);
  assert.deepEqual(at(value, source, '(p+1)->state'), []);
  assert.ok(file.issues.some(issue => /member.*unsupported|unsupported.*member/i.test(issue)));
});

test('review: intermediate designators do not claim writes to entire parent fields', () => {
  const source = 'typedef struct {int state;} Motor;struct Outer {Motor items[2];Motor child;};struct Outer a={.items[0].state=1,.child.state=2};';
  const value = index({ 'main.c': source });
  for (const token of ['items[0]', 'child.state']) {
    const member = value.resolveAt(uri('main.c'), source.indexOf(token))[0]; assert.ok(member);
    assert.deepEqual(value.relations(member.id, 'references'), []);
  }
});

test('review: positional nesting counts anonymous aggregate fields in source order', () => {
  const source = 'typedef struct {int state;} Motor;struct Outer {union {int mode;};Motor motor;};struct Outer a={{.mode=1},{.state=2}};';
  const value = index({ 'main.c': source });
  assert.ok(value.resolveAt(uri('main.c'), source.indexOf('mode=1'))[0]);
  const member = value.resolveAt(uri('main.c'), source.indexOf('state=2'))[0]; assert.ok(member);
  assert.equal(member.containerName, 'Motor');
});

test('review: conditional layouts and scalar brace elision do not guess positional fields', () => {
  for (const source of [
    'typedef struct {int state;} Motor;struct Outer {\n#if BOARD\nMotor first;\n#endif\nMotor second;};struct Outer a={{.state=1}};',
    'typedef struct {int state;} Motor;struct Outer {int padding[3];Motor motor;};struct Outer a={1,{.state=1}};'
  ]) {
    const value = index({ 'main.c': source });
    assert.deepEqual(value.resolveAt(uri('main.c'), source.indexOf('state=1')), []);
  }
});

test('unsupported positional continuation is reported and never assigned by ordinal', () => {
  const source = 'typedef struct {int state;} Motor;struct Pair {Motor a;Motor b;};struct Pair p={.b={.state=1},{.state=2}};';
  const file = parse(source), value = new RelationIndex(); value.update(file);
  assert.ok(value.resolveAt(uri('main.c'), source.indexOf('state=1'))[0]);
  assert.deepEqual(value.resolveAt(uri('main.c'), source.indexOf('state=2')), []);
  assert.ok(file.issues.some(issue => /unsupported member/.test(issue)));
});

test('anonymous ownership is invalidated when headers change, disappear or the index resets', () => {
  const source = '#include "types.h"\nvoid run(struct Motor *m){m->state=1;}';
  const header = 'struct Motor {union {int state;};};';
  const value = index({ 'main.c': source, 'types.h': header });
  assert.ok(at(value, source, 'm->state')[0]);
  value.update(parse('struct Motor {struct {int state;} named;};', 'types.h'));
  assert.deepEqual(at(value, source, 'm->state'), []);
  value.update(parse(header, 'types.h'));
  assert.ok(at(value, source, 'm->state')[0]);
  value.remove(uri('types.h'));
  assert.deepEqual(at(value, source, 'm->state'), []);
  value.clear(); value.update(parse(source)); value.update(parse(header, 'types.h'));
  assert.equal(at(value, source, 'm->state').length, 1);
});
