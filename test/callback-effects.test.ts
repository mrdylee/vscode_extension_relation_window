import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createAnalyzer } from '../src/analyzer';
import { RelationIndex } from '../src/relations';

let analyzer: Awaited<ReturnType<typeof createAnalyzer>>;
before(async () => {
  analyzer = await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'), path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm'));
});
function project(source: string) {
  const index = new RelationIndex();
  for (const file of analyzer.derive([analyzer.analyze('file:///demo/effects.c', source)])) index.update(file);
  return index;
}
function symbol(index: RelationIndex, name: string) {
  return index.symbols().find(record => record.kind === 'function' && record.definition && record.name === name)!;
}
function inferred(index: RelationIndex, name: string) {
  return index.relations(symbol(index, name).id, 'callees').filter(group => group.callKind === 'inferred');
}

for (const count of [248, 257, 400]) for (const offset of ['variable', 'unexpanded macro']) test(`${count} scalar writes through ${offset} offsets do not exhaust callback effects`, () => {
  const writes = Array.from({ length: count }, (_, n) => `regs[${n}]=${n};`).join('');
  const source = `#define BASE 0\ntypedef void(*CB)(void);void target(void){}static unsigned short buffer[2048];
    static void pack(unsigned short*regs){${writes}}
    void run(unsigned offset){pack(&buffer[${offset === 'variable' ? 'offset' : 'BASE'}]);pack(&buffer[0]);CB cb=target;cb();}`;
  const files = analyzer.derive([{ ...analyzer.analyze('file:///demo/offset.c', source), expandMacros: false }]);
  assert.equal(files.some(file => file.issues.some(issue => /Callback (mutation|region) limit/.test(issue))), false);
  const index = new RelationIndex();files.forEach(file => index.update(file));
  assert.ok(inferred(index, 'run').find(group => group.name === 'target')?.sites.every(site => !site.inference?.incomplete));
});

test('address offset dependencies do not hide actual scalar callback selectors', () => {
  const index = project(`typedef void(*CB)(void);void first(void){}void second(void){}static CB table[2]={first,second};
    static unsigned selected[4];static void select(unsigned*p){p[1]=1;}
    void run(void){selected[2]=0;select(&selected[1]);table[selected[2]]();}`);
  assert.ok(inferred(index, 'run').some(group => group.name === 'second'));
});

for (const variant of ['pointer guard', 'member address', 'member decay']) test(`address-only dependencies do not retain numeric buffer effects (${variant})`, () => {
  const writes = Array.from({ length: 400 }, (_, n) => `regs[${n}]=0;`).join('');
  const source = `typedef void(*CB)(void);void first(void){}void second(void){}static CB table[2]={first,second};
    struct Config{unsigned short buffer[1024];unsigned selected;CB cb;};static struct Config config={.selected=1,.cb=first};
    static void pack(unsigned short*regs){${variant === 'pointer guard' ? 'if(regs){' : ''}${writes}${variant === 'pointer guard' ? '}' : ''}}
    void run(unsigned offset){pack(${variant === 'member decay' ? 'config.buffer' : '&config.buffer[offset]'});table[config.selected]();config.cb();}`;
  const index = project(source);
  assert.equal([...index.files.values()].some(file => file.issues.some(issue => /Callback (mutation|region) limit/.test(issue))), false);
  assert.ok(inferred(index, 'run').some(group => group.name === 'first'));
  assert.ok(inferred(index, 'run').some(group => group.name === 'second'));
});

test('scalar selector pointees stored in aggregate initializers retain helper effects', () => {
  const index = project(`typedef void(*CB)(void);void first(void){}void second(void){}static CB table[2]={first,second};
    static unsigned selected;struct Holder{unsigned*p;};static struct Holder holder={&selected};
    static void configure(void){selected=1;}void run(void){selected=0;configure();table[*holder.p]();}`);
  assert.deepEqual(inferred(index, 'run').map(group => group.name), ['second']);
});

