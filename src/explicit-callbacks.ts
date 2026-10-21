import { FileAnalysis, FlowExpression as Expr, FlowStatement, ReferenceRecord } from './model';
import { RelationIndex } from './relations';

type Evidence = NonNullable<ReferenceRecord['inference']>['evidence'];
interface Storage { root: string; path: string[]; evidence: Evidence; address: boolean }
interface Registration { targetId: string; evidence: Evidence }
const storageKey = (storage: Storage) => JSON.stringify([storage.root, storage.path]);
const maxAliasDepth = 16;

// A written registration is useful evidence even when full pointer propagation is
// disabled or incomplete. This deliberately does not prove a runtime invocation.
export function suggestExplicitCallbacks(raw: FileAnalysis[], derived: FileAnalysis[]): FileAnalysis[] {
  const index = new RelationIndex();
  raw.forEach(file => index.update({ ...file, references: [], functionArguments: undefined }));
  const initial = new Map<string, Registration[]>();
  const pathsByRoot = new Map<string, Map<string, string[]>>();
  function keyFor(storage: Storage) {
    const key = storageKey(storage), paths = pathsByRoot.get(storage.root) ?? new Map<string, string[]>();
    paths.set(key, storage.path); pathsByRoot.set(storage.root, paths); return key;
  }
  const added = new Map<string, ReferenceRecord[]>();
  const callsites = new Map<string, ReferenceRecord>();
  const existing = new Set<string>(), complete = new Set<string>();
  const siteKey = (ref: ReferenceRecord) => `${ref.location.uri}:${ref.location.start}:${ref.location.end}`;
  for (const file of derived) for (const ref of file.references) if (ref.kind === 'call' && ref.access) {
    const key = siteKey(ref);
    if (ref.targetId) existing.add(`${key}:${ref.targetId}`);
    if (ref.callKind === 'inferred' && !ref.inference?.incomplete) complete.add(key);
  }
  for (const file of raw) for (const ref of file.references)
    if (ref.kind === 'call' && ref.access && ref.flowKey) callsites.set(ref.flowKey, ref);
  const resolve = (value: Extract<Expr, { kind: 'name' }>) => index.resolveReference({
    id: '', kind: 'reference', name: value.name, location: value.location, conditions: []
  });
  function direct(value: Expr): Registration[] {
    if (value.kind === 'cast' || value.kind === 'address') return direct(value.object);
    if (value.kind !== 'name' || value.localId) return [];
    const symbols = resolve(value);
    if (symbols.some(symbol => symbol.kind !== 'function')) return [];
    return symbols.map(symbol => ({ targetId: symbol.id,
      evidence: [{ location: value.location, reason: `Explicit function registration: ${value.name}` }] }));
  }
  function initializer(storage: Storage, value: Expr, bindings: Map<string, Registration[]>) {
    if (value.kind !== 'initializer') return;
    for (const entry of value.entries) {
      // Positional and computed designators require type/array propagation.
      if (!entry.path.length || entry.path.some(part => typeof part !== 'string' || part === '*')) continue;
      const field = { ...storage, path: [...storage.path, ...entry.path as string[]] };
      if (entry.value.kind === 'initializer') initializer(field, entry.value, bindings);
      else bindings.set(keyFor(field), direct(entry.value));
    }
  }
  for (const file of raw) for (const init of file.initializers ?? []) {
    if (index.symbol(init.id)?.kind === 'variable') initializer({ root: init.id, path: [], evidence: [], address: false }, init.value, initial);
  }
  for (const file of raw) for (const program of file.programs ?? []) {
    const aliases = new Map<string, Storage>(), bindings = new Map<string, Registration[]>();
    let useInitial = true;
    const clear = () => { aliases.clear(); bindings.clear(); useInitial = false; };
    function storage(value: Expr): Storage | undefined {
      if (value.kind === 'cast') return storage(value.object);
      if (value.kind === 'address' || value.kind === 'dereference') {
        const object = storage(value.object);
        // &p is the pointer variable's storage, not p's registered pointee.
        if (!object || object.address !== (value.kind === 'dereference')) return undefined;
        return { ...object, address: value.kind === 'address' };
      }
      if (value.kind === 'name') {
        if (value.localId) return aliases.get(value.localId);
        const symbols = resolve(value);
        if (symbols.length === 1 && symbols[0].kind === 'variable') return { root: symbols[0].id, path: [], evidence: [], address: false };
      }
      if (value.kind === 'member') {
        const object = storage(value.object);
        if (object && object.address === value.arrow) return { ...object, path: [...object.path, value.field], address: false };
      }
      return undefined;
    }
    function discardObject(object: Storage) {
      for (const [key, parts] of pathsByRoot.get(object.root) ?? [])
        if (object.path.every((part, n) => parts[n] === part)) bindings.set(key, []);
    }
    function visit(value: Expr) {
      if (value.kind === 'assign') {
        visit(value.right); visit(value.left);
        if (value.left.kind === 'name' && value.left.localId) {
          const object = value.operator === '=' ? storage(value.right) : undefined;
          aliases.delete(value.left.localId);
          if (object?.address && object.evidence.length < maxAliasDepth) aliases.set(value.left.localId, { ...object, evidence: [...object.evidence,
            { location: value.location, reason: `Local object alias: ${value.left.name}` }] });
        } else {
          const object = storage(value.left);
          if (object) {
            discardObject(object);
            if (value.operator === '=' && object.path.length) bindings.set(keyFor(object), direct(value.right));
          }
        }
        return;
      }
      if (value.kind === 'call') {
        visit(value.callee);
        const source = callsites.get(value.key), object = storage(value.callee);
        const key = object && storageKey(object);
        const registrations = key ? bindings.get(key) ?? (useInitial ? initial.get(key) : undefined) ?? [] : [];
        if (source && object && !object.address && !complete.has(siteKey(source))) for (const registration of registrations) {
          const target = index.symbol(registration.targetId), key = `${siteKey(source)}:${registration.targetId}`;
          if (!target || existing.has(key)) continue;
          existing.add(key);
          const refs = added.get(file.uri) ?? [];
          refs.push({ ...source, id: `${source.id}:registered:${target.id}`, name: target.name, targetId: target.id,
            indirect: false, member: undefined, callKind: 'registered',
            inference: { expression: file.text.slice(source.location.start, source.location.end), incomplete: true,
              reasons: ['Explicit registration candidate; not proof of invocation. Only direct registrations and straight-line local aliases were examined.'],
              evidence: [...registration.evidence, ...object.evidence] } });
          added.set(file.uri, refs);
        }
        for (const arg of value.args) {
          visit(arg);
          const object = storage(arg);
          if (object) discardObject(object);
        }
        return;
      }
      if (value.kind === 'sequence') { value.values.forEach(visit); return; }
      if (value.kind === 'initializer') { value.entries.forEach(entry => visit(entry.value)); return; }
      if (value.kind === 'choice' || value.kind === 'unknown') { clear(); return; }
      // An unsupported pointer-to-pointer alias can later replace this pointer.
      if (value.kind === 'address' && value.object.kind === 'name' && value.object.localId) aliases.delete(value.object.localId);
      if (value.kind === 'cast' || value.kind === 'address' || value.kind === 'dereference' || value.kind === 'member' || value.kind === 'index') visit(value.object);
      if (value.kind === 'index') visit(value.index);
    }
    function statements(body: FlowStatement[]) {
      for (const statement of body) {
        if (statement.kind === 'branch' || statement.kind === 'loop') clear();
        else { visit(statement.value); if (statement.kind === 'return') break; }
      }
    }
    statements(program.body);
  }
  return derived.map(file => {
    const refs = added.get(file.uri);
    return refs?.length ? { ...file, references: [...file.references, ...refs] } : file;
  });
}
