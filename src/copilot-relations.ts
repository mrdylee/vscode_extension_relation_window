import type { CallbackHint } from './copilot-callbacks';
import { RelationIndex } from './relations';
import { ReferenceRecord } from './model';

export function applyCallbackHints(index: RelationIndex, hints: readonly CallbackHint[]) {
  const byFile = new Map<string, CallbackHint[]>();
  for (const hint of hints) {
    if (!hint.candidates.length) continue;
    const values = byFile.get(hint.callsite.uri) ?? [];
    values.push(hint); byFile.set(hint.callsite.uri, values);
  }
  for (const file of index.files.values()) {
    const fileHints = byFile.get(file.uri);
    const hasPrevious = file.references.some(ref => ref.callKind === 'ai-candidate');
    if (!hasPrevious && !fileHints) continue;
    const references = hasPrevious ? file.references.filter(ref => ref.callKind !== 'ai-candidate') : file.references;
    if (!fileHints) { index.update({ ...file, references }); continue; }
    const callsites = new Map<string, ReferenceRecord>(), existingTargets = new Set<string>();
    const wantedSites = new Set(fileHints.map(hint => `${hint.callsite.start}:${hint.callsite.end}`));
    for (const ref of references) {
      const location = ref.location, key = `${location.start}:${location.end}`;
      if (!wantedSites.has(key)) continue;
      if (ref.kind === 'call' && ref.access && !callsites.has(key)) callsites.set(key, ref);
      if (ref.targetId) existingTargets.add(`${key}:${ref.targetId}`);
    }
    const added: ReferenceRecord[] = [];
    for (const hint of fileHints) {
      const key = `${hint.callsite.start}:${hint.callsite.end}`, site = callsites.get(key);
      if (!site) continue;
      for (const candidate of hint.candidates) {
        const target = index.symbol(candidate.targetId);
        if (!target || target.kind !== 'function' || !target.definition) continue;
        if (existingTargets.has(`${key}:${target.id}`)) continue;
        added.push({ ...site, id: `${site.id}:ai:${target.id}`, name: target.name, targetId: target.id, indirect: false, member: undefined,
          callKind: 'ai-candidate', inference: { expression: hint.expression, incomplete: true,
            reasons: ['Copilot candidate; not proof of invocation.', ...(hint.contextLimited ? ['Only bounded source context was examined.'] : [])],
            evidence: candidate.evidence.map(location => ({ location, reason: candidate.reason })) } });
      }
    }
    if (added.length || references.length !== file.references.length) index.update({ ...file, references: [...references, ...added] });
  }
}