for (const count of [270, 2700]) test(`${count} unread scalar fields do not exhaust one callback's effect summary`, () => {
  const fields = Array.from({length: count}, (_, n) => `int status${n};`).join('');
  const writes = Array.from({length: count}, (_, n) => `object.status${n}=0;`).join('');
  const index = project(`typedef void (*CB)(void);static void target(void){}
    struct Object{${fields}CB callback;};static struct Object object;
    static void configure(void){${writes}object.callback=target;}
    void run(void){object.callback();}`);
  assert.equal([...index.files.values()].some(file => file.issues.some(issue => issue.includes('mutation limit'))), false);
  assert.deepEqual(inferred(index, 'run').map(group => group.name), ['target']);
  assert.equal(inferred(index, 'run')[0].sites.some(site => site.inference?.incomplete), false);
});

for (const selector of [
  {name: 'global', declarations: 'static unsigned active_index;', helper: 'static void select_second(void){active_index=1;}',
    run: 'active_index=0;select_second();table[active_index]();'},
  {name: 'member through a parameter', declarations: 'struct Selector{unsigned index;};static struct Selector selection;',
    helper: 'static void select_second(struct Selector *p){p->index=1;}',
    run: 'selection.index=0;select_second(&selection);table[selection.index]();'},
  {name: 'address alias', declarations: 'static unsigned active_index;', helper: 'static void select_second(void){active_index=1;}',
    run: 'active_index=0;unsigned *selected=&active_index;select_second();table[*selected]();'}
]) test(`scalar array selectors (${selector.name}) retain helper effects`, () => {
  const index = project(`typedef void (*CB)(void);static void first(void){}static void second(void){}
    static CB table[2]={first,second};${selector.declarations}${selector.helper}
    void run(void){${selector.run}}`);
  assert.deepEqual(inferred(index, 'run').map(group => group.name), ['second']);
  assert.equal(inferred(index, 'run')[0].sites.some(site => site.inference?.incomplete), false);
});

test('lane and group callback copies retain actual targets and reverse callers without invoking registrations', () => {
  const source = `
    typedef void (*Complete)(void *,int,void *,unsigned,void *);
    struct Owner{int status;};
    struct Group{
      unsigned completed,pending_mask,success_mask,active_mask,submit_finished,generation;
      int first_error;Complete cb_complete;void *complete_user_data;void *handle;
    };
    struct Lane{struct Group *group;unsigned generation,parallel_idx;};
    static void rack_complete(void *ctx,int result,void *handle,unsigned mask,void *data){}
    static void rbms_complete(void *ctx,int result,void *handle,unsigned mask,void *data){}
    static void unrelated_complete(void *ctx,int result,void *handle,unsigned mask,void *data){}
    static struct Group rack_groups[2],rbms_group;
    static struct Group unrelated_group={.cb_complete=unrelated_complete};
    static struct Owner owners[2],rbms_owner;
    static struct Lane rack_lane,rbms_lane;
    static void configure(void){
      for(unsigned index=0;index<2;index++){
        rack_groups[index].cb_complete=rack_complete;
        rack_groups[index].complete_user_data=&owners[index];
      }
      rbms_group.cb_complete=rbms_complete;
      rbms_group.complete_user_data=&rbms_owner;
      rack_lane.group=&rack_groups[0];rbms_lane.group=&rbms_group;
    }
    static void complete_group(void *ctx,struct Group *group){
      if(group->completed==0 && group->pending_mask==0){
        Complete cb_complete=group->cb_complete;
        void *complete_user_data=group->complete_user_data;
        void *completed_handle=group->handle;
        unsigned success_mask=group->success_mask;
        int result=group->first_error;
        group->active_mask=0;group->pending_mask=0;group->handle=0;
        group->submit_finished=0;group->completed=1;
        cb_complete(ctx,result,completed_handle,success_mask,complete_user_data);
      }
    }
    static void complete_lane(void *ctx,struct Lane *lane,int result){
      struct Group *group=lane->group;
      unsigned lane_mask=1 << lane->parallel_idx;
      if(lane->generation==group->generation && (group->pending_mask & lane_mask)!=0){
        if(result==0)group->success_mask|=lane_mask;
        else if(group->first_error==0)group->first_error=result;
        group->pending_mask&=~lane_mask;
        if(group->pending_mask==0 && group->submit_finished!=0)complete_group(ctx,group);
      }
    }
    void run(void){
      configure();complete_lane(0,&rack_lane,0);complete_lane(0,&rbms_lane,0);
    }`;
  const index = project(source);
  assert.deepEqual(inferred(index, 'complete_group').map(group => group.name).sort(), ['rack_complete', 'rbms_complete']);
  const graph = index.graph(symbol(index, 'complete_group').id, 'both', 1)!;
  assert.deepEqual(graph.root.children.filter(node => node.callKind === 'inferred').map(node => node.name).sort(), ['rack_complete', 'rbms_complete']);
  for (const name of ['rack_complete', 'rbms_complete']) {
    assert.deepEqual(index.relations(symbol(index, name).id, 'callers').map(group => group.name), ['complete_group', 'configure']);
    const registration = index.relations(symbol(index, 'configure').id, 'callees').find(group => group.name === name)!;
    assert.equal(registration.callKind, 'registered');
    assert.ok(registration.sites.every(site => site.kind === 'reference'));
  }
  const unrelated = index.relations(symbol(index, 'unrelated_complete').id, 'callers');
  assert.deepEqual(unrelated.map(group => group.name), ['unrelated_group']);
  assert.ok(unrelated[0].sites.every(site => site.kind === 'reference' && site.callKind === 'registered'));
});

