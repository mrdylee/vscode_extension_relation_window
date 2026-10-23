// Photo-derived reduced model, not the unavailable WSL source corpus.
// Only cb_preprocess's void(void) signature is material here; other callbacks
// are simplified stubs. Error-code macro bodies and device I/O are unavailable.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createAnalyzer } from '../../src/analyzer';
import { RelationIndex } from '../../src/relations';

async function main() {
  const analyzer = await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'), path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm'));
  const fields = ['cb_preprocess', 'cb_prepare_rack_fetch', 'cb_sync_fetch_ready', 'cb_is_rack_fetchable', 'cb_is_rack_disabled', 'cb_is_fetch_allowed', 'cb_submit_rack_nonfs_fetch', 'cb_submit_lcs_nonfs_fetch'];
  const header = `typedef int int32_t;typedef unsigned char uint8_t;typedef void* svc_ctx_t;
    struct safety_data_non_safety_callbacks{${fields.map(field => `void(*${field})(void);`).join('')}};
    const struct safety_data_non_safety_callbacks*product_task_data_get_safety_non_safety_callbacks(void);
    int32_t safety_task_data_stage_init(svc_ctx_t,uint8_t*,const struct safety_data_non_safety_callbacks*);
    int FS_PRODUCT_ERR_CODE(int,int,unsigned);void safety_task_data_diag_set_rack_disabled_callback(void(*)(void));`;
  const product = `#include "api.h"
    static void priv_data_non_safety_preprocess(void){}
    static void other_callback(void){}
    static const struct safety_data_non_safety_callbacks priv_data_safety_non_safety_callbacks={
      ${fields.map((field,n) => `.${field}=${n ? 'other_callback' : 'priv_data_non_safety_preprocess'}`).join(',')}};
    const struct safety_data_non_safety_callbacks*product_task_data_get_safety_non_safety_callbacks(void){
      return &priv_data_safety_non_safety_callbacks;}`;
  const stage = `#include "api.h"
    static svc_ctx_t priv_data_ctx;static uint8_t*priv_safety_fetch_result;
    static const struct safety_data_non_safety_callbacks*priv_non_safety_callbacks;
    int32_t safety_task_data_stage_init(svc_ctx_t data_ctx,uint8_t*fetch_result,const struct safety_data_non_safety_callbacks*cbs){
      int32_t ret=0;
      if((ret==0)&&(data_ctx==0))ret=FS_PRODUCT_ERR_CODE(1,2,13U);
      if((ret==0)&&(fetch_result==0))ret=FS_PRODUCT_ERR_CODE(1,2,1U);
      if((ret==0)&&(cbs==0))ret=FS_PRODUCT_ERR_CODE(1,2,2U);
      ${fields.map((field,n) => `if((ret==0)&&(cbs->${field}==0))ret=FS_PRODUCT_ERR_CODE(1,2,${n+3}U);`).join('')}
      if(ret==0){priv_data_ctx=data_ctx;priv_safety_fetch_result=fetch_result;priv_non_safety_callbacks=cbs;
        safety_task_data_diag_set_rack_disabled_callback(cbs->cb_is_rack_disabled);}
      return ret;
    }
    static int32_t priv_run_stage_preprocess(void){int32_t ret=0;
      if(priv_non_safety_callbacks==0)ret=FS_PRODUCT_ERR_CODE(1,2,7U);
      if(ret==0){if(priv_non_safety_callbacks->cb_preprocess!=0){priv_non_safety_callbacks->cb_preprocess();}}
      return ret;
    }
    int32_t priv_task_data_safety_preprocess(void){return priv_run_stage_preprocess();}`;
  const control = `#include "api.h"
    svc_ctx_t product_task_data_get_ctx(void);int priv_ctrl_config(svc_ctx_t,uint8_t);int priv_ctrl_setup(svc_ctx_t);
    static uint8_t priv_ctrl_fetch_result;
    static int32_t priv_ctrl_start(svc_ctx_t ctx,unsigned mode,uint8_t*mac){int32_t ret=0;(void)mac;
      ret=priv_ctrl_config(ctx,(uint8_t)mode);
      if(ret==0){ret=priv_ctrl_setup(ctx);}
      if(ret==0){ret=safety_task_data_stage_init(product_task_data_get_ctx(),&priv_ctrl_fetch_result,product_task_data_get_safety_non_safety_callbacks());}
      return ret;}
    int32_t start(svc_ctx_t ctx){return priv_ctrl_start(ctx,0,0);}`;
  for (const item of [
    { order: ['product.c','stage.c','control.c'], stopped: false },
    { order: ['control.c','stage.c','product.c'], stopped: false },
    { order: ['stage.c','product.c','control.c'], stopped: false },
    { order: ['product.c','stage.c','control.c'], stopped: true }
  ]) {
    const { order, stopped } = item;
    analyzer.reset();
    const sources: Record<string,string> = { 'api.h': header, 'product.c': product, 'stage.c': stage, 'control.c': control };
    const raw = ['api.h',...order].map(name => analyzer.analyze('file:///photo-chain/'+name,sources[name]));
    assert.deepEqual(raw.flatMap(file => file.issues), []);
    // Simulate a consumed deadline to check the UI's missing-reason path.
    // This is fault injection, not a timing reproduction of the WSL project.
    const descriptor = Object.getOwnPropertyDescriptor(performance, 'now');
    const now = performance.now.bind(performance); let clockReads = 0;
    if (stopped) Object.defineProperty(performance, 'now', { configurable: true, value: () => now() + (++clockReads > 1 ? 10_001 : 0) });
    let files;
    try { files = analyzer.derive(raw,undefined,undefined,true); }
    finally { if (stopped) { if (descriptor) Object.defineProperty(performance, 'now', descriptor); else delete (performance as any).now; } }
    const index = new RelationIndex();files.forEach(file => index.update(file));
    const fn = index.symbols().find(symbol => symbol.kind==='function'&&symbol.name==='priv_run_stage_preprocess')!;
    const calls = index.relations(fn.id,'callees');
    const target = calls.find(group => group.callKind==='inferred'&&group.name==='priv_data_non_safety_preprocess');
    console.log(JSON.stringify({order,simulatedDeadline:stopped,diagnostics:files.flatMap(file=>file.callbackDiagnostics??[]),calls:calls.map(group=>({name:group.name,kind:group.callKind,sites:group.sites.map(site=>({incomplete:site.inference?.incomplete,reasons:site.inference?.reasons}))}))}));
    if (!stopped) {
      assert.ok(target,'getter -> third argument -> guarded global store must retain the callback target');
      assert.ok(target.sites.every(site => site.inference?.incomplete === false));
    } else {
      const uri = 'file:///photo-chain/stage.c';
      const callback = index.callbackAt(uri, stage.lastIndexOf('cb_preprocess();')+2);
      console.log(JSON.stringify({simulatedDeadline: true, callback}));
      assert.ok(files.some(file => file.callbackDiagnostics?.some(detail => detail.kind === 'time')));
      assert.ok(callback && callback.targets.some(target => target.name === 'priv_data_non_safety_preprocess'));
      assert.equal(callback.incomplete, true);
      assert.ok(callback.reasons.some(reason => reason.includes('not evaluated')));
      assert.ok(callback.reasons.some(reason => reason.includes('10 seconds')));
    }
  }
}
main().catch(error => {console.error(error);process.exitCode=1;});
