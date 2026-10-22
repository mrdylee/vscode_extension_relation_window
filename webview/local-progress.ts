import type { Diagnostics } from '../src/diagnostics';
export function createLocalProgress(send:(type:string,value?:Record<string,unknown>)=>void) {
  const root=document.createElement('div');root.className='local-progress';root.hidden=true;
  const summary=document.createElement('div');summary.className='local-summary';
  const text=document.createElement('span');
  const name=document.createElement('button');name.type='button';name.className='function-name-trigger';name.setAttribute('aria-haspopup','dialog');
  const actions=document.createElement('div');actions.className='local-actions';
  const stop=document.createElement('button');stop.type='button';stop.textContent='Stop local';stop.onclick=()=>{stop.disabled=true;stop.textContent='Stopping…';send('localStop');};
  const retry=document.createElement('button');retry.type='button';retry.textContent='Retry local';retry.onclick=()=>send('localResume');
  summary.append(text,name);actions.append(stop,retry);root.append(summary,actions);
  const popup=document.createElement('div');popup.className='function-name-popup';popup.hidden=true;popup.setAttribute('role','dialog');popup.setAttribute('aria-label','Current function');
  const full=document.createElement('div');full.className='full-function-name';
  const copy=document.createElement('button');copy.type='button';copy.textContent='Copy';
  const result=document.createElement('span');result.setAttribute('role','status');popup.append(full,copy,result);document.body.append(popup);
  let restoringFocus=false;
  let diagnostics:Diagnostics|undefined,sampledAt=0,sample='',snapshot='',copyId='',closeTimer:ReturnType<typeof setTimeout>|undefined;
  function close(restore=false){clearTimeout(closeTimer);copyId='';popup.hidden=true;name.setAttribute('aria-expanded','false');if(restore&&name.isConnected){restoringFocus=true;name.focus();restoringFocus=false;}}
  function open(){clearTimeout(closeTimer);if(!popup.hidden)return;snapshot=name.textContent??'';full.textContent=snapshot;result.textContent='';popup.hidden=false;name.setAttribute('aria-expanded','true');const box=name.getBoundingClientRect();popup.style.left=`${Math.max(8,Math.min(box.left,window.innerWidth-popup.offsetWidth-8))}px`;popup.style.top=`${Math.max(8,Math.min(box.top-popup.offsetHeight-8,window.innerHeight-popup.offsetHeight-8))}px`;}
  const scheduleClose=()=>{clearTimeout(closeTimer);closeTimer=setTimeout(()=>{if(!popup.matches(':hover')&&!popup.contains(document.activeElement)&&document.activeElement!==name)close();},180);};
  name.onmouseenter=open;name.onmouseleave=scheduleClose;name.onfocus=()=>{if(!restoringFocus&&name.matches(':focus-visible'))open();};name.onblur=scheduleClose;name.onclick=open;
  name.onkeydown=event=>{if(event.key==='Tab'&&!event.shiftKey&&!popup.hidden){event.preventDefault();copy.focus();}};
  popup.onmouseenter=()=>clearTimeout(closeTimer);popup.onmouseleave=scheduleClose;popup.addEventListener('focusout',scheduleClose);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!popup.hidden){event.preventDefault();close(true);}});
  document.addEventListener('pointerdown',event=>{if(!popup.contains(event.target as Node)&&event.target!==name)close();});
  window.addEventListener('resize',()=>close());
  copy.onclick=()=>{copyId=crypto.randomUUID();send('copyFunctionName',{requestId:copyId,name:snapshot});};
  window.addEventListener('message',event=>{if(event.data?.type==='copyFunctionNameResult'&&event.data.requestId===copyId&&!popup.hidden)result.textContent=event.data.ok?'Copied':'Could not copy. Select the name and copy it manually.';});
  function update(value?:Diagnostics,tick=false){
    diagnostics=value;const analysis=value?.index?.callbackAnalysis,progress=analysis?.progress;
    if(!tick){const next=JSON.stringify(analysis);if(next!==sample){sample=next;sampledAt=Date.now();}}
    root.hidden=!analysis?.running&&!analysis?.paused&&!analysis?.limited&&!['cancelled','time','work','limited'].includes(progress?.outcome??'');
    stop.hidden=!analysis?.running;retry.hidden=!!analysis?.running;stop.disabled=!!analysis?.paused;stop.textContent=analysis?.paused?'Stopping…':'Stop local';
    const ms=(progress?.scopeElapsedMs??0)+(analysis?.running?Math.max(0,Date.now()-sampledAt):0);
    text.textContent=analysis?.running?`Local · ${(ms/1000).toFixed(1)}s${ms>=5000?' · Taking longer':''} · `:analysis?.paused?'Local analysis paused':'Local analysis needs retry';
    name.hidden=!analysis?.running||!progress?.symbol;name.textContent=progress?.symbol??'';name.setAttribute('aria-label',`Function ${progress?.symbol??''}`);
    summary.title=`${progress?.stage??'Local analysis'} · ${progress?.functionsDone??0}/${progress?.functionsTotal??0} functions · ${progress?.scopeEvaluations??0} evaluations`;
  }
  setInterval(()=>{if(diagnostics?.index?.callbackAnalysis?.running)update(diagnostics,true);},500);
  return {element:root,update};
}