for (const reader of ['same object', 'different struct', 'different struct selector']) test(`logged scalar effects do not consume the callback budget (${reader})`, () => {
  const fields = Array.from({ length: 270 }, (_, n) => `int status${n};`).join('');
  const writes = Array.from({ length: 270 }, (_, n) => `data.status${n}=0;`).join('');
  const logs = Array.from({ length: 270 }, (_, n) => `log_int(${reader === 'same object' ? 'data' : 'other'}.status${n});`).join('');
  const index = project(`typedef void(*CB)(void);static void target(void){}static void second(void){}
    struct Data{${fields}};static struct Data data;
    struct Other{${fields}};static struct Other other;static CB table[2]={target,second};
    void log_int(int);void logger(void){${logs}}
    void heavy(void){${writes}}
    void run(void){CB saved=target;heavy();${reader === 'different struct selector' ? 'table[other.status269]();' : ''}saved();}`);
  assert.equal([...index.files.values()].some(file => file.issues.some(issue => /mutation limit|region limit/.test(issue))), false);
  assert.ok(inferred(index, 'run').find(group => group.name === 'target')?.sites.every(site => site.inference?.incomplete === false));
});

test('unrelated scalar addresses and their parent do not consume region entries', () => {
  const fields = Array.from({ length: 270 }, (_, n) => `int status${n};`).join('');
  const escapes = Array.from({ length: 270 }, (_, n) => `opaque(&data.status${n});`).join('');
  const index = project(`typedef void(*CB)(void);static void target(void){}
    struct Data{${fields}};static struct Data data;void opaque(void*);
    void heavy(void){opaque(&data);${escapes}}
    void run(void){CB saved=target;heavy();saved();}`);
  assert.equal([...index.files.values()].some(file => file.issues.some(issue => /mutation limit|region limit/.test(issue))), false);
  assert.deepEqual(inferred(index, 'run').map(group => group.name), ['target']);
  assert.ok(inferred(index, 'run')[0].sites.every(site => site.inference?.incomplete === false));
});

