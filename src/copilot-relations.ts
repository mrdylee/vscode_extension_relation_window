import type { CallbackHint } from './copilot-callbacks';
import { RelationIndex } from './relations';
import { ReferenceRecord } from './model';

export function applyCallbackHints(index: RelationIndex, hints: readonly CallbackHint[]) {
  const byFile = new Map<string, CallbackHint[]>();
  for (const hint of hints) {
    const values = byFile.get(hint.callsite.uri) ?? [];
    values.push(hint); byFile.set(hint.callsite.uri, values);
  }
  for (const file of index.files.values()) {
    const references = file.references.filter(ref => ref.callKind !== 'ai-candidate');
    const added: ReferenceRecord[] = [];
    for (const hint of byFile.get(file.uri) ?? []) {
      const site = references.find(ref => ref.kind === 'call' && ref.access && ref.location.start === hint.callsite.start && ref.location.end === hint.callsite.end);
      if (!site) continue;
      for (const candidate of hint.candidates) {
        const target = index.symbol(candidate.targetId);
        if (!target || target.kind !== 'function' || !target.definition) continue;
        if (references.some(ref => ref.targetId === target.id && ref.location.start === site.location.start && ref.location.end === site.location.end)) continue;
        added.push({ ...site, id: `${site.id}:ai:${target.id}`, name: target.name, targetId: target.id, indirect: false, member: undefined,
          callKind: 'ai-candidate', inference: { expression: hint.expression, incomplete: true,
            reasons: ['Copilot candidate; not proof of invocation.', ...(hint.contextLimited ? ['Only bounded source context was examined.'] : [])],
            evidence: candidate.evidence.map(location => ({ location, reason: candidate.reason })) } });
      }
    }
    if (added.length || references.length !== file.references.length) index.update({ ...file, references: [...references, ...added] });
  }
}
