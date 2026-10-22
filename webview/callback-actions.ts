import type { RelationSite } from '../src/model';
import type { CallbackActionResult, CallbackTargetChoice } from '../src/copilot-service';
interface Reply extends CallbackActionResult { ok: boolean; error?: string; choices?: CallbackTargetChoice[]; saved?: boolean }
const pending=new Map<string,{resolve:(reply:Reply)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
window.addEventListener('message',event=>{
  if(event.data?.type!=='callbackActionResult')return;
  const item=pending.get(event.data.requestId);if(!item)return;
  pending.delete(event.data.requestId);clearTimeout(item.timer);
  event.data.ok?item.resolve(event.data):item.reject(new Error(event.data.error??'Callback action failed.'));
});
export function createCallbackActions(site: Pick<RelationSite,'id'|'name'|'callKind'|'manual'|'location'|'inference'>,send:(type:string,value?:Record<string,unknown>)=>void,onApplied:()=>void) {
  const root=document.createElement('section');root.className='callback-actions';
  const row=document.createElement('div');row.className='callback-action-buttons';
  const content=document.createElement('div');content.className='callback-action-content';
  const note=document.createElement('div');note.setAttribute('role','status');
  const button=(text:string,action:()=>void)=>{const element=document.createElement('button');element.type='button';element.textContent=text;element.onclick=action;return element;};
  const request=(type:string,value:Record<string,unknown>={})=>new Promise<Reply>((resolve,reject)=>{
    const requestId=crypto.randomUUID();const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error('Callback action timed out.'));},70_000);
    pending.set(requestId,{resolve,reject,timer});send(type,{requestId,actionId:site.id,...value});
  });
  let searchTimer:ReturnType<typeof setTimeout>|undefined,sequence=0;
  const fail=(error:unknown)=>{if(root.isConnected)note.textContent=error instanceof Error?error.message:String(error);};
  function manual() {
    root.dataset.active='true';note.textContent='';content.replaceChildren();
    const label=document.createElement('label');label.textContent='Target function';
    const input=document.createElement('input');input.type='text';input.value=site.name;input.placeholder='Search indexed functions…';input.setAttribute('aria-label','Target function');input.autocomplete='off';label.append(input);
    const choices=document.createElement('div');choices.className='callback-target-choices';choices.setAttribute('role','listbox');choices.setAttribute('aria-label','Indexed functions');
    let selected:string|undefined;
    const apply=button('Apply',()=>{if(!selected)return;apply.disabled=true;void request('callbackSetTarget',{targetId:selected}).then(()=>{if(!root.isConnected)return;root.dataset.active='false';content.replaceChildren();note.textContent='Target saved. User confirmed.';onApplied();}).catch(error=>{apply.disabled=false;fail(error);});});apply.disabled=true;
    const cancel=button('Cancel',()=>{sequence++;clearTimeout(searchTimer);content.replaceChildren();note.textContent='';set.focus();root.dataset.active='false';});
    const search=async()=>{
      const current=++sequence;selected=undefined;apply.disabled=true;
      try {
        const reply=await request('callbackSearch',{query:input.value});if(!root.isConnected||current!==sequence)return;
        choices.replaceChildren();
        for(const choice of reply.choices??[]){
          const item=button(`${choice.name} · ${decodeURIComponent(choice.location.uri)}:${choice.location.line+1}${choice.compatibility==='unknown'?' · Type not verified':''}`,()=>{selected=choice.id;input.value=choice.name;apply.disabled=false;for(const child of Array.from(choices.children))child.setAttribute('aria-selected',String(child===item));});
          item.setAttribute('role','option');item.setAttribute('aria-selected','false');item.disabled=choice.compatibility==='incompatible';item.title=choice.reason??choice.name;
          item.onkeydown=event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const items=Array.from(choices.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));items[(items.indexOf(item)+(event.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();}};
          choices.append(item);
        }
        if(!choices.childElementCount)choices.textContent='No indexed function matches.';
      }catch(error){fail(error);}
    };
    input.oninput=()=>{sequence++;clearTimeout(searchTimer);selected=undefined;apply.disabled=true;searchTimer=setTimeout(()=>void search(),150);};
    input.onkeydown=event=>{if(event.key==='ArrowDown'){event.preventDefault();choices.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();}};
    content.append(label,choices,apply,cancel);input.focus();input.select();void search();
  }
  const set=button('Set manually',manual);
  const recheck=button(site.callKind==='ai-candidate'||site.callKind==='user-confirmed'?'Recheck with AI':'Find target with AI',()=>{
    root.dataset.active='true';recheck.disabled=true;note.textContent='Checking with AI…';content.replaceChildren();
    void request('callbackAnalyze',{recheck:site.callKind==='ai-candidate'||site.callKind==='user-confirmed'}).then(reply=>{
      if(!root.isConnected)return;
      note.textContent=reply.comparison==='agrees'?'AI agrees':reply.comparison==='different'?'AI suggests a different target':reply.hint?.status==='insufficient-context'?'More context needed':reply.hint?.status==='not-found'?'No target found in provided context':'AI candidates updated';
      for(const candidate of reply.hint?.candidates??[]) {
        const evidence=document.createElement('div');evidence.textContent=[candidate.name??candidate.targetId,candidate.reason,...(candidate.conditions??[]).map(value=>`Condition: ${value}`),...(candidate.uncertainties??[]).map(value=>`Uncertainty: ${value}`)].join(' · ');content.append(evidence);
        if(reply.comparison==='different'&&reply.suggestionId)content.append(button('Use this target',()=>{
          void request('callbackUseSuggestion',{suggestionId:reply.suggestionId,targetId:candidate.targetId}).then(()=>{root.dataset.active='false';content.replaceChildren();note.textContent='Target saved. User confirmed.';onApplied();}).catch(fail);
        }));
      }
      if(reply.hint?.missing?.length){const missing=document.createElement('div');missing.textContent=reply.hint.missing.join(' · ');content.append(missing);}
    }).catch(fail).finally(()=>{recheck.disabled=false;if(!content.querySelector('button'))root.dataset.active='false';});
  });
  if(site.callKind==='ai-candidate'||site.callKind==='user-confirmed')row.append(set);
  row.append(recheck);
  if(site.manual)row.append(button('Remove manual override',()=>{void request('callbackRemoveOverride').then(()=>{root.dataset.active='false';note.textContent='Manual override removed.';onApplied();}).catch(fail);}));
  const source=document.createElement('div');source.className='detail-meta';source.textContent=`${decodeURIComponent(site.location.uri)}:${site.location.line+1} · ${site.inference?.expression??site.name}`;
  root.append(source,row,content,note);return root;
}