test('a scalar selector copied through an address alias retains its helper effect among logged fields', () => {
  const fields = Array.from({ length: 270 }, (_, n) => `int status${n};`).join('');
  const writes = Array.from({ length: 270 }, (_, n) => `data.status${n}=0;`).join('');
  const logs = Array.from({ length: 270 }, (_, n) => `log_int(data.status${n});`).join('');
  const index = project(`typedef void(*CB)(void);static void first(void){}static void second(void){}
    static CB table[2]={first,second};struct Data{${fields}unsigned selected;};static struct Data data;
    void log_int(int);void logger(void){${logs}}static void configure(void){${writes}data.selected=1;}
    void run(void){data.selected=0;unsigned *alias=&data.selected;configure();unsigned copied=*alias;table[copied]();}`);
  assert.equal([...index.files.values()].some(file => file.issues.some(issue => /mutation limit|region limit/.test(issue))), false);
  assert.deepEqual(inferred(index, 'run').map(group => group.name), ['second']);
  assert.ok(inferred(index, 'run')[0].sites.every(site => site.inference?.incomplete === false));
});

for (const variant of ['global alias', 'output parameter', 'pointer getter']) test(`scalar selector dependencies survive ${variant}`, () => {
  const index = project(`typedef void(*CB)(void);static void first(void){}static void second(void){}
    static CB table[2]={first,second};static unsigned selected;static unsigned *alias=&selected;
    static void configure(void){selected=1;}${variant === 'output parameter' ? 'static void copy(unsigned*out){*out=selected;}' : ''}
    ${variant === 'pointer getter' ? 'static unsigned *get_selected(void){return &selected;}' : ''}
    void run(void){selected=0;configure();${variant === 'global alias' ? 'table[*alias]();' : variant === 'pointer getter' ? 'table[*get_selected()]();' : 'unsigned copied=0;copy(&copied);table[copied]();'}}`);
  assert.deepEqual(inferred(index, 'run').map(group => group.name), variant === 'output parameter' ? ['first', 'second'] : ['second']);
  assert.ok(inferred(index, 'run')[0].sites.every(site => site.inference?.incomplete === false));
});

test('scalar getters used only for logging do not retain their source effects', () => {
  const fields = Array.from({ length: 270 }, (_, n) => `int status${n};`).join('');
  const writes = Array.from({ length: 270 }, (_, n) => `data.status${n}=0;`).join('');
  const getters = Array.from({ length: 270 }, (_, n) => `static int sample${n}(void){return data.status${n};}`).join('');
  const logs = Array.from({ length: 270 }, (_, n) => `log_int(sample${n}());`).join('');
  const index = project(`typedef void(*CB)(void);static void target(void){}static CB cb=target;
    struct Data{${fields}};static struct Data data;void log_int(int);${getters}
    void configure(void){${writes}}void logger(void){${logs}}void run(void){cb();}`);
  assert.equal([...index.files.values()].some(file => file.issues.some(issue => /mutation limit|region limit/.test(issue))), false);
});

test('opaque writes to a relevant scalar selector retain uncertainty', () => {
  const index = project(`typedef void(*CB)(void);static void first(void){}static void second(void){}
    static CB table[2]={first,second};static unsigned selected;void opaque(void*);
    void run(void){selected=0;opaque(&selected);table[selected]();}`);
  assert.deepEqual(inferred(index, 'run').map(group => group.name).sort(), ['first', 'second']);
});

test('ignoring scalar child addresses does not hide opaque writes to the parent callback', () => {
  const fields = Array.from({ length: 270 }, (_, n) => `int status${n};`).join('');
  const escapes = Array.from({ length: 270 }, (_, n) => `opaque(&data.status${n});`).join('');
  const index = project(`typedef void(*CB)(void);static void target(void){}
    struct Data{${fields}CB cb;};static struct Data data;void opaque(void*);
    void run(void){data.cb=target;opaque(&data);${escapes}data.cb();}`);
  assert.equal([...index.files.values()].some(file => file.issues.some(issue => /mutation limit|region limit/.test(issue))), false);
  assert.ok(index.relations(symbol(index, 'run').id, 'callees').some(group => group.callKind === 'indirect'));
  assert.equal(inferred(index, 'run').some(group => group.sites.some(site => site.kind === 'call' && site.inference?.incomplete === false)), false);
});

