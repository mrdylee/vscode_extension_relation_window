import { ResolvedOverride } from './callback-overrides';
import type { CallbackHint } from './copilot-callbacks';
import { RelationIndex } from './relations';
import { ReferenceRecord, fileKey, locationKey } from './model';

export function applyCallbackHints(index: RelationIndex, hints: readonly CallbackHint[], overrides: readonly ResolvedOverride[] = []) {
  const byFile = new Map<string, CallbackHint[]>();
  for (const hint of hints) {
    if (!hint.candidates.length) continue;
    const values = byFile.get(locationKey(hint.callsite)) ?? [];
    values.push(hint); byFile.set(locationKey(hint.callsite), values);
  }
  for (const file of index.files.values()) {
    const manual = overrides.filter(value=>value.status==='active'&&!!value.site&&locationKey(value.site.location)===fileKey(file));
    const fileHints = byFile.get(fileKey(file)) ?? [];
    const hasPrevious = file.references.some(ref => ['ai-candidate','user-confirmed'].includes(ref.callKind??''));
    if (!hasPrevious && !fileHints.length && !manual.length) continue;
    const references = hasPrevious ? file.references.filter(ref => !['ai-candidate','user-confirmed'].includes(ref.callKind??'')) : file.references;
    const callsites = new Map<string, ReferenceRecord>(), existingTargets = new Map<string, boolean>();
    const wantedSites = new Set([...fileHints.map(hint => `${hint.callsite.start}:${hint.callsite.end}`),...manual.map(value=>`${value.site!.location.start}:${value.site!.location.end}`)]);
    for (const ref of references) {
      const location = ref.location, key = `${location.start}:${location.end}`;
      if (!wantedSites.has(key)) continue;
      if (ref.kind === 'call' && ref.access && !callsites.has(key)) callsites.set(key, ref);
      if (ref.targetId) {
        const target = `${key}:${ref.targetId}`;
        const partial = ref.kind === 'call' && (ref.callKind === 'inferred' || ref.callKind === 'registered') && ref.inference?.incomplete;
        existingTargets.set(target, existingTargets.get(target) === true || !partial);
      }
    }
    const added: ReferenceRecord[] = [];
    for (const hint of fileHints) {
      const key = `${hint.callsite.start}:${hint.callsite.end}`, site = callsites.get(key);
      if (!site) continue;
      for (const candidate of hint.candidates) {
        if(manual.some(value=>value.site!.location.start===site.location.start&&value.site!.location.end===site.location.end&&value.original?.id===candidate.targetId))continue;
        const target = index.symbol(candidate.targetId);
        if (!target || target.kind !== 'function' || !target.definition) continue;
        if (existingTargets.get(`${key}:${target.id}`)) continue;
        added.push({ ...site, id: `${site.id}:ai:${target.id}`, name: target.name, targetId: target.id, indirect: false, member: undefined,
          callKind: 'ai-candidate', inference: { expression: hint.expression, incomplete: true,
            reasons: ['Copilot candidate; not proof of invocation.',...(candidate.uncertainties??[]),...(candidate.conditions??[]).map(value=>'Condition: '+value), ...(hint.contextLimited ? ['Only bounded source context was examined.'] : [])],
            evidence: candidate.evidence.map(location => ({ location, reason: candidate.reason })) } });
      }
    }
    for(const value of manual) {
      const site=value.site!,target=value.target!;
      if(added.some(ref=>ref.targetId===target.id&&ref.location.start===site.location.start&&ref.location.end===site.location.end))
        added.splice(added.findIndex(ref=>ref.targetId===target.id&&ref.location.start===site.location.start&&ref.location.end===site.location.end),1);
      added.push({...site,id:`${site.id}:manual:${value.record.key}`,name:target.name,targetId:target.id,indirect:false,member:undefined,
        callKind:'user-confirmed',manual:{overrideKey:value.record.key,originalTargetId:value.original!.id,originalTargetName:value.original!.name},
        inference:{expression:file.text.slice(site.location.start,site.location.end),incomplete:true,reasons:['User confirmed target; not proof of invocation.'],evidence:[]}});
    }
    if (added.length || references.length !== file.references.length) index.update({ ...file, references: [...references, ...added] });
  }
}
