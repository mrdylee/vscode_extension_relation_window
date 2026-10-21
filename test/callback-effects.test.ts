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
