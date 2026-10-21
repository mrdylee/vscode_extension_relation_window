import { FileAnalysis, FlowExpression as Expr, FlowStatement, ReferenceRecord } from './model';
import { RelationIndex } from './relations';

type Evidence = NonNullable<ReferenceRecord['inference']>['evidence'];
interface Storage { root: string; path: string[]; evidence: Evidence; address: boolean }
interface Registration { targetId: string; evidence: Evidence }
const storageKey = (storage: Storage) => JSON.stringify([storage.root, storage.path]);
const maxAliasDepth = 16;
const projectionCache = new WeakMap<FileAnalysis, { signature: string; result: FileAnalysis }>();

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
  const registrations = new Map<string, Map<string, ReferenceRecord>>();
  const functionNames = new Set(index.symbols().filter(symbol => symbol.kind === 'function').map(symbol => symbol.name));
  const sourceConditions = new Map(raw.flatMap(file => file.references.filter(ref => ref.kind === 'reference' && functionNames.has(ref.name))
    .map(ref => [`${file.uri}:${ref.location.start}`, ref.conditions] as const)));
  function register(value: Expr, ownerId: string, functionId: string | undefined, expression: string) {
    if (value.kind === 'initializer') {
      for (const entry of value.entries) {
        if (!entry.path.length || entry.path.some(part => typeof part !== 'string' || part === '*')) continue;
        register(entry.value, ownerId, functionId, expression + '.' + entry.path.join('.'));
      }
      return;
    }
    for (const registration of direct(value)) {
      const target = index.symbol(registration.targetId)!;
      const file = index.files.get(value.location.uri)!;
      const conditions = sourceConditions.get(`${file.uri}:${registration.evidence[0].location.start}`) ?? [];
      const refs = registrations.get(file.uri) ?? new Map<string, ReferenceRecord>();
      const id = `${file.uri}@${value.location.start}:registration:${target.id}`;
      refs.set(id, { id, name: target.name, kind: 'reference', callKind: 'registered', targetId: target.id,
        ownerId, functionId, location: value.location, conditions,
        inference: { expression, evidence: registration.evidence, incomplete: false,
          reasons: ['Explicit function registration; not proof of invocation.'] } });
      registrations.set(file.uri, refs);
    }
  }
  function collect(value: Expr, functionId: string) {
    if (value.kind === 'assign') {
      if (value.operator === '=') register(value.right, functionId, functionId,
        index.files.get(value.left.location.uri)!.text.slice(value.left.location.start, value.left.location.end));
      collect(value.left, functionId); collect(value.right, functionId);
    } else if (value.kind === 'call') { collect(value.callee, functionId); value.args.forEach(arg => collect(arg, functionId)); }
    else if (value.kind === 'initializer') value.entries.forEach(entry => collect(entry.value, functionId));
    else if (value.kind === 'sequence' || value.kind === 'choice') value.values.forEach(part => collect(part, functionId));
    else if (value.kind === 'unknown') value.children?.forEach(part => collect(part, functionId));
    else if (value.kind === 'index') { collect(value.object, functionId); collect(value.index, functionId); }
    else if (value.kind === 'cast' || value.kind === 'address' || value.kind === 'dereference' || value.kind === 'member') collect(value.object, functionId);
  }
  function collectStatements(body: FlowStatement[], functionId: string) {
    for (const statement of body) {
      if (statement.kind === 'branch') {
        collect(statement.condition, functionId); collectStatements(statement.then, functionId); collectStatements(statement.otherwise, functionId);
      } else if (statement.kind === 'loop') { collect(statement.condition, functionId); collectStatements(statement.body, functionId); }
      else { collect(statement.value, functionId); if (statement.kind === 'return') break; }
    }
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
  const persistentOwners = new Map<string, { functionId: string; name: string }>();
  for (const file of raw) for (const program of file.programs ?? []) for (const local of program.locals)
    if (local.persistent) persistentOwners.set(local.id, { functionId: program.id, name: local.name });
  for (const file of raw) for (const init of file.initializers ?? []) {
    const symbol = index.symbol(init.id);
    const local = persistentOwners.get(init.id);
    if (symbol?.kind === 'variable' || local) {
      register(init.value, local?.functionId ?? init.id, local?.functionId, symbol?.name ?? local!.name);
      const object = { root: init.id, path: [], evidence: [], address: false };
      if (init.value.kind === 'initializer') initializer(object, init.value, initial);
      else initial.set(keyFor(object), direct(init.value));
    }
  }
  for (const file of raw) for (const program of file.programs ?? []) {
    collectStatements(program.body, program.id);
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
        if (value.localId) return aliases.get(value.localId) ?? { root: value.localId, path: [], evidence: [], address: false };
        const symbols = resolve(value);
        if (symbols.length === 1 && symbols[0].kind === 'variable') return { root: symbols[0].id, path: [], evidence: [], address: false };
      }
      if (value.kind === 'member') {
        const object = storage(value.object);
        // A direct p->field write can be tracked within this function even
        // when the pointee supplied to a local pointer/parameter is unknown.
        const localPointer = value.arrow && value.object.kind === 'name' && value.object.localId && !aliases.has(value.object.localId);
        if (object && (object.address === value.arrow || localPointer)) return { ...object, path: [...object.path, value.field], address: false };
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
          const own = { root: value.left.localId, path: [], evidence: [], address: false };
          discardObject(own);
          if (value.operator === '=') {
            if (value.right.kind === 'initializer') initializer(own, value.right, bindings);
            else bindings.set(keyFor(own), direct(value.right));
          }
          aliases.delete(value.left.localId);
          if (object?.address && object.evidence.length < maxAliasDepth) aliases.set(value.left.localId, { ...object, evidence: [...object.evidence,
            { location: value.location, reason: `Local object alias: ${value.left.name}` }] });
        } else {
          const object = storage(value.left);
          if (object) {
            discardObject(object);
            if (value.operator === '=') {
              if (value.right.kind === 'initializer') initializer(object, value.right, bindings);
              else bindings.set(keyFor(object), direct(value.right));
            }
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
      if (value.kind === 'address' && value.object.kind === 'name' && value.object.localId) {
        const localId = value.object.localId;
        aliases.delete(localId);
        const local = program.locals.find(local => local.id === localId);
        const symbol = local && index.symbol(`${local.location.uri}#${local.location.start}`);
        if (symbol && index.layout(symbol).some(layout => layout.layers[0] === 'pointer'))
          discardObject({ root: value.object.localId, path: [], evidence: [], address: false });
      }
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
    const written = [...(registrations.get(file.uri)?.values() ?? [])];
    const same = JSON.stringify(written) === JSON.stringify(file.callbackRegistrations ?? []);
    if (!refs?.length && same) return file;
    const signature = JSON.stringify([refs, written]), previous = projectionCache.get(file);
    if (previous?.signature === signature) return previous.result;
    const result = { ...file, references: refs?.length ? [...file.references, ...refs] : file.references,
      callbackRegistrations: same ? file.callbackRegistrations : written.length ? written : undefined };
    projectionCache.set(file, { signature, result });
    return result;
  });
}
