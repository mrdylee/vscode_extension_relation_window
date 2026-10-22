import { FileAnalysis } from './model';
import { inferPointerCalls } from './pointer-targets';

const cache = new WeakMap<FileAnalysis[], FileAnalysis[]>();

// A timeout must not hide a short registration chain behind unrelated bodies.
// Reuse storage propagation over a bounded projection, exporting candidates only:
// omitted functions/mutations mean this pass cannot prove runtime call targets.
export function suggestPartialCallbacks(raw: FileAnalysis[], derived: FileAnalysis[], memoryPressure?: () => boolean, shouldCancel?: () => boolean): FileAnalysis[] {
  if (shouldCancel?.()) return derived;
  if (!derived.some(file => file.issues.some(issue => issue.startsWith('Callback analysis budget:') || issue.startsWith('Callback analysis work limit'))) ||
    derived.some(file => file.issues.some(issue => issue.startsWith('Callback analysis memory budget')))) return derived;
  const previous = cache.get(derived); if (previous) return previous;
  const deadline = performance.now() + 250;
  let remaining = 32_768;
  function small(value: unknown): boolean {
    const pending = [value]; let nodes = 0;
    while (pending.length) {
      if (++nodes > 512 || --remaining < 0 || performance.now() >= deadline) return false;
      const item = pending.pop();
      if (item && typeof item === 'object') for (const key in item) {
        const child = (item as Record<string, unknown>)[key];
        if (key !== 'location' && child && typeof child === 'object') {
          if (nodes + pending.length >= 512) return false;
          pending.push(child);
        }
      }
    }
    return true;
  }
  const projection = raw.map(file => ({ ...file,
    programs: file.programs?.filter(program => small(program.body)),
    initializers: file.initializers?.filter(init => small(init.value))
  }));
  if (performance.now() >= deadline) { cache.set(derived, derived); return derived; }
  if (memoryPressure?.()) return derived;
  const projected = inferPointerCalls(projection, () => performance.now() >= deadline || memoryPressure?.() === true, projection, true, { shouldCancel });
  const key = (ref: FileAnalysis['references'][number]) => `${ref.location.start}:${ref.location.end}:${ref.targetId}`;
  const results = derived.map((file, n) => {
    const existing = new Set(file.references.filter(ref => ref.kind === 'call' && ref.targetId).map(key));
    const reasons = new Map<string, string[]>();
    for (const ref of file.references) if (ref.kind === 'call') {
      const site = `${ref.location.start}:${ref.location.end}`;
      reasons.set(site, [...(reasons.get(site) ?? []), ...(ref.inference?.reasons ?? [])]);
    }
    const additions = projected[n].references.filter(ref => {
      if (ref.kind !== 'call' || ref.callKind !== 'inferred' || !ref.targetId || existing.has(key(ref))) return false;
      existing.add(key(ref)); return true;
    })
      .map(ref => ({ ...ref, id: ref.id + ':partial-registration', callKind: 'registered' as const,
        inference: { ...ref.inference!, incomplete: true, reasons: [...new Set([
          'Registration-path candidate from bounded partial analysis; other function bodies or mutations may be omitted. Not proof of invocation.',
          ...(reasons.get(`${ref.location.start}:${ref.location.end}`) ?? [])
        ])] } }));
    return additions.length ? { ...file, references: [...file.references, ...additions] } : file;
  });
  cache.set(derived, results); return results;
}