for (const count of [256, 257]) test(`the mutation budget still applies to ${count} relevant integer selectors`, () => {
  const fields = Array.from({ length: count }, (_, n) => `unsigned index${n};`).join('');
  const writes = Array.from({ length: count }, (_, n) => `data.index${n}=1;`).join('');
  const reads = Array.from({ length: count }, (_, n) => `table[data.index${n}]();`).join('');
  const index = project(`typedef void(*CB)(void);static void first(void){}static void second(void){}
    static CB table[2]={first,second};struct Data{${fields}};static struct Data data;
    static void configure(void){${writes}}void run(void){configure();${reads}}`);
  assert.equal([...index.files.values()].some(file => file.issues.some(issue => issue.includes('mutation limit'))), count > 256);
  assert.ok(inferred(index, 'run').some(group => group.name === 'second'));
  assert.equal(inferred(index, 'run').some(group => group.name === 'first'), count > 256);
});

for (const scope of ['different functions', 'nested blocks']) test(`same-named local struct tags do not share scalar dependencies (${scope})`, () => {
  const fields = Array.from({ length: 270 }, (_, n) => `unsigned status${n};`).join('');
  const writes = Array.from({ length: 270 }, (_, n) => `data.status${n}=0;`).join('');
  const reads = Array.from({ length: 270 }, (_, n) => `table[other.status${n}]();`).join('');
  const writer = `struct Data{${fields}};static struct Data data;${writes}`;
  const reader = `struct Data{${fields}};static struct Data other;${reads}`;
  const index = project(`typedef void(*CB)(void);static void first(void){}static void second(void){}
    static CB table[2]={first,second};${scope === 'different functions'
      ? `static void heavy(void){${writer}}void run(void){heavy();${reader}}`
      : `void run(void){{${writer}}{${reader}}}`}`);
  assert.equal([...index.files.values()].some(file => file.issues.some(issue => /mutation limit|region limit/.test(issue))), false);
  assert.deepEqual(inferred(index, 'run').map(group => group.name).sort(), ['first', 'second']);
});

for (const storage of ['array element', 'pointer dereference']) test(`relevant scalar writes through ${storage} remain in helper summaries`, () => {
  const index = project(`typedef void(*CB)(void);static void first(void){}static void second(void){}
    static CB table[2]={first,second};static unsigned selected[1];
    ${storage === 'array element' ? 'static void configure(void){selected[0]=1;}' : 'static void configure(unsigned*out){*out=1;}'}
    void run(void){selected[0]=0;${storage === 'array element' ? 'configure();' : 'configure(&selected[0]);'}table[selected[0]]();}`);
  assert.deepEqual(inferred(index, 'run').map(group => group.name), ['second']);
  assert.ok(inferred(index, 'run').every(group => group.sites.every(site => site.inference?.incomplete === false)));
});

