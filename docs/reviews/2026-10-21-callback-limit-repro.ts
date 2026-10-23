import path from 'node:path';
import {createAnalyzer} from '../../src/analyzer';
import {RelationIndex} from '../../src/relations';
(async()=>{
 const analyzer=await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'),path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm'));
 const fields=Array.from({length:270},(_,i)=>`int status${i};`).join('');
 const writes=Array.from({length:270},(_,i)=>`data.status${i}=0;`).join('');
 const reads=Array.from({length:270},(_,i)=>`log_int(data.status${i});`).join('');
 const opaque=Array.from({length:270},(_,i)=>`opaque(&data.status${i});`).join('');
 const callback=`typedef void(*CB)(void); static void target(void){} struct Ops{CB cb;};
 static const struct Ops registered={.cb=target}; static const struct Ops *active;
 static const struct Ops* get_ops(void){return &registered;}
 static void init(const struct Ops* p){active=p;} void setup(void){init(get_ops());}
 void run(void){active->cb();}`;
 const cases=[
 ...[255,256,257].map(n=>['region-boundary-'+n,callback+`struct Data{${fields}};static struct Data data;void opaque(void*);void heavy(void){${Array.from({length:n},(_,i)=>`opaque(&data.status${i});`).join('')}}`]),
 ['baseline',callback],
 ['write-only-scalars',callback+`struct Data{${fields}};static struct Data data;static void heavy(void){${writes}}`],
 ['logged-scalars',callback+`struct Data{${fields}};static struct Data data;void log_int(int);static void heavy(void){${writes}}void log_data(void){${reads}}`],
 ['unrelated-scalar-regions',callback+`struct Data{${fields}};static struct Data data;void opaque(void*);void heavy(void){${opaque}}`],
 ['parent-and-child-regions',callback+`struct Data{${fields}};static struct Data data;void opaque(void*);void heavy(void){opaque(&data);${opaque}}`],
 ];
 for(const [name,source] of cases){
  analyzer.reset(); const start=performance.now(); const raw=analyzer.analyze('file:///investigation/'+name+'.c',source);
  const files=analyzer.derive([raw],undefined,undefined,true);const index=new RelationIndex();files.forEach(f=>index.update(f));
  const run=index.symbols().find(s=>s.kind==='function'&&s.name==='run')!;
  console.log(JSON.stringify({name,ms:Math.round(performance.now()-start),syntax:raw.issues,diagnostics:files.flatMap(f=>f.callbackDiagnostics??[]).map(d=>({symbol:d.symbol,message:d.message,slots:d.slots})),calls:index.relations(run.id,'callees').map(g=>({name:g.name,kind:g.callKind,sites:g.sites.map(s=>({incomplete:s.inference?.incomplete,reasons:s.inference?.reasons}))}))}));
 }
})();
