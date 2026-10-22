import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const script=await readFile('dist/webview.js'),css=await readFile('dist/webview.css');
const server=createServer((req,res)=>{if(req.url==='/app.js')res.end(script);else if(req.url==='/app.css')res.end(css);else res.end('<!doctype html><html lang="en"><link rel="stylesheet" href="/app.css"><body data-view="relation"><div id="app"></div><script src="/app.js"></script></body></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:900,height:720}});
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const at={uri:'file:///project/main.c',start:100,end:102,line:4,column:1,endLine:4,endColumn:3};
 const site={id:'ai-site',name:'wrong',kind:'call',access:'read',targetId:'wrong',callKind:'ai-candidate',location:at,conditions:[],ambiguous:true,inference:{expression:'ops->cb',incomplete:true,reasons:[],evidence:[]}};
 const node={key:'run/wrong',symbolId:'wrong',name:'wrong',kind:'function',definition:true,location:at,callKind:'ai-candidate',sites:[site],conditions:[],children:[],cycle:false,expanded:false,ambiguous:true};
 const state={graph:{root:{...node,key:'run',symbolId:'run',name:'run',callKind:undefined,sites:[],children:[node]},truncated:false},candidates:[],status:'Basic navigation ready',fileCount:1,issues:[],mode:'callees',accessFilter:'all',depth:1,locked:false,skipInactive:true,calleeSort:'name',contextLayout:'combined',callGraphDirection:'callers-left',includeFunctionArguments:false,analyzeCallbacks:true};
 const diagnostics={environment:'test',host:{at:1,heapUsed:1,heapLimit:100,external:0},index:{callbackAnalysis:{running:true,paused:false,progress:{symbol:'short',stage:'propagation',scopeElapsedMs:10,elapsedMs:10,round:1,maxRounds:12,functionsDone:1,functionsTotal:10,evaluations:1,scopeEvaluations:1}},sessionStartedAt:1,rebuildCount:1,sourceParses:1,relationPasses:1,rebuilds:[]}};
 const dispatch=async(data)=>page.evaluate(data=>window.dispatchEvent(new MessageEvent('message',{data})),data);
 let copyOk=true;
 let aiReply,heldAnalysis,holdAnalysis=false,duplicateSearch=false;
 await page.exposeFunction('bridge',async m=>{
  if(m.type==='ready')await dispatch({type:'state',state:{...state,diagnostics}});
  if(m.type==='copyFunctionName'&&copyOk!==null)await dispatch({type:'copyFunctionNameResult',requestId:m.requestId,ok:copyOk});
  let data;
  if(m.type==='callbackSearch')data={choices:duplicateSearch?['a','b'].map(id=>({id:`correct-${id}`,name:'correct_handler',location:{...at,uri:`file:///project/${id}.c`},compatibility:'unknown'})):[{id:'correct',name:'correct_handler',location:at,compatibility:'unknown'}]};
  if(m.type==='callbackSetTarget'){
   Object.assign(node,{key:'run/correct',symbolId:'correct',name:'correct_handler',callKind:'user-confirmed'});
   Object.assign(site,{name:'correct_handler',targetId:'correct',callKind:'user-confirmed',manual:{overrideKey:'override',originalTargetId:'wrong'}});
   await dispatch({type:'state',state:{...state,diagnostics}});data={saved:true};
  }
  if(m.type==='callbackAnalyze'){
   if(holdAnalysis)heldAnalysis=m;
   else data=aiReply??{comparison:'different',suggestionId:'suggestion',hint:{status:'candidates',candidates:[{targetId:'other',name:'other_handler',reason:'New source evidence',evidence:[]} ]}};
  }
  if(m.type==='callbackUseSuggestion'){
   Object.assign(node,{key:'run/other',symbolId:'other',name:'other_handler',callKind:'user-confirmed'});Object.assign(site,{name:'other_handler',targetId:'other'});
   await dispatch({type:'state',state:{...state,diagnostics}});data={saved:true};
  }
  if(data)await dispatch({type:'callbackActionResult',requestId:m.requestId,actionId:m.actionId,ok:true,...data});
 });
 await page.addInitScript(()=>{window.sent=[];window.acquireVsCodeApi=()=>({postMessage(m){window.sent.push(m);void window.bridge(m);}});});
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByRole('button',{name:'Stop local',exact:true}).waitFor();
 for(const width of [900,600,320]){
  await page.setViewportSize({width,height:720});await dispatch({type:'diagnostics',diagnostics});
  const before=await page.getByRole('button',{name:'Stop local',exact:true}).boundingBox();
  diagnostics.index.callbackAnalysis.progress.symbol='very_long_function_name_'.repeat(15);await dispatch({type:'diagnostics',diagnostics});
  const after=await page.getByRole('button',{name:'Stop local',exact:true}).boundingBox();
  assert.ok(Math.abs(before.x-after.x)<=1&&Math.abs(before.y-after.y)<=1&&Math.abs(before.width-after.width)<=1,'Stop button must not move with function names');
  for(const stage of ['macros','registrations'])for(const paused of [false,true]){
   await dispatch({type:'diagnostics',diagnostics:{...diagnostics,index:{...diagnostics.index,callbackAnalysis:{running:true,paused,progress:{...diagnostics.index.callbackAnalysis.progress,stage,scopeElapsedMs:999999999,functionsDone:9999999,functionsTotal:9999999}}}}});
   const box=await page.locator('.local-actions button').first().boundingBox();
   assert.ok(box&&Math.abs(before.x-box.x)<=1&&Math.abs(before.y-box.y)<=1&&Math.abs(before.width-box.width)<=1,'stages, counters and Stopping must retain the fixed action area');
   assert.ok(await page.getByRole('button',{name:'Retry local',exact:true}).isHidden());
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'progress must not overflow the panel');
  }
 }
 await page.setViewportSize({width:900,height:720});
 await dispatch({type:'diagnostics',diagnostics});
 await page.locator('.function-name-trigger').hover();
 const full=diagnostics.index.callbackAnalysis.progress.symbol;
 await page.getByRole('dialog',{name:'Current function'}).waitFor();
 diagnostics.index.callbackAnalysis.progress.symbol='next_function';await dispatch({type:'diagnostics',diagnostics});
 await page.getByRole('button',{name:'Copy',exact:true}).click();
 await page.waitForFunction(()=>window.sent.some(m=>m.type==='copyFunctionName'));
 assert.equal(await page.evaluate(()=>window.sent.find(m=>m.type==='copyFunctionName').name),full);
 await page.keyboard.press('Escape');
 await page.locator('.function-name-trigger').focus();await page.keyboard.press('Enter');
 await page.getByText('next_function',{exact:true}).filter({visible:true}).first().waitFor();
 copyOk=false;await page.keyboard.press('Tab');await page.keyboard.press('Enter');
 await page.getByText('Could not copy. Select the name and copy it manually.',{exact:true}).waitFor();
 copyOk=null;await page.getByRole('button',{name:'Copy',exact:true}).click();
 const staleCopy=await page.evaluate(()=>window.sent.filter(m=>m.type==='copyFunctionName').at(-1).requestId);
 await page.keyboard.press('Escape');
 await page.locator('.function-name-trigger').click();await dispatch({type:'copyFunctionNameResult',requestId:staleCopy,ok:true});
 assert.equal(await page.getByRole('dialog',{name:'Current function'}).getByText('Copied',{exact:true}).count(),0,'late replies must not mark a different popup as copied');
 await page.keyboard.press('Escape');
 await dispatch({type:'diagnostics',diagnostics:{...diagnostics,index:{...diagnostics.index,callbackAnalysis:{running:false,paused:false,limited:true}}}});
 await page.getByRole('button',{name:'Retry local',exact:true}).waitFor();
 await page.locator('[data-node-name="wrong"] .node-title').focus();
 await page.getByRole('button',{name:'Set manually',exact:true}).waitFor();
 await page.getByRole('button',{name:'Recheck with AI',exact:true}).waitFor();
 await page.getByRole('button',{name:'Set manually',exact:true}).click();
 await page.getByRole('textbox',{name:'Target function'}).fill('keep_this_input');await dispatch({type:'state',state:{...state,diagnostics}});
 assert.equal(await page.getByRole('textbox',{name:'Target function'}).inputValue(),'keep_this_input','graph refresh must preserve the active editor');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(await page.locator('[data-node-name="wrong"]').count(),1);
 await page.getByRole('button',{name:'Set manually',exact:true}).click();
 await page.getByRole('textbox',{name:'Target function'}).fill('correct');
 await page.locator('.callback-target-choices [role=option]').first().click();
 await page.getByRole('button',{name:'Apply',exact:true}).click();
 await page.locator('[data-node-name="correct_handler"] .badge').filter({hasText:'User confirmed'}).waitFor();
 await page.keyboard.press('Escape');
 await page.locator('[data-node-name="correct_handler"] .node-title').focus();
 await page.getByRole('button',{name:'Recheck with AI',exact:true}).click();
 await page.getByText('AI suggests a different target',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Use this target',exact:true}).waitFor();
 assert.equal(await page.locator('[data-node-name="correct_handler"]').count(),1);
 await page.getByRole('button',{name:'Use this target',exact:true}).click();
 await page.locator('[data-node-name="other_handler"] .badge').filter({hasText:'User confirmed'}).waitFor();
 await page.screenshot({path:'output/playwright/scoped-user-confirmed.png',fullPage:true});
 const secondAt={...at,start:200,end:202};
 state.graph.root.children.push(...['second','alternative'].map(name=>({...node,key:`run/${name}`,symbolId:name,name,callKind:'ai-candidate',sites:[{...site,id:`site-${name}`,name,targetId:name,callKind:'ai-candidate',manual:undefined,location:secondAt}]})));
 await dispatch({type:'state',state:{...state,diagnostics}});
 await page.locator('[data-node-name="second"] .node-title').press('Space');
 await page.getByRole('button',{name:'Set manually',exact:true}).waitFor();
 await page.keyboard.press('Escape');
 await page.locator('[data-node-name="other_handler"] .node-title').press('Space');
 aiReply={comparison:'agrees',hint:{status:'candidates',candidates:[{targetId:'other',name:'other_handler',reason:'Matching registration',evidence:[]}]}};
 await page.getByRole('button',{name:'Recheck with AI',exact:true}).click();await page.getByText('AI agrees',{exact:true}).waitFor();
 aiReply={comparison:'insufficient',hint:{status:'insufficient-context',candidates:[],missing:['Registration path needed']}};
 await page.getByRole('button',{name:'Recheck with AI',exact:true}).click();await page.getByText('More context needed',{exact:true}).waitFor();
 await page.getByText('Registration path needed',{exact:true}).waitFor();
 const beforeEscape=await page.evaluate(()=>window.sent.filter(m=>m.type==='callbackSetTarget').length);
 await page.getByRole('button',{name:'Set manually',exact:true}).click();await page.getByRole('textbox',{name:'Target function'}).fill('discard_this');await page.keyboard.press('Escape');
 assert.equal(await page.evaluate(()=>window.sent.filter(m=>m.type==='callbackSetTarget').length),beforeEscape);
 await page.locator('[data-node-name="other_handler"] .node-title').press('Space');
 holdAnalysis=true;await page.getByRole('button',{name:'Recheck with AI',exact:true}).click();await page.getByText('Checking with AI…',{exact:true}).waitFor();
 duplicateSearch=true;await page.getByRole('button',{name:'Set manually',exact:true}).click();
 await page.getByRole('textbox',{name:'Target function'}).fill('correct_handler');
 await page.locator('.callback-target-choices [role=option]').filter({hasText:'/b.c'}).click();await page.getByRole('button',{name:'Apply',exact:true}).click();
 await page.locator('[data-node-name="correct_handler"] .badge').filter({hasText:'User confirmed'}).waitFor();
 assert.equal(await page.evaluate(()=>window.sent.filter(m=>m.type==='callbackSetTarget').at(-1).targetId),'correct-b');
 await dispatch({type:'callbackActionResult',requestId:heldAnalysis.requestId,actionId:heldAnalysis.actionId,ok:false,error:'The callback or selection changed during AI analysis.'});
 await page.locator('[data-node-name="correct_handler"] .node-title').press('Space');
 assert.ok(await page.getByRole('button',{name:'Use this target',exact:true}).isHidden());
 assert.equal(await page.locator('[data-node-name="second"] .badge').filter({hasText:'AI candidate'}).count(),1);
 assert.equal(await page.locator('[data-node-name="alternative"] .badge').filter({hasText:'AI candidate'}).count(),1);
 assert.equal(heldAnalysis.actionId,'ai-site','only the selected invocation is rechecked');
 assert.deepEqual(errors,[]);console.log('Scoped UI: fixed Stop, snapshot copy, manual target and AI comparison passed');
} finally {await browser.close();server.close();}
