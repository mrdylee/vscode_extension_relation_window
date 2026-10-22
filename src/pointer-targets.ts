import { CallbackAnalysisOptions, CallbackProgress, CallbackDiagnostic, FileAnalysis, FlowExpression as Expr, FlowLocal, FlowProgram, FlowStatement, Location, ReferenceRecord, SymbolRecord } from './model';
import { RelationIndex } from './relations';
import { FunctionArguments } from './function-arguments';

type Evidence = { location: Location; reason: string };
interface Value {
  readonly targets: ReadonlyMap<string, Evidence[]>; readonly objects: ReadonlySet<string>; readonly params: ReadonlySet<string>; readonly numbers: ReadonlySet<number>;
  readonly unknown: boolean; readonly nil: boolean; readonly evidence: Evidence[]; readonly reasons: string[];
}
interface Effect { value: Value; definite: boolean }
interface RegionEffect { definite: boolean; shallow: boolean }
interface OrderedChange { stamp: number; definite: boolean; exported?: boolean; shallow?: boolean }
interface Summary { params: Value[]; returns: Value; effects: Map<string, Effect>; regions: Map<string, RegionEffect>; omittedRegions?: Set<string>; version: number; incomplete?: boolean }
interface State { memory: Map<string, Value>; effects: Map<string, Effect>; alive: boolean; incomplete?: boolean; regions?: Map<string, OrderedChange>; writes?: Map<string, OrderedChange>; omittedRegions?: Map<string, boolean> }
interface Context { program: FlowProgram; locals: Map<string, FlowLocal>; exits: State[]; returned: Value }
interface Observation { value: Value; expression: string; kind: 'variable' | 'unknown' }
interface ArgumentObservation { call: Extract<Expr, { kind: 'call' }>; values: Map<number, Value> }
// A trailing @ denotes an address of one object/element, rather than an array
// value that decays to its first element. It is never part of a memory slot.
const physical = (object: string) => object.endsWith('@') ? object.slice(0, -1) : object;
function composeObject(object: string, suffix: string): string {
  if (!object.endsWith('@') || !suffix) return object + suffix;
  const base = physical(object), offset = /^\[(-?\d+|\*)\]/.exec(suffix);
  if (!offset) return base + suffix;
  const element = /\[(-?\d+|\*)\]$/.exec(base), tail = suffix.slice(offset[0].length);
  if (!element) return offset[1] === '0' ? base + tail : base + offset[0] + tail;
  const sum = element[1] === '*' || offset[1] === '*' ? '*' : Number(element[1]) + Number(offset[1]);
  return base.slice(0, element.index) + '[' + (Number.isSafeInteger(sum) ? sum : '*') + ']' + tail;
}
function coalesceObjects(objects: ReadonlySet<string>): ReadonlySet<string> {
  if (objects.size < 2) return objects;
  const patterns = [...objects].filter(object => object.includes('[*]')).map(object => ({ object,
    pattern: new RegExp('^' + object.split('[*]').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\[[^\\]]+\\]') + '$') }));
  if (!patterns.length) return objects;
  return new Set([...objects].filter(object => !patterns.some(other => other.object !== object && other.pattern.test(object))));
}
const projectCache = new WeakMap<object, { inputs: FileAnalysis[]; results: FileAnalysis[]; analyzeCallbacks: boolean; memoryLimited?: boolean; progress?: CallbackProgress }>();
const callbackMemoryLimit = 'Callback analysis memory budget reached; targets may be incomplete. Narrow Include/Exclude scope.';
const fileCaches = new WeakMap<object, WeakMap<FileAnalysis, { fingerprint: string; result: FileAnalysis }>>();
export function clearPointerCache(owner: object) { projectCache.delete(owner); fileCaches.delete(owner); }
const arrayIndices = new WeakMap<Map<string, Value>, Map<string, Set<string>>>();
const objectSlots = new WeakMap<Map<string, Value>, Map<string, Set<string>>>();
function registerObject(index: Map<string, Set<string>>, key: string) {
  for (let n = key.indexOf('#') + 1; n < key.length; n++) if (key[n] === '.' || key[n] === '[') {
    const root = key.slice(0, n), entries = index.get(root) ?? new Set<string>();
    entries.add(key); index.set(root, entries);
  }
}
function registerIndices(index: Map<string, Set<string>>, key: string) {
  for (const match of key.matchAll(/\[[^\]]+\]/g)) {
    const root = key.slice(0, match.index), entries = index.get(root) ?? new Set<string>();
    entries.add(match[0]); index.set(root, entries);
  }
}
function memorySet(memory: Map<string, Value>, key: string, value: Value) {
  if (!memory.has(key)) {
    const arrays = arrayIndices.get(memory); if (arrays) registerIndices(arrays, key);
    const objects = objectSlots.get(memory); if (objects) registerObject(objects, key);
  }
  memory.set(key, value);
}
function descendants(memory: Map<string, Value>, root: string): string[] {
  let index = objectSlots.get(memory);
  if (!index) { index = new Map(); for (const key of memory.keys()) registerObject(index, key); objectSlots.set(memory, index); }
  return [...(memory.has(root) ? [root] : []), ...(index.get(root) ?? [])];
}
function knownIndices(memory: Map<string, Value>, root: string): Set<string> {
  let index = arrayIndices.get(memory);
  if (!index) { index = new Map(); for (const key of memory.keys()) registerIndices(index, key); arrayIndices.set(memory, index); }
  return index.get(root) ?? new Set();
}
// Values are immutable: empty containers and unchanged facts can be shared.
const empty: Value = { targets: new Map(), objects: new Set(), params: new Set(), numbers: new Set(), unknown: false, nil: false, evidence: [], reasons: [] };
const blank = (): Value => empty;
const unknown = (reason: string): Value => ({ ...blank(), unknown: true, reasons: [reason] });
const frames = (items: Evidence[]) => items.filter((item, i) => items.findIndex(other => other.location.uri === item.location.uri && other.location.start === item.location.start && other.reason === item.reason) === i).slice(-8);
function union(...values: Value[]): Value {
  if (!values.length) return empty;
  const first = values[0];
  // Evidence/reasons are already normalized. Preserve the candidate cap for
  // freshly constructed object sets before reusing an immutable value.
  if (values.every(value => value === first) && first.targets.size <= 64 && first.objects.size <= 64 && first.params.size <= 64 && first.numbers.size <= 64) return first;
  let targets: Map<string, Evidence[]> | undefined, objects: Set<string> | undefined, params: Set<string> | undefined, numbers: Set<number> | undefined;
  let unknown = false, nil = false;
  const evidence: Evidence[] = [], reasons: string[] = [];
  for (const value of values) {
    if (value.targets.size) targets ??= new Map();
    for (const [id, chain] of value.targets) {
      if (targets!.has(id) || targets!.size < 64) targets!.set(id, frames([...(targets!.get(id) ?? []), ...chain]));
      else { unknown = true; reasons.push('Target limit: 64 candidates'); }
    }
    if (value.objects.size) objects ??= new Set();
    if (value.params.size) params ??= new Set();
    if (value.numbers.size) numbers ??= new Set();
    for (const [target, source] of [[objects, value.objects], [params, value.params], [numbers, value.numbers]] as const) {
      for (const key of source) {
        if (target!.size < 64 || (target as Set<string | number>).has(key)) (target as Set<string | number>).add(key);
        else { unknown = true; reasons.push('Alias/value limit: 64 candidates'); }
      }
    }
    unknown ||= value.unknown; nil ||= value.nil;
    evidence.push(...value.evidence); reasons.push(...value.reasons);
  }
  return { targets: targets ?? empty.targets, objects: coalesceObjects(objects ?? empty.objects), params: params ?? empty.params, numbers: numbers ?? empty.numbers,
    unknown, nil, evidence: frames(evidence), reasons: [...new Set(reasons)].slice(0, 8) };
}
function evidence(value: Value, frame: Evidence): Value {
  const out = union(value);
  const targets = out.targets.size ? new Map([...out.targets].map(([id, chain]) => [id, frames([...chain, frame])])) : empty.targets;
  return { ...out, targets, evidence: frames([...out.evidence, frame]) };
}
const signatures = new WeakMap<Value, string>();
function signature(v: Value) {
  let result = signatures.get(v);
  if (!result) { result = JSON.stringify([[...v.targets.keys()].sort(), [...v.objects].sort(), [...v.params].sort(), [...v.numbers].sort(), v.unknown, v.nil]); signatures.set(v, result); }
  return result;
}
function covers(a: Value, b: Value) {
  return (!b.unknown || a.unknown) && (!b.nil || a.nil) &&
    [...b.targets.keys()].every(key => a.targets.has(key)) && [...b.objects].every(key => a.objects.has(key)) &&
    [...b.params].every(key => a.params.has(key)) && [...b.numbers].every(key => a.numbers.has(key));
}
const joined = (a: Value, b: Value): Value => a === b || covers(a, b) ? a : covers(b, a) ? b : union(a, b);
const clone = (s: State): State => ({ memory: new Map(s.memory), effects: new Map(s.effects), alive: s.alive, incomplete: s.incomplete,
  regions: s.regions && new Map(s.regions), writes: s.writes && new Map(s.writes), omittedRegions: s.omittedRegions && new Map(s.omittedRegions) });
function expressionText(expr: Expr): string {
  if (expr.kind === 'name') return expr.name;
  if (expr.kind === 'member') return expressionText(expr.object) + (expr.arrow ? '->' : '.') + expr.field;
  if (expr.kind === 'index') return expressionText(expr.object) + '[' + (expr.index.kind === 'number' ? expr.index.value : '…') + ']';
  if (expr.kind === 'dereference') return '*' + expressionText(expr.object);
  if (expr.kind === 'cast') return expressionText(expr.object);
  if (expr.kind === 'call') return expressionText(expr.callee) + '(…)';
  return 'indirect expression';
}
// Resolve variant-specific bindings first, then merge equivalent source calls.
function uniqueCalls(refs: ReferenceRecord[]): ReferenceRecord[] {
  const unique: ReferenceRecord[] = [], sites = new Map<string, number>();
  for (const ref of refs) {
    if (ref.kind !== 'call' || !ref.flowKey?.includes(':variant:')) { unique.push(ref); continue; }
    const key = JSON.stringify([ref.flowKey.replace(/:variant:\d+:/, ':'), ref.location.start, ref.targetId ?? ref.name, ref.callKind,
      ref.expansion?.chain.map(frame => frame.name + ':' + frame.location.start)]);
    const previous = sites.get(key);
    if (previous === undefined) { sites.set(key, unique.length); unique.push(ref); continue; }
    const old = unique[previous];
    unique[previous] = { ...old, conditions: [...new Set([...old.conditions, ...ref.conditions])], inference: old.inference && ref.inference ? {
      ...old.inference, incomplete: old.inference.incomplete || ref.inference.incomplete,
      evidence: frames([...old.inference.evidence, ...ref.inference.evidence]), reasons: [...new Set([...old.inference.reasons, ...ref.inference.reasons])]
    } : old.inference };
  }
  return unique.length === refs.length ? refs : unique;
}

// Static may-target propagation. Every produced edge is labelled as inferred.
export function inferPointerCalls(files: FileAnalysis[], memoryPressure?: () => boolean, owner: object = files[0], analyzeCallbacks = true, options: CallbackAnalysisOptions = {}): FileAnalysis[] {
  if (!files.length) { if (owner) clearPointerCache(owner); return files; }
  const now = options.now ?? (() => performance.now());
  const cached = projectCache.get(owner);
  if (cached && cached.analyzeCallbacks !== analyzeCallbacks) clearPointerCache(owner);
  if (cached && cached.analyzeCallbacks === analyzeCallbacks && !options.shouldCancel?.() && cached.inputs.length === files.length && files.every((file, n) => file === cached.inputs[n]) &&
    (!cached.memoryLimited || memoryPressure?.())) {
    if (cached.progress) options.onProgress?.({ ...cached.progress, elapsedMs: 0, cached: true });
    return cached.results;
  }
  let fileCache = fileCaches.get(owner);
  if (!fileCache) fileCaches.set(owner, fileCache = new WeakMap());
  const index = new RelationIndex(); files.forEach(file => index.update(file));
  const functionArguments = new FunctionArguments(files, index);
  const programs = analyzeCallbacks ? files.flatMap(file => file.programs ?? []) : [], byFunction = new Map<string, FlowProgram[]>();
  for (const program of programs) { const list = byFunction.get(program.id) ?? []; list.push(program); byFunction.set(program.id, list); }
  const references = analyzeCallbacks ? files.flatMap(file => file.references.filter(ref => ref.kind === 'call' && ref.flowKey)) : [];
  const localNames = new Set(programs.flatMap(program => program.locals.map(local => local.name)));
  const memoryLimited = analyzeCallbacks && memoryPressure?.() === true;
  if (!analyzeCallbacks || memoryLimited || (!options.shouldCancel?.() && !references.some(ref => ref.indirect || localNames.has(ref.name) || index.resolveReference(ref).some(s => s.kind === 'variable')))) {
    const results = files.map(file => {
      const references = uniqueCalls(file.references), argumentsFound = functionArguments.forFile(file.uri);
      const warnings = memoryLimited && file === files[0] ? [callbackMemoryLimit] : [];
      if (references === file.references && !argumentsFound.length && !warnings.length) return file;
      const fingerprint = JSON.stringify(['direct-sites', argumentsFound, warnings]);
      const previous = fileCache!.get(file); if (previous?.fingerprint === fingerprint) return previous.result;
      const result = { ...file, references, issues: warnings.length ? [...file.issues, ...warnings] : file.issues,
        callbackDiagnostics: warnings.length ? [{ kind: 'memory' as const, stage: 'setup' as const, message: callbackMemoryLimit,
          elapsedMs: 0, scopeElapsedMs: 0, evaluations: 0, scopeEvaluations: 0 }] : undefined,
        functionArguments: argumentsFound.length ? argumentsFound : undefined };
      fileCache!.set(file, { fingerprint, result }); return result;
    });
    const progress: CallbackProgress = { stage: 'setup', elapsedMs: 0, round: 0, maxRounds: 12, functionsDone: 0,
      functionsTotal: byFunction.size, evaluations: 0, scopeElapsedMs: 0, scopeEvaluations: 0, outcome: memoryLimited ? 'memory' : 'completed' };
    options.onProgress?.(progress);
    projectCache.set(owner, { inputs: files, results, analyzeCallbacks, memoryLimited, progress }); return results;
  }
  const heap = new Map<string, Value>(), summaries = new Map<string, Summary>();
  const started = now();
  let activeSymbol: SymbolRecord | undefined, currentLocation: Location | undefined;
  let stage: CallbackDiagnostic['stage'] = 'setup', evaluations = 0, functionStart = started, functionStartEvaluations = 0;
  let roundNumber = 0, functionsDone = 0, lastProgress = -Infinity;
  function progress(force = false, outcome?: CallbackProgress['outcome']) {
    const at = now();
    const value: CallbackProgress = { stage, elapsedMs: Math.max(0, Math.round(at - started)), round: roundNumber, maxRounds: 12,
      functionsDone, functionsTotal: byFunction.size, evaluations, outcome, symbol: activeSymbol?.name,
      scopeElapsedMs: activeSymbol ? Math.max(0, Math.round(at - functionStart)) : 0,
      scopeEvaluations: activeSymbol ? evaluations - functionStartEvaluations : 0 };
    if (force || at - lastProgress >= 500) { lastProgress = at; options.onProgress?.(value); }
    return value;
  }
  const details = new Map<string, CallbackDiagnostic>();
  const omitted = new Set<string>();
  const costs = new Map<string, NonNullable<CallbackDiagnostic['costs']>[number]>();
  let projectIncomplete = false;
  function notice(message: string, slots?: number, scoped = false, storage?: () => NonNullable<CallbackDiagnostic['storage']>) {
    notices.add(message);
    if (!scoped && !message.includes('mutation limit')) projectIncomplete = true;
    const key = `${message}:${stage}:${activeSymbol?.id ?? ''}`;
    if (details.has(key)) return;
    if (details.size >= 64) { omitted.add(message); return; }
    const at = now();
    const kind: CallbackDiagnostic['kind'] = message.includes('cancelled') ? 'cancelled' : message.includes('memory') ? 'memory' : message.startsWith('Callback analysis budget:') ? 'time'
      : message.includes('work limit') ? 'work' : message.includes('mutation') ? 'mutation' : message.includes('loop') ? 'loop'
      : message.includes('array') ? 'array' : 'propagation';
    details.set(key, { kind, stage, message, symbol: activeSymbol?.name,
      location: currentLocation ?? activeSymbol?.location,
      elapsedMs: Math.max(0, Math.round(at - started)), scopeElapsedMs: activeSymbol ? Math.max(0, Math.round(at - functionStart)) : 0,
      evaluations, scopeEvaluations: activeSymbol ? evaluations - functionStartEvaluations : 0, slots, storage: storage?.() });
  }
  function storageDetail(operation: NonNullable<CallbackDiagnostic['storage']>['operation'], keys: Iterable<string>, omitted: string, retained: number) {
    const label = (slot: string) => {
      const part = formal(slot);
      if (part) return `${index.symbol(part.fn)?.name ?? part.fn}.parameter[${part.index + 1}]${part.suffix}`;
      const root = /^(.*?#\d+)(.*)$/.exec(slot), symbol = root && index.symbol(root[1]);
      return symbol ? `${symbol.location.uri.split('/').pop()}:${symbol.location.line + 1} ${symbol.name}${root![2]}` : slot;
    };
    const sample: string[] = [];
    for (const key of keys) { if (sample.length === 8) break; sample.push(label(key)); }
    return { operation, retained, omitted: label(omitted), sample };
  }
  const parameterLayouts = new Map<string, ReturnType<RelationIndex['layout']>[]>();
  const returnStorage = new Map<string, boolean>();
  for (const [id, list] of byFunction) {
    parameterLayouts.set(id, list[0].params.map(id => {
      const local = list[0].locals.find(local => local.id === id)!;
      return index.layout({ ...local, kind: 'variable', definition: true, storage: 'local', conditions: [], pointer: false, extent: local.location });
    }));
    const symbol = index.symbol(id), layouts = symbol ? index.layout(symbol) : [];
    returnStorage.set(id, layouts.some(layout => layout.layers.slice(1).length > 0 || layout.fields.length > 0));
  }
  const parameterInfo = new Map<string, { fn: string; index: number }>();
  const observations = new Map<string, Observation>(), notices = new Set<string>();
  const argumentObservations = new Map<string, ArgumentObservation>();
  let changed = false, steps = 0;
  let timedOut = false, checks = 0;
  function expired(force = false) {
    if (!timedOut && options.shouldCancel?.()) { timedOut = true; notice('Callback analysis cancelled; targets may be incomplete. Resume local analysis to retry.'); }
    if (!timedOut && (force || (++checks & 255) === 0)) {
      if (memoryPressure?.()) { timedOut = true; notice(callbackMemoryLimit); }
      if (options.onProgress) progress();
    }
    return timedOut;
  }
  interface Dependencies { heap: Map<string, Value | undefined>; functions: Map<string, number>; shapes: Map<string, number>; regions: Map<string, number>; observations: Set<string>; arguments: Set<string> }
  const completed = new Map<string, { dependencies: Dependencies; params: Value[]; observations: Map<string, Observation>; arguments: Map<string, ArgumentObservation> }>();
  let dependencies: Dependencies | undefined;
  const depend = (fn: string) => { if (dependencies && !dependencies.functions.has(fn)) dependencies.functions.set(fn, summaries.get(fn)?.version ?? -1); };
  const heapValue = (key: string) => { const value = heap.get(key); if (dependencies && !dependencies.heap.has(key)) dependencies.heap.set(key, value); return value; };
  const heapShapes = new Map<string, number>();
  const heapShape = (root: string) => { if (dependencies && !dependencies.shapes.has(root)) dependencies.shapes.set(root, heapShapes.get(root) ?? 0); };
  const heapRegions = new Set<string>(), regionPatterns = new Map<string, RegExp>();
  interface RegionNode { root?: string; children: Map<string, RegionNode> }
  const regionRoots = new WeakMap<object, RegionNode>();
  let stamp = 0;
  const opaqueReason = 'Call may modify this storage; callback bytes are not resolved';
  function storageRoot(slot: string) {
    for (let n = slot.indexOf('#') + 1; n < slot.length; n++) if (slot[n] === '.' || slot[n] === '[') return slot.slice(0, n);
    return slot;
  }
  function regionPath(slot: string) {
    const root = storageRoot(slot);
    return [root, ...Array.from(slot.slice(root.length).matchAll(/\.[^.\[]+|\[[^\]]+\]/g), match => match[0])];
  }
  function registerRegion(regions: object, root: string) {
    const index = regionRoots.get(regions); if (!index) return;
    let node: RegionNode = index;
    for (const part of regionPath(root)) {
      let child = node.children.get(part);
      if (!child) node.children.set(part, child = { children: new Map() });
      node = child;
    }
    node.root = root;
  }
  function matchingRegions(regions: Set<string> | Map<string, unknown>, slot: string): Iterable<string> {
    let index = regionRoots.get(regions);
    if (!index) {
      regionRoots.set(regions, index = { children: new Map() });
      for (const root of regions.keys()) registerRegion(regions, root);
    }
    const matches: string[] = [];
    let nodes = [index];
    for (const part of regionPath(slot)) {
      const next: RegionNode[] = [];
      for (const node of nodes) {
        const exact = node.children.get(part), wildcard = part.startsWith('[') && part !== '[*]' ? node.children.get('[*]') : undefined;
        if (exact) next.push(exact);
        if (wildcard) next.push(wildcard);
      }
      for (const node of next) if (node.root) matches.push(node.root);
      nodes = next;
      if (!nodes.length) break;
    }
    return matches;
  }
  function containsRegion(root: string, slot: string) {
    if (slot === root || slot.startsWith(root + '.') || slot.startsWith(root + '[')) return true;
    if (!root.includes('[*]')) return false;
    let pattern = regionPatterns.get(root);
    if (!pattern) {
      pattern = new RegExp('^' + root.split('[*]').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\[[^\\]]+\\]') + '(?:$|\\.|\\[)');
      regionPatterns.set(root, pattern);
    }
    return pattern.test(slot);
  }
  function localSlot(slot: string, ctx: Context) {
    for (const [root, declaration] of ctx.locals) if (!declaration.persistent && containsRegion(root, slot)) return true;
    return false;
  }
  function rawRead(slot: string, state: State): Value | undefined {
    const written = state.writes?.get(slot)?.stamp ?? 0;
    let uncertain = false;
    if (state.regions) for (const root of matchingRegions(state.regions, slot)) {
      const invalidated = state.regions.get(root)!;
      if (invalidated.stamp > written && containsRegion(root, slot)) {
        if (invalidated.definite) return unknown(opaqueReason);
        uncertain = true;
      }
    }
    if (state.omittedRegions) for (const root of matchingRegions(state.omittedRegions, slot))
      if (containsRegion(root, slot)) uncertain = true;
    const local = state.memory.get(slot); if (local) return uncertain ? union(local, unknown(opaqueReason)) : local;
    const matching = [...matchingRegions(heapRegions, slot)];
    if (dependencies && !dependencies.regions.has(slot)) dependencies.regions.set(slot, matching.length);
    if (matching.some(root => containsRegion(root, slot))) uncertain = true;
    const value = heapValue(slot);
    return uncertain ? union(value ?? defaultValue(slot), unknown(opaqueReason)) : value;
  }
  // Retain omitted effects as uncertainty only, without expanding the traversal
  // or ordered-region budgets. If this bounded record fills too, fall back to
  // project uncertainty rather than silently discarding an affected object.
  function omitRegion(root: string, state: State, exported = true) {
    state.omittedRegions ??= new Map();
    if (!state.omittedRegions.has(root) && state.omittedRegions.size >= 256) { projectIncomplete = true; return; }
    state.omittedRegions.set(root, exported || state.omittedRegions.get(root) === true);
    registerRegion(state.omittedRegions, root);
  }
  function markRegion(root: string, state: State, definite: boolean, exported = true, shallow = false) {
    state.regions ??= new Map(); state.writes ??= new Map();
    if (!state.regions.has(root) && state.regions.size >= 256) {
      state.incomplete = true; omitRegion(root, state, exported);
      notice('Callback region limit: 256 reachable objects; targets may be incomplete', undefined, true,
        () => storageDetail('ordered-region', state.regions!.keys(), root, state.regions!.size)); return;
    }
    const previous = state.regions.get(root);
    state.regions.set(root, { stamp: ++stamp, definite, exported: exported || previous?.exported === true,
      shallow: shallow && previous?.shallow !== false });
    registerRegion(state.regions, root);
  }
  function invalidate(roots: Iterable<string>, state: State, ctx: Context, definite = true, shallow = false) {
    const pending = [...roots].map(root => ({ root: physical(root), exported: true })), seen = new Set<string>(), affected: typeof pending = [];
    // Find pointees before invalidating the slots containing their addresses.
    for (let n = 0; n < pending.length; n++) {
      if (expired()) { state.incomplete = true; return; }
      const { root, exported } = pending[n], identity = root + ':' + exported;
      if (ignoredStorage.has(root) || seen.has(identity)) continue;
      seen.add(identity);
      if (seen.size > 256) { state.incomplete = true; notice('Callback region limit: 256 reachable objects; targets may be incomplete', undefined, false,
        () => storageDetail('reachable-regions', affected.map(item => item.root), root, affected.length)); break; }
      affected.push({ root, exported });
      const resolved = new Set([...objects({ ...blank(), objects: new Set([root]) })].map(path => shallow ? byteDestination(path) : physical(path)));
      const paths = new Set([root, ...resolved]);
      for (const path of paths) {
        // Actual supplies help analyze this function, but must not escape into
        // its symbolic summary and invalidate other callers' objects.
        if (path !== root) pending.push({ root: path, exported: false });
        if (shallow) continue;
        heapShape(path);
        for (const key of new Set([...descendants(state.memory, path), ...descendants(heap, path)])) {
          if (expired()) { state.incomplete = true; return; }
          for (const reference of read(key, state).objects) {
            const object = physical(reference);
            if (object !== key && !containsRegion(path, object)) pending.push({ root: object, exported: exported && path === root });
          }
        }
      }
    }
    for (const { root, exported } of affected) {
      markRegion(root, state, definite, exported, shallow);
      if (exported && !root.startsWith('$arg:') && !localSlot(root, ctx) && !heapRegions.has(root)) {
        heapRegions.add(root); registerRegion(heapRegions, root); changed = true;
      }
    }
  }
  for (const [id, list] of byFunction) {
    summaries.set(id, { params: [], returns: blank(), effects: new Map(), regions: new Map(), version: 0 });
    list[0].params.forEach((_, n) => parameterInfo.set(id + ':param:' + n, { fn: id, index: n }));
  }
  const paramRoot = (fn: string, n: number) => '$arg:' + fn + ':param:' + n;
  const defaultValue = (slot: string): Value => {
    const parameter = formal(slot);
    return unknown(parameter && !summaries.get(parameter.fn)?.params[parameter.index]
      ? `Argument ${parameter.index + 1} to ${index.symbol(parameter.fn)?.name ?? 'function'} has no indexed supply`
      : 'Value is uninitialized or not known from indexed code');
  };
  function put(target: Map<string, Value>, key: string, value: Value) {
    const old = target.get(key); if (old && covers(old, value)) return;
    const next = old ? union(old, value) : value;
    if (!old || signature(old) !== signature(next)) changed = true;
    if (!old && target === heap) {
      // Adding a slot changes only its object/array ancestors' shape. Reads of
      // other objects must not be invalidated by total heap growth.
      let root = '';
      for (const part of regionPath(key)) {
        root += part; heapShapes.set(root, (heapShapes.get(root) ?? 0) + 1);
      }
    }
    memorySet(target, key, next);
  }
  let parameterRevision = 0;
  const materialized = new WeakMap<Value, { revision: number; value: Value; functions: Set<string> }>();
  function materialize(value: Value): Value {
    if (!value.params.size) return value;
    const previous = materialized.get(value);
    if (previous?.revision === parameterRevision) { previous.functions.forEach(depend); return previous.value; }
    let result = { ...union(value), params: empty.params };
    const pending = [...value.params].map(token => ({ token, depth: 0 })), seen = new Set<string>(), functions = new Set<string>();
    for (let n = 0; n < pending.length; n++) {
      const { token, depth } = pending[n];
      if (seen.has(token)) continue; seen.add(token);
      if (depth > 24 || seen.size > 256) { result = union(result, unknown('Callback propagation depth/work limit')); break; }
      const info = parameterInfo.get(token), arg = info && summaries.get(info.fn)?.params[info.index];
      if (info) { functions.add(info.fn); depend(info.fn); }
      if (arg) {
        const part = { ...union(arg), params: empty.params }; result = union(result, part);
        for (const next of arg.params) if (!seen.has(next)) pending.push({ token: next, depth: depth + 1 });
      } else result = union(result, unknown('No indexed caller supplies this callback'));
      if (info && index.symbol(info.fn)?.storage !== 'static') result = union(result, unknown('Other callers may supply a different argument'));
    }
    if (!result.targets.size && seen.size) result = union(result, unknown('No concrete indexed callback target'));
    materialized.set(value, { revision: parameterRevision, value: result, functions }); return result;
  }
  function formal(object: string) {
    const match = /^\$arg:(.*:param:\d+)(.*)$/.exec(object);
    const info = match && parameterInfo.get(match[1]);
    return match && info ? { ...info, token: match[1], suffix: match[2] } : undefined;
  }
  function instantiate(value: Value, fn: string, args: Value[]): Value {
    let result: Value = { ...union(value), params: new Set([...value.params].filter(token => parameterInfo.get(token)?.fn !== fn)) };
    for (const token of value.params) { const info = parameterInfo.get(token); if (info?.fn === fn) result = union(result, args[info.index] ?? unknown('Missing call argument')); }
    const objects = new Set<string>();
    for (const object of result.objects) {
      const part = formal(object);
      if (part?.fn === fn) for (const actual of args[part.index]?.objects ?? []) objects.add(composeObject(actual, part.suffix));
      else objects.add(object);
    }
    return { ...result, objects: coalesceObjects(objects) };
  }
  function objects(value: Value, seen = new Set<string>()): Set<string> {
    const output = new Set<string>();
    for (const object of materialize(value).objects) {
      const part = formal(object), arg = part && summaries.get(part.fn)?.params[part.index];
      if (part) depend(part.fn);
      if (part && arg && !seen.has(part.token)) {
        for (const target of objects(arg, new Set(seen).add(part.token))) output.add(composeObject(target, part.suffix));
      } else output.add(object);
      if (output.size >= 64) break;
    }
    return new Set(coalesceObjects(output));
  }
  const names = new WeakMap<Expr, SymbolRecord[]>(), types = new WeakMap<Expr, SymbolRecord | undefined>();
  function globalSymbols(expr: Extract<Expr, { kind: 'name' }>) {
    let symbols = names.get(expr);
    if (!symbols) { symbols = index.resolveReference({ id: '', name: expr.name, location: expr.location, kind: 'reference', conditions: [], macroIds: [] }); names.set(expr, symbols); }
    return symbols;
  }
  const wildcardSlots = new Map<string, string[]>();
  function read(slot: string, state: State): Value {
    const exact = rawRead(slot, state);
    const wildcard = slot.indexOf('[*]');
    if (wildcard >= 0) {
      const root = slot.slice(0, wildcard); heapShape(root);
      const indices = new Set([...knownIndices(heap, root), ...knownIndices(state.memory, root)]);
      const concrete = [...indices].filter(index => index !== '[*]');
      if (concrete.length) {
        const values = concrete.slice(0, 64).map(index => read(root + index + slot.slice(wildcard + 3), state));
        if (exact) values.push(exact);
        if (concrete.length > 64) values.push(unknown('Callback array read limit: 64 elements'));
        return union(...values);
      }
    }
    if (!slot.includes('[')) return exact ?? defaultValue(slot);
    let patterns = wildcardSlots.get(slot);
    if (!patterns) {
      const start = slot.indexOf('#') + 1; patterns = [slot.slice(0, start)];
      for (const part of slot.slice(start).split(/(\[[^\]]+\])/g)) {
        patterns = [...new Set(patterns.flatMap(prefix => part.startsWith('[') ? [prefix + part, prefix + '[*]'] : [prefix + part]))];
        if (patterns.length > 64) { patterns = patterns.slice(0, 64); notice('Callback array path limit: 64 wildcard combinations'); }
      }
      patterns = patterns.filter(key => key !== slot); wildcardSlots.set(slot, patterns);
    }
    const written = state.writes?.get(slot);
    // Missing wildcard slots are dependencies too: a later function may add
    // one after this function's observations have been memoized.
    const broad = patterns.filter(key => (state.memory.has(key) || heapValue(key) !== undefined) &&
      !(written?.definite && written.stamp > (state.writes?.get(key)?.stamp ?? 0)))
      .map(key => rawRead(key, state)).filter((value): value is Value => !!value);
    return broad.length ? union(exact ?? defaultValue(slot), ...broad) : exact ?? defaultValue(slot);
  }
  function write(slot: string, value: Value, state: State, ctx: Context, definite = true, summarize = true) {
    if (expired()) { state.incomplete = true; return; }
    const weak = slot.includes('[*]') || !definite;
    memorySet(state.memory, slot, weak ? union(read(slot, state), value) : value);
    if (state.regions?.size) state.writes!.set(slot, { stamp: ++stamp, definite: !weak });
    if (!localSlot(slot, ctx)) {
      // Global initializer effects are never consumed as a function summary.
      if (ctx.program.id !== 'global' && summarize) {
        if (state.effects.has(slot) || state.effects.size < 256) state.effects.set(slot, { value: state.memory.get(slot)!, definite: !weak });
        else {
          state.incomplete = true; notice('Callback mutation limit: 256 slots per function; targets may be incomplete', 256, false, () => storageDetail('write', state.effects.keys(), slot, state.effects.size));
          value = union(value, unknown('Callback mutation limit omitted this storage effect'));
          memorySet(state.memory, slot, value);
          invalidate([slot], state, ctx, false);
        }
      }
      if (!slot.startsWith('$arg:')) put(heap, slot, value);
    }
  }
  function joinStates(a: State, b: State): State {
    const result: State = { memory: new Map(), effects: new Map(), alive: a.alive || b.alive, incomplete: a.incomplete || b.incomplete };
    if (a.regions?.size || b.regions?.size) {
      for (const key of new Set([...(a.regions?.keys() ?? []), ...(b.regions?.keys() ?? [])]))
        markRegion(key, result, !!a.regions?.get(key)?.definite && !!b.regions?.get(key)?.definite,
          a.regions?.get(key)?.exported === true || b.regions?.get(key)?.exported === true,
          a.regions?.get(key)?.shallow !== false && b.regions?.get(key)?.shallow !== false);
    }
    for (const source of [a, b]) for (const [root, exported] of source.omittedRegions ?? []) omitRegion(root, result, exported);
    for (const key of new Set([...a.memory.keys(), ...b.memory.keys()])) {
      result.memory.set(key, joined(read(key, a), read(key, b)));
      result.writes?.set(key, { stamp: ++stamp, definite: true });
    }
    for (const key of new Set([...a.effects.keys(), ...b.effects.keys()])) {
      const x = a.effects.get(key), y = b.effects.get(key);
      if (result.effects.size < 256) result.effects.set(key, { value: read(key, result), definite: !!x?.definite && !!y?.definite });
      else {
        result.incomplete = true; notice('Callback mutation limit: 256 slots per function; targets may be incomplete', 256, false, () => storageDetail('branch-join', result.effects.keys(), key, result.effects.size));
        markRegion(key, result, false);
      }
    }
    return result;
  }
  function valueType(expr: Expr, ctx: Context): SymbolRecord | undefined {
    if (types.has(expr)) return types.get(expr);
    const value = computeType(expr, ctx); types.set(expr, value); return value;
  }
  function computeType(expr: Expr, ctx: Context): SymbolRecord | undefined {
    if (expr.kind === 'name') {
      const local = expr.localId && ctx.locals.get(expr.localId);
      return local ? { ...local, kind: 'variable', definition: true, storage: 'local', pointer: false, conditions: [], extent: local.location } : globalSymbols(expr).find(s => s.kind === 'variable' || s.kind === 'function');
    }
    if (expr.kind === 'cast') return valueType(expr.object, ctx);
    const base = expr.kind === 'member' || expr.kind === 'index' || expr.kind === 'dereference' ? valueType(expr.object, ctx) : expr.kind === 'call' ? valueType(expr.callee, ctx) : undefined;
    if (!base) return undefined;
    const layout = index.layout(base)[0]; if (!layout) return undefined;
    if (expr.kind === 'member') return layout.fields.find(field => field.name === expr.field);
    const drop = expr.kind === 'call' ? (layout.layers[0] === 'pointer' ? 2 : 1) : 1;
    // Preserve both the normalized base type and the declaration's scalar key.
    // Element writes must stay connected to reads of their array/pointer owner.
    return { ...base, type: { name: layout.name ?? '', tag: layout.tag, id: layout.id || undefined, layers: layout.layers.slice(drop) } };
  }
  // Follow scalar dependencies of selectors/guards/storage, rather than every
  // read (e.g. logging). Member keys preserve compatible declarations across
  // translation units without connecting unrelated aggregate names.
  const scalarReads = new Set<string>(), scalarDependencies = new Map<string, Set<string>>();
  const ignoredStorage = new Set<string>();
  const storageRecords = new Map<string, SymbolRecord>();
  function scalarKey(record: SymbolRecord) {
    const owner = record.memberOf && index.symbol(record.memberOf);
    if (!owner) return record.id;
    return `${owner.scope ? owner.id : owner.aggregate + ':' + owner.name}:${record.name}`;
  }
  function linkScalar(targets: Iterable<string>, sources: Iterable<string>) {
    const values = [...sources];
    if (!values.length) return;
    for (const key of targets) {
      const dependencies = scalarDependencies.get(key) ?? new Set<string>();
      for (const source of values) dependencies.add(source);
      scalarDependencies.set(key, dependencies);
    }
  }
  function collectReads(expr: Expr, ctx: Context, needed = false): Set<string> {
    const reads = new Set<string>();
    if (expired()) return reads;
    const collect = (child: Expr, required = false) => {
      const keys = collectReads(child, ctx, required);
      for (const key of keys) reads.add(key);
      return keys;
    };
    if (expr.kind === 'name' || expr.kind === 'member') {
      const record = valueType(expr, ctx);
      reads.add(record ? scalarKey(record) : 'unknown:' + (expr.kind === 'name' ? expr.name : expr.field));
      if (expr.kind === 'member') collect(expr.object);
    } else if (expr.kind === 'assign') {
      const left = collect(expr.left), right = collect(expr.right);
      const record = valueType(expr.left, ctx), layouts = record ? index.layout(record) : [];
      linkScalar(record && expr.left.kind !== 'dereference' ? [scalarKey(record)] : left, right);
      if (expr.right.kind === 'address') linkScalar(right, left);
      if (!layouts.length || layouts.some(layout => !layout.scalar)) for (const key of right) scalarReads.add(key);
    } else if (expr.kind === 'call') {
      const direct = expr.callee.kind === 'name' && !expr.callee.localId && globalSymbols(expr.callee).every(symbol => symbol.kind === 'function');
      collect(expr.callee, !direct);
      const args = expr.args.map(arg => collect(arg));
      if (expr.callee.kind === 'name' && !expr.callee.localId) for (const fn of globalSymbols(expr.callee)) {
        for (const program of byFunction.get(fn.id) ?? []) program.params.forEach((param, n) => {
          const storage = parameterLayouts.get(fn.id)?.[n]?.some(layout => layout.layers.length || layout.fields.length);
          const data = storage && expr.args[n] ? addressReads(expr.args[n], ctx) : args[n] ?? [];
          linkScalar([param], data);
          // Link pointed-to storage in both directions, excluding the receiver
          // and offset values that merely selected that storage address.
          if (storage) linkScalar(data, [param]);
        });
      }
    } else if (expr.kind === 'index') { collect(expr.object); collect(expr.index, true); }
    else if (expr.kind === 'address') for (const key of addressReads(expr.object, ctx)) reads.add(key);
    else if (expr.kind === 'dereference' || expr.kind === 'cast') collect(expr.object);
    else if (expr.kind === 'choice' || expr.kind === 'sequence') expr.values.forEach(value => collect(value));
    else if (expr.kind === 'initializer') expr.entries.forEach(entry => collect(entry.value));
    else if (expr.kind === 'unknown') expr.children?.forEach(child => collect(child));
    if (needed) {
      const record = valueType(expr, ctx), layouts = record ? index.layout(record) : [];
      const address = expr.kind === 'address' || (layouts.length > 0 && layouts.every(layout => layout.layers.length > 0));
      // Pointer values are already tracked. Testing a pointer for null does not
      // make its numeric pointee data a callback selector; dereferences do.
      if (!address) for (const key of reads) scalarReads.add(key);
    }
    return reads;
  }
  function addressReads(expr: Expr, ctx: Context): Set<string> {
    if (expr.kind === 'index') {
      // The offset chooses an address. It does not make the pointed-to numeric
      // buffer a callback selector through reverse argument dependencies.
      collectReads(expr.index, ctx, true);
      return addressReads(expr.object, ctx);
    }
    if (expr.kind === 'cast') return addressReads(expr.object, ctx);
    if (expr.kind === 'member') {
      addressReads(expr.object, ctx);
      const record = valueType(expr, ctx);
      return new Set([record ? scalarKey(record) : 'unknown:' + expr.field]);
    }
    return collectReads(expr, ctx);
  }
  function collectBodyReads(body: FlowStatement[], ctx: Context) {
    for (const statement of body) {
      if (statement.kind === 'expression' || statement.kind === 'return') {
        const reads = collectReads(statement.value, ctx);
        if (statement.kind === 'return') linkScalar([ctx.program.id], reads);
      }
      else if (statement.kind === 'loop' || statement.kind === 'branch') {
        collectReads(statement.condition, ctx, true);
        if (statement.kind === 'loop') collectBodyReads(statement.body, ctx);
        else { collectBodyReads(statement.then, ctx); collectBodyReads(statement.otherwise, ctx); }
      }
    }
  }
  function summarize(record: SymbolRecord | undefined) {
    if (!record || scalarReads.has(scalarKey(record)) || scalarReads.has('unknown:' + record.name)) return true;
    if (record.memberOf && index.symbol(record.memberOf)?.aggregate === 'union') return true;
    const layouts = index.layout(record);
    return !layouts.length || !layouts.every(layout => layout.layers.every(layer => layer === 'array') && layout.scalar);
  }
  function trackedStorage(record: SymbolRecord | undefined, seen = new Set<string>()): boolean {
    if (!record || seen.has(record.id)) return true;
    const layouts = index.layout(record);
    return !layouts.length || layouts.some(layout => layout.layers.some(layer => layer !== 'array') || (layout.scalar ? summarize(record)
      : !layout.fields.length || layout.fields.some(field => trackedStorage(field, new Set(seen).add(record.id)))));
  }
  function rememberStorage(slot: string, record: SymbolRecord | undefined) {
    if (record) storageRecords.set(slot, record);
    if (trackedStorage(record)) ignoredStorage.delete(slot);
    else ignoredStorage.add(slot);
  }
  function storedValue(expr: Expr, value: Value, state: State, ctx: Context): Value {
    if (!value.unknown || value.objects.size) return value;
    const record = valueType(expr, ctx), layout = record && index.layout(record)[0];
    if (record && layout?.layers[0] === 'pointer' && layout.layers[1] !== 'function')
      return { ...value, objects: new Set(['$unknown:' + record.id]) };
    if (layout && (layout.layers[0] === 'array' || (!layout.layers.length && layout.fields.length)))
      return { ...value, objects: new Set(slots(expr, state, ctx)) };
    return value;
  }
  function copyStorage(destination: string, sources: ReadonlySet<string>, layout: ReturnType<RelationIndex['layout']>[number], state: State, ctx: Context, depth = 0, record?: SymbolRecord) {
    sources = new Set([...sources].map(physical));
    if (depth >= 16) { write(destination, unknown('Aggregate copy depth limit'), state, ctx); return; }
    if (layout.layers[0] === 'array') {
      write(destination, { ...blank(), objects: new Set([destination]) }, state, ctx, true, summarize(record));
      const indices = new Set<string>();
      for (const root of sources) {
        heapShape(root);
        for (const suffix of [...knownIndices(heap, root), ...knownIndices(state.memory, root)]) indices.add(suffix);
      }
      for (const suffix of indices) copyStorage(destination + suffix, new Set([...sources].map(root => root + suffix)), { ...layout, layers: layout.layers.slice(1) }, state, ctx, depth + 1, record);
    } else if (!layout.layers.length && layout.fields.length) {
      write(destination, { ...blank(), objects: new Set([destination]) }, state, ctx);
      for (const field of layout.fields) copyStorage(destination + '.' + field.name, new Set([...sources].map(root => root + '.' + field.name)),
        index.layout(field)[0] ?? { id: '', layers: [], conditions: [], fields: [] }, state, ctx, depth + 1, field);
    } else write(destination, union(...[...sources].map(root => read(root, state))), state, ctx, true, summarize(record));
  }
  function publish(value: Value, state: State) {
    for (const object of value.objects) for (const key of descendants(state.memory, physical(object))) put(heap, key, read(key, state));
  }
  function opaqueRoots(expr: Expr, value: Value, state: State, ctx: Context): ReadonlySet<string> {
    const record = valueType(expr, ctx), layouts = record ? index.layout(record) : [];
    const layout = layouts[0];
    if (layout && !layout.layers.length && layout.fields.length) {
      const roots = new Set<string>();
      const visit = (base: ReadonlySet<string>, fields: SymbolRecord[], depth: number) => {
        if (depth > 8) return;
        for (const field of fields) {
          const type = index.layout(field)[0], slots = [...base].map(root => root + '.' + field.name);
          if (type?.layers[0] === 'pointer' && type.layers[1] !== 'function') {
            for (const slot of slots) for (const root of read(slot, state).objects) roots.add(root);
          } else if (type && !type.layers.length && type.fields.length) visit(new Set(slots), type.fields, depth + 1);
        }
      };
      visit(value.objects, layout.fields, 0); return roots;
    }
    if (layout?.layers[0] === 'function' || (layout?.layers[0] === 'pointer' && layout.layers[1] === 'function')) return new Set();
    return value.objects;
  }
  function indexSlots(base: ReadonlySet<string>, indices: Value, state: State, writing: boolean): string[] {
    const result = new Set<string>(), concrete = [...indices.numbers];
    for (const root of base) {
      if (concrete.length && !indices.unknown) for (const n of concrete) result.add(physical(composeObject(root, '[' + n + ']')));
      else if (writing) result.add(physical(composeObject(root, '[*]')));
      else {
        const array = root.endsWith('@') ? physical(root).replace(/\[[^\]]+\]$/, '') : root;
        heapShape(array);
        const suffixes = new Set([...knownIndices(heap, array), ...knownIndices(state.memory, array)]);
        for (const suffix of suffixes) result.add(array + suffix);
        if (!suffixes.size) result.add(physical(composeObject(root, '[*]')));
      }
    }
    return [...result].slice(0, 64);
  }
  function slots(expr: Expr, state: State, ctx: Context, writing = false, address = false): string[] {
    if (expr.kind === 'name') return [...(expr.localId ? [expr.localId, ...(expr.alternatives ?? [])] : []),
      ...(!expr.localId || expr.globalFallback ? globalSymbols(expr).filter(s => s.kind === 'variable').map(s => s.id) : [])];
    if (expr.kind === 'cast') return slots(expr.object, state, ctx, writing, address);
    if (expr.kind === 'dereference') { const base = evaluate(expr.object, state, ctx); return [...(writing ? base.objects : objects(base))].map(physical); }
    if (expr.kind === 'member') { const base = evaluate(expr.object, state, ctx); return [...(writing ? base.objects : objects(base))].map(root => physical(root) + '.' + expr.field); }
    if (expr.kind === 'index') { const base = evaluate(expr.object, state, ctx); return indexSlots(writing ? base.objects : objects(base), evaluate(expr.index, state, ctx), state, writing || address); }
    return [];
  }
  function initializer(slot: string, expr: Expr, layouts: ReturnType<RelationIndex['layout']>, state: State, ctx: Context, record?: SymbolRecord) {
    rememberStorage(slot, record);
    if (layouts.length > 1) {
      const variants = layouts.map(layout => { const branch = clone(state); initializer(slot, expr, [layout], branch, ctx, record); return branch; });
      Object.assign(state, variants.slice(1).reduce((a, b) => joinStates(a, b), variants[0])); return;
    }
    if (expr.kind === 'choice') {
      const variants = expr.values.map(value => { const branch = clone(state); initializer(slot, value, layouts, branch, ctx, record); return branch; });
      if (variants.length) Object.assign(state, variants.slice(1).reduce((a, b) => joinStates(a, b), variants[0]));
      return;
    }
    if (expr.kind !== 'initializer') {
      const value = evaluate(expr, state, ctx);
      write(slot, layouts.length && layouts.every(layout => !layout.layers.length && layout.scalar) ? scalar(value) : value, state, ctx, true, summarize(record)); return;
    }
    const layout = layouts[0] ?? { id: '', layers: [], conditions: [], fields: [] };
    // Explicit designators identify storage even when the aggregate definition
    // is outside the index. Never invent positional fields without its layout.
    const designatedOnly = !layout.layers.length && !layout.fields.length && !layout.scalar &&
      expr.entries.some(entry => entry.path.length > 0);
    if (!designatedOnly && layout.layers[0] !== 'array' && (layout.layers.length || !layout.fields.length)) {
      if (expr.entries[0]) initializer(slot, expr.entries[0].value, [], state, ctx);
      return;
    }
    write(slot, { ...blank(), objects: new Set([slot]) }, state, ctx, true, summarize(record));
    let next = 0;
    for (const entry of expr.entries) {
      if (designatedOnly && !entry.path.length) continue;
      const path = entry.path.length ? entry.path : [layout.layers[0] === 'array' ? next : layout.fields[next]?.name ?? String(next)];
      let target = slot, current = layout, member = record;
      for (const part of path) {
        if (typeof part === 'number' || part === '*') {
          target += '[' + part + ']'; current = { ...current, layers: current.layers.slice(1) };
          if (member) member = { ...member, type: { name: current.name ?? '', tag: current.tag, id: current.id || undefined, layers: current.layers } };
          if (typeof part === 'number') next = part;
        } else {
          target += '.' + part;
          const field = current.fields.find(s => s.name === part); member = field;
          if (field) { next = current.fields.indexOf(field); current = index.layout(field)[0] ?? { id: '', layers: [], conditions: [], fields: [] }; }
          else current = { id: '', layers: [], conditions: [], fields: [] };
        }
      }
      initializer(target, entry.value, [current], state, ctx, member); next++;
    }
  }
  function scalar(value: Value): Value {
    if (!value.targets.size && !value.objects.size && !value.params.size) return value;
    return { ...blank(), numbers: value.numbers, nil: value.nil, unknown: true, reasons: ['Callback/storage addresses converted to scalar values are not tracked'] };
  }
  function memoryBuiltin(expr: Extract<Expr, { kind: 'call' }>) {
    if (expr.args.length !== 3 || expr.callee.kind !== 'name' || expr.callee.localId ||
      !['memcpy', 'memmove', 'memset'].includes(expr.callee.name)) return false;
    // User definitions and same-named function-pointer variables keep their
    // ordinary call effects. Only the external C library contract is modeled.
    return globalSymbols(expr.callee).every(symbol => symbol.kind === 'function' && !byFunction.has(symbol.id));
  }
  function byteDestination(root: string) {
    root = physical(root);
    // Byte counts/layout offsets are not known. A range starting at an array
    // element may cover later elements; invalidate the containing array too.
    const start = root.indexOf('[', root.indexOf('#') + 1);
    return start < 0 ? root : root.slice(0, start);
  }
  function memoryWrite(expr: Extract<Expr, { kind: 'call' }>, args: Value[], state: State, ctx: Context) {
    const count = materialize(args[2]);
    if (!count.unknown && count.numbers.size === 1 && count.numbers.has(0)) return args[0];
    const argument = expr.args[0];
    let storage = argument.kind === 'address' ? argument.object : argument, array: Expr | undefined;
    for (let current = storage; current.kind === 'member' || current.kind === 'index' || current.kind === 'cast'; current = current.object)
      if (current.kind === 'index') array = current.object;
    storage = array ?? storage;
    const record = valueType(storage, ctx);
    const layouts = record ? index.layout(record) : [];
    const pointer = (argument.kind !== 'address' || !!array) && layouts[0]?.layers[0] === 'pointer';
    const destination = record && pointer ? { ...record, type: { name: layouts[0].name ?? '', tag: layouts[0].tag,
      id: layouts[0].id || undefined, layers: layouts[0].layers.slice(1) } } : record;
    const roots = [...args[0].objects].map(byteDestination);
    const suppliedCallbackStorage = [...objects(args[0])].map(byteDestination).some(root => {
      const supplied = storageRecords.get(root);
      return !!supplied && trackedStorage(supplied);
    });
    for (const root of roots) {
      if (suppliedCallbackStorage) ignoredStorage.delete(root);
      else rememberStorage(root, destination);
    }
    // These functions write bytes in the destination object, never through a
    // pointer field inside it. Source objects are read-only. Unknown copied or
    // zero-filled bytes do not establish any callable function pointer value.
    invalidate(roots, state, ctx, true, true);
    return evidence(args[0], { location: expr.location, reason: 'Memory function returns its destination' });
  }
  function evaluate(expr: Expr, state: State, ctx: Context): Value {
    currentLocation = expr.location; evaluations++;
    if (expired()) return unknown(notices.has(callbackMemoryLimit) ? callbackMemoryLimit : 'Callback analysis cancelled');
    if (++steps > 2_000_000) { notice('Callback analysis work limit reached'); return unknown('Callback analysis work limit'); }
    if (expr.kind === 'number') {
      const text = expr.value.replace(/[uUlL]+$/, ''), n = /^0[0-7]+$/.test(text) ? parseInt(text, 8) : Number(text);
      return Number.isFinite(n) ? { ...blank(), numbers: new Set([n]), nil: n === 0 } : unknown('Nonconstant numeric address');
    }
    if (expr.kind === 'name') {
      const values: Value[] = expr.localId ? [expr.localId, ...(expr.alternatives ?? [])].map(id => read(id, state)) : [];
      for (const symbol of !expr.localId || expr.globalFallback ? globalSymbols(expr) : []) {
        if (symbol.kind === 'function') {
          values.push({ ...blank(), targets: new Map([[symbol.id, [{ location: expr.location, reason: 'Function address: ' + symbol.name }]]]) });
        } else if (symbol.kind === 'variable') values.push(read(symbol.id, state));
      }
      return storedValue(expr, values.length ? union(...values) : unknown('Unknown value: ' + expr.name), state, ctx);
    }
    if (expr.kind === 'address') {
      if (expr.object.kind === 'name' && !expr.object.localId) {
        const symbols = globalSymbols(expr.object);
        if (symbols.length && symbols.every(s => s.kind === 'function')) return evaluate(expr.object, state, ctx);
      }
      if (expr.object.kind === 'dereference') {
        const pointer = evaluate(expr.object.object, state, ctx); if (pointer.targets.size) return pointer;
      }
      const targets = slots(expr.object, state, ctx, false, true);
      for (const target of targets) rememberStorage(target, valueType(expr.object, ctx));
      publish({ ...blank(), objects: new Set(targets) }, state);
      return { ...blank(), objects: new Set(targets.map(target => target + '@')) };
    }
    if (expr.kind === 'cast') return evaluate(expr.object, state, ctx);
    if (expr.kind === 'dereference') {
      const pointer = evaluate(expr.object, state, ctx);
      if (pointer.targets.size) return pointer;
      return storedValue(expr, union(...[...objects(pointer)].map(slot => read(physical(slot), state))), state, ctx);
    }
    if (expr.kind === 'member' || expr.kind === 'index') {
      const base = evaluate(expr.object, state, ctx);
      const locations = expr.kind === 'member' ? [...objects(base)].map(root => physical(root) + '.' + expr.field)
        : indexSlots(objects(base), evaluate(expr.index, state, ctx), state, false);
      let value = union(...locations.map(slot => read(slot, state)));
      if (!locations.length || (value.unknown && !value.targets.size && !value.objects.size && !value.params.size)) {
        const reason = !locations.length ? 'Object connection unavailable: ' + expressionText(expr.object)
          : 'Member value unavailable: ' + expressionText(expr);
        value = union(value, unknown(reason));
        const record = valueType(expr.object, ctx), layout = record && index.layout(record)[0];
        if (expr.kind === 'member' && (!layout || (!layout.fields.length && !layout.scalar)))
          value = union(value, unknown('Structure layout unavailable: ' + expressionText(expr.object) + '; positional members cannot be resolved'));
      }
      // Keep the cause of a missing getter/assignment without treating the
      // receiver's own function address as the member's callback target.
      if (base.reasons.length) value = { ...value, reasons: [...new Set([...base.reasons, ...value.reasons])].slice(0, 8) };
      return storedValue(expr, value, state, ctx);
    }
    if (expr.kind === 'choice') {
      const variants = expr.values.map(value => { const branch = clone(state); return { state: branch, value: evaluate(value, branch, ctx) }; });
      if (variants.length) Object.assign(state, variants.slice(1).reduce((a, b) => joinStates(a, b.state), variants[0].state));
      return union(...variants.map(variant => variant.value));
    }
    if (expr.kind === 'sequence') { let value = blank(); for (const child of expr.values) value = evaluate(child, state, ctx); return value; }
    if (expr.kind === 'assign') {
      const targets = slots(expr.left, state, ctx, true), record = valueType(expr.left, ctx);
      if (expr.right.kind === 'initializer') {
        for (const target of targets) initializer(target, expr.right, record ? index.layout(record) : [], state, ctx, record);
        return union(...targets.map(target => read(target, state)));
      }
      let value = expr.operator === '=' ? evaluate(expr.right, state, ctx) : unknown('Compound pointer mutation');
      const layouts = record ? index.layout(record) : [];
      if (layouts.length && layouts.every(layout => !layout.layers.length && layout.scalar)) value = scalar(value);
      const pointer = layouts[0]?.layers[0] === 'pointer' && layouts[0].layers[1] !== 'function';
      if (expr.operator === '=' && pointer && value.unknown && !value.objects.size)
        value = { ...value, objects: new Set(['$object:' + expr.right.location.uri + '#' + expr.right.location.start]) };
      value = evidence(value, { location: expr.location, reason: 'Assignment or initialization' });
      if (expr.operator === '=' && layouts[0] && !layouts[0].layers.length && layouts[0].fields.length) {
        for (const target of targets) copyStorage(target, objects(value), layouts[0], state, ctx);
        return union(...targets.map(target => read(target, state)));
      }
      for (const target of targets) {
        rememberStorage(target, record);
        write(target, value, state, ctx, targets.length === 1, summarize(record));
      }
      return value;
    }
    if (expr.kind === 'call') {
      const callee = evaluate(expr.callee, state, ctx), resolved = materialize(callee), args = expr.args.map(arg => evaluate(arg, state, ctx));
      if (memoryBuiltin(expr)) return memoryWrite(expr, args, state, ctx);
      for (const [n, value] of args.entries()) {
        if (!value.targets.size && (!value.params.size || value.objects.size)) continue;
        dependencies?.arguments.add(expr.key);
        let observation = argumentObservations.get(expr.key);
        if (!observation) argumentObservations.set(expr.key, observation = { call: expr, values: new Map() });
        const old = observation.values.get(n);
        observation.values.set(n, old ? union(old, value) : value);
      }
      for (const arg of args) publish(arg, state);
      const direct = expr.callee.kind === 'name' && !expr.callee.localId && globalSymbols(expr.callee).every(s => s.kind === 'function');
      if (!direct) {
        dependencies?.observations.add(expr.key);
        const previous = observations.get(expr.key);
        observations.set(expr.key, { value: previous ? union(previous.value, resolved) : resolved, expression: expressionText(expr.callee),
          kind: ['name', 'member', 'index', 'dereference'].includes(expr.callee.kind) ? 'variable' : 'unknown' });
      }
      const returns: Value[] = [], effects = new Map<string, { value: Value; count: number; definite: boolean }>();
      const regions = new Map<string, { count: number; definite: boolean; shallow: boolean }>();
      let opaque = resolved.unknown || resolved.nil || !resolved.targets.size;
      for (const fn of resolved.targets.keys()) {
        depend(fn);
        const target = summaries.get(fn);
        if (!target) { opaque = true; returns.push(unknown('Return value unavailable: ' + (index.symbol(fn)?.name ?? expressionText(expr.callee)) + ' has no indexed body')); continue; }
        // Budgeted omissions are represented by their affected regions. An
        // indexed helper's unused arguments are not opaque mutation roots.
        args.forEach((arg, n) => {
          if (!parameterLayouts.get(fn)?.[n]?.some(layout => layout.layers.length || layout.fields.length)) return;
          const value = evidence(arg, { location: expr.location, reason: 'Argument ' + (n + 1) + ' to ' + (index.symbol(fn)?.name ?? 'function') }), old = target.params[n];
          target.params[n] = old ? joined(old, value) : value;
          if (!old || signature(old) !== signature(target.params[n])) { changed = true; parameterRevision++; target.version++; }
        });
        returns.push(instantiate(target.returns, fn, args));
        const targetRegions = new Map<string, RegionEffect>();
        for (const root of target.omittedRegions ?? []) {
          const part = formal(root);
          for (const key of part?.fn === fn ? [...(args[part.index]?.objects ?? [])].map(actual => physical(composeObject(actual, part.suffix))) : [root])
            invalidate([key], state, ctx, false);
        }
        for (const [root, change] of target.regions) {
          const part = formal(root);
          const keys = part?.fn === fn ? [...(args[part.index]?.objects ?? [])].map(actual => physical(composeObject(actual, part.suffix))) : [root];
          for (const key of keys.map(key => change.shallow ? byteDestination(key) : key)) {
            const previous = targetRegions.get(key);
            targetRegions.set(key, { definite: change.definite || previous?.definite === true,
              shallow: change.shallow && previous?.shallow !== false });
          }
        }
        for (const [key, change] of targetRegions) {
          const old = regions.get(key);
          regions.set(key, { count: (old?.count ?? 0) + 1, definite: (old?.definite ?? true) && change.definite,
            shallow: (old?.shallow ?? true) && change.shallow });
        }
        for (const [key, effect] of target.effects) {
          const part = formal(key);
          const keys = [...coalesceObjects(new Set(part?.fn === fn ? [...(args[part.index]?.objects ?? [])].map(actual => physical(composeObject(actual, part.suffix))) : [key]))];
          for (const key of keys) {
            if (!effects.has(key) && effects.size >= 256) {
              // Only this omitted storage effect is uncertain, not every argument.
              state.incomplete = true; notice('Callback mutation limit: 256 slots per function; targets may be incomplete', 256, false, () => storageDetail('call-effects', effects.keys(), key, effects.size));
              regions.set(key, { count: 0, definite: false, shallow: false }); continue;
            }
            const value = instantiate(effect.value, fn, args), old = effects.get(key);
            effects.set(key, { value: old ? union(old.value, value) : value, count: (old?.count ?? 0) + 1, definite: (old?.definite ?? true) && effect.definite && keys.length === 1 });
          }
        }
      }
      const definiteRegions = new Set([...regions].filter(([, change]) => change.definite && change.count === resolved.targets.size).map(([root]) => root));
      for (const shallow of [false, true]) {
        const matching = [...regions.keys()].filter(root => regions.get(root)!.shallow === shallow);
        invalidate(matching.filter(root => !definiteRegions.has(root)), state, ctx, false, shallow);
        invalidate(matching.filter(root => definiteRegions.has(root)), state, ctx, true, shallow);
      }
      // Opaque calls retain their transitive pointee invalidation.
      if (opaque) {
        const roots = new Set<string>();
        for (const [n, arg] of args.entries()) for (const root of opaqueRoots(expr.args[n], arg, state, ctx)) roots.add(root);
        invalidate(roots, state, ctx);
      }
      for (const [key, effect] of effects) write(key, effect.value, state, ctx, effect.definite && !opaque && effect.count === resolved.targets.size);
      return returns.length ? union(...returns) : unknown('Return value unavailable: ' + expressionText(expr.callee));
    }
    if (expr.kind === 'initializer') return union(...expr.entries.map(entry => evaluate(entry.value, state, ctx)));
    if (expr.kind === 'unknown') for (const child of expr.children ?? []) evaluate(child, state, ctx);
    return unknown('Unsupported value expression');
  }
  function execute(body: FlowStatement[], state: State, ctx: Context): State {
    for (const statement of body) {
      if (!state.alive || timedOut || steps > 2_000_000) break;
      if (statement.kind === 'expression') evaluate(statement.value, state, ctx);
      else if (statement.kind === 'return') {
        const evaluated = evaluate(statement.value, state, ctx);
        const value = returnStorage.get(ctx.program.id) ? evaluated : unknown('Scalar return is not a tracked callback/storage value'); publish(value, state);
        ctx.returned = union(ctx.returned, value); ctx.exits.push(clone(state)); state.alive = false;
      } else if (statement.kind === 'branch') {
        evaluate(statement.condition, state, ctx);
        const a = execute(statement.then, clone(state), ctx), b = execute(statement.otherwise, clone(state), ctx);
        state = a.alive && b.alive ? joinStates(a, b) : a.alive ? a : b;
      } else if (statement.kind === 'loop') {
        let combined = clone(state), stable = false;
        for (let n = 0; n < 4; n++) {
          const before = clone(combined); evaluate(statement.condition, before, ctx);
          const after = execute(statement.body, before, ctx), next = joinStates(state, after);
          stable = [...next.memory].every(([key, value]) => combined.memory.has(key) && signature(value) === signature(combined.memory.get(key)!));
          combined = next; if (stable) break;
        }
        if (!stable) notice('Callback loop propagation limit: 4 passes; targets may be incomplete');
        state = combined;
      }
    }
    return state;
  }
  const globalProgram: FlowProgram = { id: 'global', locals: [], params: [], body: [] };
  const persistent = new Map(programs.flatMap(program => program.locals.filter(local => local.persistent).map(local => [local.id, local] as const)));
  const globalContext: Context = { program: globalProgram, locals: persistent, exits: [], returned: blank() };
  progress(true);
  for (const program of programs) {
    if (expired()) break;
    collectBodyReads(program.body, { program, locals: new Map(program.locals.map(local => [local.id, local])), exits: [], returned: blank() });
  }
  for (const file of files) for (const init of file.initializers ?? []) {
    if (expired()) break;
    const reads = collectReads(init.value, globalContext);
    linkScalar([init.id], reads);
    if (init.value.kind === 'address') linkScalar(reads, [init.id]);
  }
  const requiredScalars = [...scalarReads];
  for (let n = 0; n < requiredScalars.length && !expired(); n++) for (const source of scalarDependencies.get(requiredScalars[n]) ?? []) {
    if (!scalarReads.has(source)) { scalarReads.add(source); requiredScalars.push(source); }
  }
  scalarDependencies.clear();
  expired(true);
  stage = 'initializers';
  progress(true);
  for (const file of files) for (const init of file.initializers ?? []) {
    if (timedOut) break;
    const local = persistent.get(init.id);
    const symbol = index.symbol(init.id) ?? (local && valueType({ kind: 'name', name: local.name, localId: local.id, location: local.location }, globalContext));
    activeSymbol = symbol; currentLocation = init.location; functionStart = now(); functionStartEvaluations = evaluations;
    if (symbol) initializer(init.id, init.value, index.layout(symbol), { memory: new Map(), effects: new Map(), alive: true }, globalContext);
  }
  activeSymbol = undefined; currentLocation = undefined;
  stage = 'propagation';
  let converged = false;
  let lastObservations = new Map<string, Observation>(), lastArguments = new Map<string, ArgumentObservation>();
  for (let round = 0; round < 12; round++) {
    activeSymbol = undefined; currentLocation = undefined;
    roundNumber = round + 1; functionsDone = 0; progress(true);
    lastObservations = new Map(observations); lastArguments = new Map(argumentObservations);
    changed = false; observations.clear(); argumentObservations.clear(); steps = 0;
    for (const [id, list] of byFunction) {
      activeSymbol = index.symbol(id); currentLocation = activeSymbol?.location;
      functionStart = now(); functionStartEvaluations = evaluations;
      progress(true);
      if (expired()) break;
      const exits: State[] = [], target = summaries.get(id)!; let returned = blank();
      let cost = costs.get(id);
      if (!cost) { cost = { symbol: activeSymbol?.name ?? id, location: activeSymbol?.location, runs: 0, cacheHits: 0, evaluations: 0, elapsedMs: 0 }; costs.set(id, cost); }
      const previous = completed.get(id);
      if (previous && previous.params.length === target.params.length && previous.params.every((value, n) => value === target.params[n]) &&
        [...previous.dependencies.heap].every(([key, value]) => heap.get(key) === value) &&
        [...previous.dependencies.functions].every(([fn, version]) => summaries.get(fn)?.version === version) &&
        [...previous.dependencies.regions].every(([slot, count]) => [...matchingRegions(heapRegions, slot)].length === count) &&
        [...previous.dependencies.shapes].every(([root, version]) => (heapShapes.get(root) ?? 0) === version)) {
        cost.cacheHits++;
        previous.observations.forEach((value, key) => observations.set(key, value));
        previous.arguments.forEach((value, key) => argumentObservations.set(key, value)); functionsDone++; continue;
      }
      cost.runs++;
      const beforeParams = [...target.params];
      dependencies = { heap: new Map(), functions: new Map(), shapes: new Map(), regions: new Map(), observations: new Set(), arguments: new Set() };
      for (const program of list) {
        if (expired()) break;
        const ctx: Context = { program, locals: new Map(program.locals.map(local => [local.id, local])), exits: [], returned: blank() };
        const state: State = { memory: new Map(), effects: new Map(), alive: true };
        program.params.forEach((local, n) => {
          const layouts = parameterLayouts.get(id)?.[n] ?? [];
          const variants = (layouts.length ? layouts : [undefined]).map(layout => {
            const branch = layouts.length > 1 ? clone(state) : state;
            if (layout && !layout.layers.length && layout.fields.length) {
              const supplied = target.params[n];
              copyStorage(local, supplied ? objects(supplied) : new Set(), layout, branch, ctx);
            } else {
              const pointer = layout?.layers[0] === 'array' || (layout?.layers[0] === 'pointer' && layout.layers[1] !== 'function');
              const callable = layout?.layers.includes('function');
              branch.memory.set(local, pointer || callable ? { ...blank(), params: new Set(callable || !layout?.id ? [id + ':param:' + n] : []), objects: new Set(pointer ? [paramRoot(id, n)] : []) } : unknown('Scalar argument/index is not propagated across functions'));
            }
            return branch;
          });
          if (variants.length > 1) Object.assign(state, variants.slice(1).reduce(joinStates, variants[0]));
        });
        const end = execute(program.body, state, ctx); if (end.alive) ctx.exits.push(end);
        exits.push(...ctx.exits); returned = union(returned, ctx.returned);
      }
      const nextReturns = joined(target.returns, returned);
      if (signature(nextReturns) !== signature(target.returns)) { changed = true; target.version++; }
      target.returns = nextReturns;
      const all = exits.length ? exits.slice(1).reduce((a, b) => joinStates(a, b), exits[0]) : undefined;
      if (all?.incomplete && !target.incomplete) { target.incomplete = true; target.version++; changed = true; }
      function omitSummaryRegion(root: string) {
        target.omittedRegions ??= new Set();
        if (target.omittedRegions.has(root)) return;
        if (target.omittedRegions.size >= 256) { projectIncomplete = true; return; }
        target.omittedRegions.add(root); target.version++; changed = true;
      }
      for (const [root, exported] of all?.omittedRegions ?? []) {
        if (exported && !list.some(program => localSlot(root, { program, locals: new Map(program.locals.map(local => [local.id, local])), exits: [], returned: blank() })))
          omitSummaryRegion(root);
      }
      for (const [root, change] of all?.regions ?? []) {
        if (!change.exported) continue;
        if (list.some(program => localSlot(root, { program, locals: new Map(program.locals.map(local => [local.id, local])), exits: [], returned: blank() }))) continue;
        const previous = target.regions.get(root), shallow = change.shallow === true && previous?.shallow !== false;
        if (previous?.definite !== change.definite || previous?.shallow !== shallow) {
          if (!target.regions.has(root) && target.regions.size >= 256) {
            omitSummaryRegion(root); notice('Callback region limit: 256 reachable objects; targets may be incomplete', undefined, true,
              () => storageDetail('function-regions', target.regions.keys(), root, target.regions.size)); target.incomplete = true; continue;
          }
          target.regions.set(root, { definite: change.definite, shallow }); target.version++; changed = true;
        }
      }
      for (const [key, effect] of all?.effects ?? []) {
        if (!target.effects.has(key) && target.effects.size >= 256) {
          if (!target.incomplete) { target.incomplete = true; target.version++; changed = true; }
          if (!target.regions.has(key)) {
            if (target.regions.size < 256) { target.regions.set(key, { definite: false, shallow: false }); target.version++; changed = true; }
            else { omitSummaryRegion(key); notice('Callback region limit: 256 reachable objects; targets may be incomplete', undefined, true,
              () => storageDetail('function-regions', target.regions.keys(), key, target.regions.size)); }
          }
          notice('Callback mutation limit: 256 slots per function; targets may be incomplete', 256, false, () => storageDetail('function-effects', target.effects.keys(), key, target.effects.size)); continue;
        }
        const old = target.effects.get(key), finalValue = read(key, all!), value = old ? joined(old.value, finalValue) : finalValue;
        if (!old || signature(old.value) !== signature(value) || old.definite !== effect.definite) { changed = true; target.version++; }
        target.effects.set(key, { value, definite: effect.definite });
      }
      completed.set(id, { dependencies, params: beforeParams, observations: new Map([...dependencies.observations].map(key => [key, observations.get(key)!])),
        arguments: new Map([...dependencies.arguments].map(key => [key, argumentObservations.get(key)!])) });
      cost.evaluations += evaluations - functionStartEvaluations;
      cost.elapsedMs += Math.max(0, now() - functionStart);
      functionsDone++;
      dependencies = undefined;
    }
    if (timedOut) break;
    if (!changed) { converged = true; break; }
  }
  activeSymbol = undefined; currentLocation = undefined;
  if (timedOut) {
    for (const [key, previous] of lastObservations) {
      const current = observations.get(key);
      observations.set(key, current ? { ...current, value: union(previous.value, current.value) } : previous);
    }
    for (const [key, previous] of lastArguments) {
      const current = argumentObservations.get(key);
      if (!current) argumentObservations.set(key, previous);
      else for (const [position, value] of previous.values) current.values.set(position, union(value, current.values.get(position) ?? blank()));
    }
  }
  if (!converged && !timedOut) notice('Callback propagation limit: 12 project passes; targets may be incomplete');
  // Attach once, after all measured runs (including a stopped run) have finished.
  // These are cumulative propagation costs, not the location of the first limit.
  const firstDetail = details.values().next().value;
  if (firstDetail) firstDetail.costs = [...costs.values()].sort((a, b) => b.evaluations - a.evaluations).slice(0, 8)
    .map(cost => ({ ...cost, elapsedMs: Math.round(cost.elapsedMs) }));
  for (const observation of argumentObservations.values()) for (const [n, observed] of observation.values) {
    const value = materialize(observed);
    functionArguments.add(observation.call, n, new Map([...value.targets].map(([id, chain]) => [id, frames([...chain, ...value.evidence])])),
      true, value.unknown || value.nil || !converged || projectIncomplete, [...new Set([...value.reasons, ...(projectIncomplete ? notices : [])])]);
  }
  const warningFile = files.find(file => file.references.some(ref => ref.kind === 'call'))?.uri ?? files[0]?.uri;
  const results = files.map(file => {
    let modified = false; const refs: ReferenceRecord[] = [];
    for (const ref of file.references) {
      const observation = ref.kind === 'call' && ref.flowKey ? observations.get(ref.flowKey) : undefined;
      if (!observation) {
        if (!converged && (timedOut || projectIncomplete) && ref.kind === 'call' && ref.flowKey &&
          (ref.indirect || index.resolveReference(ref).some(symbol => symbol.kind === 'variable'))) {
          modified = true;
          refs.push({ ...ref, inference: { expression: ref.name, evidence: [], incomplete: true,
            reasons: ['Callback call was not evaluated before analysis stopped; no target resolution is available.', ...notices] } });
        } else refs.push(ref);
        continue;
      }
      modified = true;
      const value = materialize(observation.value), incomplete = value.unknown || value.nil || !value.targets.size || !converged || projectIncomplete;
      const inference = { expression: observation.expression, evidence: value.evidence, incomplete, reasons: [...new Set([...value.reasons, ...(projectIncomplete ? notices : []), ...(value.nil ? ['Some paths have a null/non-callable value'] : [])])] };
      refs.push({ ...ref, kind: 'reference', indirect: ref.indirect || (observation.kind === 'variable' && index.resolveReference(ref).some(symbol => symbol.kind === 'function')) });
      for (const [targetId, chain] of value.targets) refs.push({
        ...ref, id: ref.id + ':target:' + targetId, name: index.symbol(targetId)?.name ?? ref.name, targetId, indirect: false, callKind: 'inferred',
        inference: { ...inference, evidence: frames([...chain, ...value.evidence]) }
      });
      if (incomplete) refs.push({ ...ref, id: ref.id + ':unknown', targetId: undefined, indirect: true, callKind: 'indirect', unresolvedKind: observation.kind, inference });
    }
    const unique = uniqueCalls(refs);
    const diagnostics = [...details.values()].filter(detail => detail.location ? detail.location.uri === file.uri : file.uri === warningFile);
    const warnings = [...new Set([...diagnostics.map(detail => detail.message), ...(file.uri === warningFile ? [...omitted].map(message => message + ' (additional locations omitted; 64 diagnostic records retained)') : [])])];
    modified ||= unique.length !== refs.length;
    const argumentsFound = functionArguments.forFile(file.uri);
    if (!modified && !warnings.length && !argumentsFound.length) return file;
    const fingerprint = JSON.stringify([unique.filter(ref => ref.inference).map(ref => [ref.id, ref.name, ref.targetId, ref.callKind, ref.inference]), warnings, argumentsFound, diagnostics]);
    const previous = fileCache!.get(file);
    if (previous?.fingerprint === fingerprint) return previous.result;
    const result = { ...file, references: unique, issues: [...file.issues, ...warnings], callbackDiagnostics: diagnostics.length ? diagnostics : undefined, functionArguments: argumentsFound.length ? argumentsFound : undefined };
    fileCache!.set(file, { fingerprint, result }); return result;
  });
  const kinds = new Set([...details.values()].map(detail => detail.kind));
  const outcome: CallbackProgress['outcome'] = kinds.has('cancelled') ? 'cancelled' : kinds.has('time') ? 'time'
    : kinds.has('memory') ? 'memory' : kinds.has('work') ? 'work' : notices.size ? 'limited' : 'completed';
  const finalProgress = progress(true, outcome);
  if (timedOut || [...notices].some(message => message.includes('work limit'))) projectCache.delete(owner);
  else projectCache.set(owner, { inputs: files, results, analyzeCallbacks, progress: finalProgress });
  return results;
}