test('mutation diagnostics identify the first omitted storage and the retained sample', () => {
  const fields = Array.from({ length: 257 }, (_, n) => `CB cb${n};`).join('');
  const writes = Array.from({ length: 257 }, (_, n) => `data.cb${n}=target;`).join('');
  const index = project(`typedef void(*CB)(void);void target(void){}struct Data{${fields}};static struct Data data;
    void configure(void){${writes}}void run(void){configure();data.cb256();}`);
  const diagnostics = [...index.files.values()].flatMap(file => file.callbackDiagnostics ?? []);
  const detail = diagnostics.find(detail => detail.kind === 'mutation' && detail.symbol === 'configure')!;
  assert.ok(detail);
  assert.equal(detail.storage?.operation, 'write');
  assert.equal(detail.storage?.retained, 256);
  assert.match(detail.storage?.omitted ?? '', /data\.cb256$/);
  assert.ok(detail.storage!.sample.length <= 8);
  assert.match(detail.storage!.sample[0], /data\.cb0$/);
  const costs = diagnostics.flatMap(detail => detail.costs ?? []);
  assert.ok(costs.length > 0 && costs.length <= 8);
  const configure = costs.find(cost => cost.symbol === 'configure')!;
  assert.ok(configure.runs >= 1);
  assert.ok(configure.evaluations > 257);
  assert.ok(configure.elapsedMs >= 0);
  const cached = costs.find(cost => cost.symbol === 'target')!;
  assert.equal(cached.runs, 1, 'cache hits must not be counted as body evaluations');
  assert.ok(cached.cacheHits >= 1);
});

for (const type of ['uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'int32_t', 'uintptr_t', 'size_t'])
  test(`unindexed standard scalar ${type} fields do not exhaust callback effects`, () => {
    const fields = Array.from({ length: 257 }, (_, n) => `${type} status${n};`).join('');
    const writes = Array.from({ length: 257 }, (_, n) => `data.status${n}=0;`).join('');
    const index = project(`typedef void(*CB)(void);void target(void){}struct Data{${fields}CB cb;};static struct Data data;
      void configure(void){${writes}data.cb=target;}void run(void){configure();data.cb();}`);
    assert.equal([...index.files.values()].some(file => file.issues.some(issue => /mutation limit|region limit/.test(issue))), false);
    assert.deepEqual(inferred(index, 'run').map(group => group.name), ['target']);
    assert.ok(inferred(index, 'run').every(group => group.sites.every(site => !site.inference?.incomplete)));
  });

test('primitive typedef declarators are collected and visible aliases keep their scalar type', () => {
  const fields = Array.from({ length: 257 }, (_, n) => `Counter status${n};`).join('');
  const writes = Array.from({ length: 257 }, (_, n) => `data.status${n}=0;`).join('');
  const index = project(`typedef unsigned int uint32_t;typedef uint32_t Counter;
    typedef void(*CB)(void);void target(void){}struct Data{${fields}CB cb;};static struct Data data;
    void configure(void){${writes}data.cb=target;}void run(void){configure();data.cb();}`);
  assert.ok(index.symbols().some(symbol => symbol.kind === 'type' && symbol.name === 'uint32_t'));
  assert.equal([...index.files.values()].some(file => file.issues.some(issue => /mutation limit|region limit/.test(issue))), false);
  assert.deepEqual(inferred(index, 'run').map(group => group.name), ['target']);
  assert.ok(inferred(index, 'run').every(group => group.sites.every(site => !site.inference?.incomplete)));
});

test('visible callback aliases take priority over standard scalar fallback names', () => {
  const index = project(`typedef void(*uint32_t)(void);void target(void){}struct Data{uint32_t cb;};static struct Data data;
    void configure(void){data.cb=target;}void run(void){configure();data.cb();}`);
  assert.deepEqual(inferred(index, 'run').map(group => group.name), ['target']);
  assert.ok(inferred(index, 'run').every(group => group.sites.every(site => !site.inference?.incomplete)));
});

for (const type of ['unsigned char', 'uint8_t']) for (const form of ['parameter', 'array initializer'])
  test(`${type} byte ${form} preserves its element type without callback mutation slots`, () => {
    const writes = Array.from({ length: 270 }, (_, n) => `dst[${n}]=0;`).join('');
    const zeros = Array.from({ length: 270 }, () => '0').join(',');
    const index = project(`typedef void(*CB)(void);void target(void){}static CB cb=target;static ${type} bytes[270];
      ${form === 'parameter' ? `void pack(${type}*dst){${writes}}` : `void pack(void){static ${type} dst[270]={${zeros}};}`}
      void run(void){${form === 'parameter' ? 'pack(bytes);' : 'pack();'}cb();}`);
    assert.equal([...index.files.values()].some(file => file.issues.some(issue => /mutation limit|region limit/.test(issue))), false);
    assert.deepEqual(inferred(index, 'run').map(group => group.name), ['target']);
    assert.ok(inferred(index, 'run').every(group => group.sites.every(site => !site.inference?.incomplete)));
  });

for (const form of ['array', 'dereference']) test(`uint32_t ${form} callback selectors retain helper writes`, () => {
  const index = project(`typedef unsigned int uint32_t;typedef void(*CB)(void);void first(void){}void second(void){}
    static CB table[2]={first,second};static uint32_t selected[1];
    ${form === 'array' ? 'void configure(void){selected[0]=1;}' : 'void configure(uint32_t*out){*out=1;}'}
    void run(void){selected[0]=0;${form === 'array' ? 'configure();' : 'configure(&selected[0]);'}table[selected[0]]();}`);
  assert.deepEqual(inferred(index, 'run').map(group => group.name), ['second']);
  assert.ok(inferred(index, 'run').every(group => group.sites.every(site => !site.inference?.incomplete)));
});

for (const operation of ['memcpy', 'memmove', 'memset']) for (const wrapper of [false, true])
  test(`${operation} changes destination storage without changing source or pointees (wrapper=${wrapper})`, () => {
    const argumentsText = operation === 'memset' ? 'p,0,sizeof(*p)' : 'p,&source,sizeof(*p)';
    const index = project(`typedef void(*CB)(void);void first(void){}void second(void){}
      struct Ops{CB cb;struct Ops*link;};static struct Ops source={first},pointee={second};
      void *${operation}(void*,${operation === 'memset' ? 'int' : 'const void*'},unsigned long);
      ${wrapper ? `void clear(struct Ops*p){${operation}(${argumentsText});}` : ''}
      void run(void){struct Ops destination={second,&pointee};
        ${wrapper ? 'clear(&destination);' : `${operation}(${argumentsText.replace('p,', '&destination,').replace('sizeof(*p)', 'sizeof(destination)')});`}
        source.cb();pointee.cb();destination.cb();}`);
    const groups = index.relations(symbol(index, 'run').id, 'callees');
    for (const expression of ['source.cb', 'pointee.cb']) {
      assert.ok(groups.some(group => group.callKind === 'inferred' && group.sites.some(site => site.inference?.expression === expression && !site.inference.incomplete)), expression);
      assert.equal(groups.some(group => group.callKind === 'indirect' && group.sites.some(site => site.inference?.expression === expression)), false, expression);
    }
    assert.ok(groups.some(group => group.callKind === 'indirect' && group.sites.some(site => site.inference?.expression === 'destination.cb')));
    assert.equal(groups.some(group => group.callKind === 'inferred' && group.sites.some(site => site.kind === 'call' && site.inference?.expression === 'destination.cb' && !site.inference.incomplete)), false);
  });

for (const operation of ['memcpy', 'memmove', 'memset']) test(`${operation} with zero length preserves callbacks and returns the destination alias`, () => {
  const index = project(`typedef void(*CB)(void);void first(void){}void second(void){}
    struct Ops{CB cb;};void *${operation}(void*,${operation === 'memset' ? 'int' : 'const void*'},unsigned long);
    void run(void){struct Ops source={first},destination={second};
      struct Ops*alias=${operation}(&destination,${operation === 'memset' ? '0' : '&source'},0);alias->cb();source.cb();}`);
  assert.deepEqual(inferred(index, 'run').map(group => group.name).sort(), ['first', 'second']);
  assert.ok(inferred(index, 'run').every(group => group.sites.every(site => !site.inference?.incomplete)));
});

for (const operation of ['memcpy', 'memmove', 'memset']) test(`270 ${operation} byte writes do not consume callback regions`, () => {
  const writes = Array.from({ length: 270 }, (_, n) => `${operation}(&dst[${n}],${operation === 'memset' ? '0' : `&src[${n}]`},1);`).join('');
  const index = project(`typedef void(*CB)(void);void target(void){}static CB cb=target;
    void *${operation}(void*,${operation === 'memset' ? 'int' : 'const void*'},unsigned long);
    void pack(unsigned char*src,unsigned char*dst){${writes}}
    static unsigned char a[270],b[270];void run(void){pack(a,b);cb();}`);
  assert.equal([...index.files.values()].some(file => file.issues.some(issue => /mutation limit|region limit/.test(issue))), false);
  assert.deepEqual(inferred(index, 'run').map(group => group.name), ['target']);
  assert.ok(inferred(index, 'run').every(group => group.sites.every(site => !site.inference?.incomplete)));
});

test('an indexed memcpy body takes priority over the standard memory model', () => {
  const index = project(`typedef void(*CB)(void);void first(void){}void second(void){}
    struct Ops{CB cb;};void *memcpy(void*dst,void*src,unsigned long count){struct Ops*p=src;p->cb=second;return dst;}
    void run(void){struct Ops source={first},destination={first};memcpy(&destination,&source,1);source.cb();}`);
  assert.deepEqual(inferred(index, 'run').map(group => group.name), ['second']);
});

test('memory writes to a callback selector remain uncertain', () => {
  const index = project(`typedef void(*CB)(void);void first(void){}void second(void){}
    static CB table[2]={first,second};static unsigned selected;void *memset(void*,int,unsigned long);
    void clear(void){memset(&selected,0,sizeof(selected));}
    void run(void){selected=0;clear();table[selected]();}`);
  assert.deepEqual(inferred(index, 'run').map(group => group.name).sort(), ['first', 'second']);
});

test('memory writes through an array element cover later destination elements without following pointees', () => {
  const index = project(`typedef void(*CB)(void);void first(void){}void second(void){}struct Ops{CB cb;struct Ops*link;};
    static struct Ops pointee={second};void *memset(void*,int,unsigned long);
    void clear(struct Ops*p){memset(p,0,100);}
    void run(void){struct Ops slots[2]={{first,&pointee},{first,&pointee}};clear(&slots[0]);slots[1].cb();pointee.cb();}`);
  const groups = index.relations(symbol(index, 'run').id, 'callees');
  assert.ok(groups.some(group => group.callKind === 'indirect' && group.sites.some(site => site.inference?.expression === 'slots[1].cb')));
  assert.ok(inferred(index, 'run').find(group => group.name === 'second')?.sites.every(site => !site.inference?.incomplete));
});

test('a byte range starting in a scalar field does not mark its entire callback array as ignored', () => {
  const index = project(`typedef void(*CB)(void);void target(void){}struct Ops{unsigned status;CB cb;};
    void *memset(void*,int,unsigned long);void run(void){struct Ops slots[2]={{0,target},{0,target}};
      memset(&slots[0].status,0,100);slots[1].cb();}`);
  assert.ok(index.relations(symbol(index, 'run').id, 'callees').some(group => group.callKind === 'indirect'));
});

for (const type of ['void', 'unsigned char']) test(`memory writes through a ${type} pointer helper still invalidate supplied callback storage`, () => {
  const index = project(`typedef void(*CB)(void);void target(void){}struct Ops{CB cb;};void *memset(void*,int,unsigned long);
    void clear(${type}*p){memset(p,0,100);}void run(void){struct Ops object={target};clear((${type}*)&object);object.cb();}`);
  assert.ok(index.relations(symbol(index, 'run').id, 'callees').some(group => group.callKind === 'indirect'));
  assert.equal(inferred(index, 'run').some(group => group.sites.some(site => site.kind === 'call' && !site.inference?.incomplete)), false);
});
