import { FileAnalysis, FlowExpression as Expr, FlowLocal, FlowProgram, FlowStatement, Location, ReferenceRecord, SymbolRecord } from './model';
import { RelationIndex } from './relations';
import { FunctionArguments } from './function-arguments';

type Evidence = { location: Location; reason: string };
interface Value {
  targets: Map<string, Evidence[]>; objects: Set<string>; params: Set<string>; numbers: Set<number>;
  unknown: boolean; nil: boolean; evidence: Evidence[]; reasons: string[];
}
interface Effect { value: Value; definite: boolean }
interface Summary { params: Value[]; returns: Value; effects: Map<string, Effect>; version: number; incomplete?: boolean }
interface State { memory: Map<string, Value>; effects: Map<string, Effect>; alive: boolean; incomplete?: boolean }
interface Context { program: FlowProgram; locals: Map<string, FlowLocal>; exits: State[]; returned: Value }
interface Observation { value: Value; expression: string; kind: 'variable' | 'unknown' }
interface ArgumentObservation { call: Extract<Expr, { kind: 'call' }>; values: Map<number, Value> }
const projectCache = new WeakMap<FileAnalysis, { inputs: FileAnalysis[]; results: FileAnalysis[] }>();
const fileCache = new WeakMap<FileAnalysis, { fingerprint: string; result: FileAnalysis }>();
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
const blank = (): Value => ({ targets: new Map(), objects: new Set(), params: new Set(), numbers: new Set(), unknown: false, nil: false, evidence: [], reasons: [] });
const unknown = (reason: string): Value => ({ ...blank(), unknown: true, reasons: [reason] });
const frames = (items: Evidence[]) => items.filter((item, i) => items.findIndex(other => other.location.uri === item.location.uri && other.location.start === item.location.start && other.reason === item.reason) === i).slice(-8);
function union(...values: Value[]): Value {
  const out = blank();
  for (const value of values) {
    for (const [id, chain] of value.targets) {
      if (out.targets.has(id) || out.targets.size < 64) out.targets.set(id, frames([...(out.targets.get(id) ?? []), ...chain]));
      else { out.unknown = true; out.reasons.push('Target limit: 64 candidates'); }
    }
    for (const [target, source] of [[out.objects, value.objects], [out.params, value.params], [out.numbers, value.numbers]] as const) {
      for (const key of source) {
        if (target.size < 64 || (target as Set<string | number>).has(key)) (target as Set<string | number>).add(key);
        else { out.unknown = true; out.reasons.push('Alias/value limit: 64 candidates'); }
      }
    }
    out.unknown ||= value.unknown; out.nil ||= value.nil;
    out.evidence.push(...value.evidence); out.reasons.push(...value.reasons);
  }
  out.evidence = frames(out.evidence); out.reasons = [...new Set(out.reasons)].slice(0, 8);
  return out;
}
function evidence(value: Value, frame: Evidence): Value {
  const out = union(value); out.evidence = frames([...out.evidence, frame]);
  for (const [id, chain] of out.targets) out.targets.set(id, frames([...chain, frame]));
  return out;
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
const clone = (s: State): State => ({ memory: new Map(s.memory), effects: new Map(s.effects), alive: s.alive, incomplete: s.incomplete });
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
export function inferPointerCalls(files: FileAnalysis[]): FileAnalysis[] {
  if (!files.length) return files;
  const cached = projectCache.get(files[0]);
  if (cached && cached.inputs.length === files.length && files.every((file, n) => file === cached.inputs[n])) return cached.results;
  const index = new RelationIndex(); files.forEach(file => index.update(file));
  const functionArguments = new FunctionArguments(files, index);
  const programs = files.flatMap(file => file.programs ?? []), byFunction = new Map<string, FlowProgram[]>();
  for (const program of programs) { const list = byFunction.get(program.id) ?? []; list.push(program); byFunction.set(program.id, list); }
  const references = files.flatMap(file => file.references.filter(ref => ref.kind === 'call' && ref.flowKey));
  const localNames = new Set(programs.flatMap(program => program.locals.map(local => local.name)));
  if (!references.some(ref => ref.indirect || localNames.has(ref.name) || index.resolveReference(ref).some(s => s.kind === 'variable'))) {
    const results = files.map(file => {
      const references = uniqueCalls(file.references), argumentsFound = functionArguments.forFile(file.uri);
      if (references === file.references && !argumentsFound.length) return file;
      const fingerprint = JSON.stringify(['direct-sites', argumentsFound]);
      const previous = fileCache.get(file); if (previous?.fingerprint === fingerprint) return previous.result;
      const result = { ...file, references, functionArguments: argumentsFound.length ? argumentsFound : undefined };
      fileCache.set(file, { fingerprint, result }); return result;
    });
    projectCache.set(files[0], { inputs: files, results }); return results;
  }
  const heap = new Map<string, Value>(), summaries = new Map<string, Summary>();
  const deadline = performance.now() + 10_000;
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
  function expired() {
    if (!timedOut && (++checks & 255) === 0 && performance.now() >= deadline) {
      timedOut = true; notices.add('Callback analysis budget: 10 seconds; targets may be incomplete. Narrow Include/Exclude scope.');
    }
    return timedOut;
  }
  interface Dependencies { heap: Map<string, Value | undefined>; functions: Map<string, number>; shape?: number; observations: Set<string>; arguments: Set<string> }
  const completed = new Map<string, { dependencies: Dependencies; params: Value[]; observations: Map<string, Observation>; arguments: Map<string, ArgumentObservation> }>();
  let dependencies: Dependencies | undefined;
  const depend = (fn: string) => { if (dependencies && !dependencies.functions.has(fn)) dependencies.functions.set(fn, summaries.get(fn)?.version ?? -1); };
  const heapValue = (key: string) => { const value = heap.get(key); if (dependencies && !dependencies.heap.has(key)) dependencies.heap.set(key, value); return value; };
  const heapShape = () => { if (dependencies && dependencies.shape === undefined) dependencies.shape = heap.size; };
  for (const [id, list] of byFunction) {
    summaries.set(id, { params: [], returns: blank(), effects: new Map(), version: 0 });
    list[0].params.forEach((_, n) => parameterInfo.set(id + ':param:' + n, { fn: id, index: n }));
  }
  const paramRoot = (fn: string, n: number) => '$arg:' + fn + ':param:' + n;
  const defaultValue = (_slot: string): Value => unknown('Value is uninitialized or not known from indexed code');
  function put(target: Map<string, Value>, key: string, value: Value) {
    const old = target.get(key); if (old && covers(old, value)) return;
    const next = old ? union(old, value) : value;
    if (!old || signature(old) !== signature(next)) changed = true;
    memorySet(target, key, next);
  }
  let parameterRevision = 0;
  const materialized = new WeakMap<Value, { revision: number; value: Value; functions: Set<string> }>();
  function materialize(value: Value): Value {
    if (!value.params.size) return value;
    const previous = materialized.get(value);
    if (previous?.revision === parameterRevision) { previous.functions.forEach(depend); return previous.value; }
    let result = union(value); result.params.clear();
    const pending = [...value.params].map(token => ({ token, depth: 0 })), seen = new Set<string>(), functions = new Set<string>();
    for (let n = 0; n < pending.length; n++) {
      const { token, depth } = pending[n];
      if (seen.has(token)) continue; seen.add(token);
      if (depth > 24 || seen.size > 256) { result = union(result, unknown('Callback propagation depth/work limit')); break; }
      const info = parameterInfo.get(token), arg = info && summaries.get(info.fn)?.params[info.index];
      if (info) { functions.add(info.fn); depend(info.fn); }
      if (arg) {
        const part = union(arg); part.params.clear(); result = union(result, part);
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
    let result = union(value); result.params = new Set([...value.params].filter(token => parameterInfo.get(token)?.fn !== fn));
    for (const token of value.params) { const info = parameterInfo.get(token); if (info?.fn === fn) result = union(result, args[info.index] ?? unknown('Missing call argument')); }
    const objects = new Set<string>();
    for (const object of result.objects) {
      const part = formal(object);
      if (part?.fn === fn) for (const actual of args[part.index]?.objects ?? []) objects.add(actual + part.suffix);
      else objects.add(object);
    }
    result.objects = objects; return result;
  }
  function objects(value: Value, seen = new Set<string>()): Set<string> {
    const output = new Set<string>();
    for (const object of materialize(value).objects) {
      const part = formal(object), arg = part && summaries.get(part.fn)?.params[part.index];
      if (part) depend(part.fn);
      if (part && arg && !seen.has(part.token)) {
        for (const target of objects(arg, new Set(seen).add(part.token))) output.add(target + part.suffix);
      } else output.add(object);
      if (output.size >= 64) break;
    }
    return output;
  }
  const names = new WeakMap<Expr, SymbolRecord[]>(), types = new WeakMap<Expr, SymbolRecord | undefined>();
  function globalSymbols(expr: Extract<Expr, { kind: 'name' }>) {
    let symbols = names.get(expr);
    if (!symbols) { symbols = index.resolveReference({ id: '', name: expr.name, location: expr.location, kind: 'reference', conditions: [], macroIds: [] }); names.set(expr, symbols); }
    return symbols;
  }
  const wildcardSlots = new Map<string, string[]>();
  function read(slot: string, state: State): Value {
    const exact = state.memory.get(slot) ?? heapValue(slot);
    if (!slot.includes('[')) return exact ?? defaultValue(slot);
    let patterns = wildcardSlots.get(slot);
    if (!patterns) {
      const start = slot.indexOf('#') + 1; patterns = [slot.slice(0, start)];
      for (const part of slot.slice(start).split(/(\[[^\]]+\])/g)) {
        patterns = [...new Set(patterns.flatMap(prefix => part.startsWith('[') ? [prefix + part, prefix + '[*]'] : [prefix + part]))];
        if (patterns.length > 64) { patterns = patterns.slice(0, 64); notices.add('Callback array path limit: 64 wildcard combinations'); }
      }
      patterns = patterns.filter(key => key !== slot); wildcardSlots.set(slot, patterns);
    }
    const broad = patterns.map(key => state.memory.get(key) ?? heapValue(key)).filter((value): value is Value => !!value);
    return broad.length ? union(exact ?? defaultValue(slot), ...broad) : exact ?? defaultValue(slot);
  }
  function write(slot: string, value: Value, state: State, ctx: Context, definite = true) {
    if (expired()) { state.incomplete = true; return; }
    const weak = slot.includes('[*]') || !definite;
    memorySet(state.memory, slot, weak ? union(read(slot, state), value) : value);
    const local = [...ctx.locals].some(([root, declaration]) => !declaration.persistent && (slot === root || slot.startsWith(root + '.') || slot.startsWith(root + '[')));
    if (!local) {
      if (state.effects.has(slot) || state.effects.size < 256) state.effects.set(slot, { value: state.memory.get(slot)!, definite: !weak });
      else { state.incomplete = true; notices.add('Callback mutation limit: 256 slots per function; targets may be incomplete'); }
      if (!slot.startsWith('$arg:')) put(heap, slot, value);
    }
  }
  function joinStates(a: State, b: State): State {
    const result: State = { memory: new Map(), effects: new Map(), alive: a.alive || b.alive, incomplete: a.incomplete || b.incomplete };
    for (const key of new Set([...a.memory.keys(), ...b.memory.keys()])) result.memory.set(key, joined(read(key, a), read(key, b)));
    for (const key of new Set([...a.effects.keys(), ...b.effects.keys()])) {
      const x = a.effects.get(key), y = b.effects.get(key);
      if (result.effects.size < 256) result.effects.set(key, { value: union(...[x?.value, y?.value].filter((v): v is Value => !!v)), definite: !!x?.definite && !!y?.definite });
      else { result.incomplete = true; notices.add('Callback mutation limit: 256 slots per function; targets may be incomplete'); }
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
    return { ...base, id: base.id + ':' + expr.location.start, type: { name: '', id: layout.id || undefined, layers: layout.layers.slice(drop) } };
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
  function copyStorage(destination: string, sources: Set<string>, layout: ReturnType<RelationIndex['layout']>[number], state: State, ctx: Context, depth = 0) {
    if (depth >= 16) { write(destination, unknown('Aggregate copy depth limit'), state, ctx); return; }
    if (layout.layers[0] === 'array') {
      heapShape();
      write(destination, { ...blank(), objects: new Set([destination]) }, state, ctx);
      const indices = new Set<string>();
      for (const root of sources) for (const suffix of [...knownIndices(heap, root), ...knownIndices(state.memory, root)]) indices.add(suffix);
      for (const suffix of indices) copyStorage(destination + suffix, new Set([...sources].map(root => root + suffix)), { ...layout, layers: layout.layers.slice(1) }, state, ctx, depth + 1);
    } else if (!layout.layers.length && layout.fields.length) {
      write(destination, { ...blank(), objects: new Set([destination]) }, state, ctx);
      for (const field of layout.fields) copyStorage(destination + '.' + field.name, new Set([...sources].map(root => root + '.' + field.name)),
        index.layout(field)[0] ?? { id: '', layers: [], conditions: [], fields: [] }, state, ctx, depth + 1);
    } else write(destination, union(...[...sources].map(root => read(root, state))), state, ctx);
  }
  function publish(value: Value, state: State) {
    for (const root of value.objects) for (const key of descendants(state.memory, root)) put(heap, key, state.memory.get(key)!);
  }
  function opaqueRoots(expr: Expr, value: Value, state: State, ctx: Context): Set<string> {
    const record = valueType(expr, ctx), layouts = record ? index.layout(record) : [];
    const layout = layouts[0];
    if (layout && !layout.layers.length && layout.fields.length) {
      const roots = new Set<string>();
      const visit = (base: Set<string>, fields: SymbolRecord[], depth: number) => {
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
  function indexSlots(base: Set<string>, indices: Value, state: State, writing: boolean): string[] {
    const result = new Set<string>(), concrete = [...indices.numbers];
    for (const root of base) {
      if (concrete.length && !indices.unknown) for (const n of concrete) result.add(root + '[' + n + ']');
      else if (writing) result.add(root + '[*]');
      else {
        heapShape();
        const suffixes = new Set([...knownIndices(heap, root), ...knownIndices(state.memory, root)]);
        for (const suffix of suffixes) result.add(root + suffix);
        if (!suffixes.size) result.add(root + '[*]');
      }
    }
    return [...result].slice(0, 64);
  }
  function slots(expr: Expr, state: State, ctx: Context, writing = false): string[] {
    if (expr.kind === 'name') return [...(expr.localId ? [expr.localId, ...(expr.alternatives ?? [])] : []),
      ...(!expr.localId || expr.globalFallback ? globalSymbols(expr).filter(s => s.kind === 'variable').map(s => s.id) : [])];
    if (expr.kind === 'cast') return slots(expr.object, state, ctx, writing);
    if (expr.kind === 'dereference') { const base = evaluate(expr.object, state, ctx); return [...(writing ? base.objects : objects(base))]; }
    if (expr.kind === 'member') { const base = evaluate(expr.object, state, ctx); return [...(writing ? base.objects : objects(base))].map(root => root + '.' + expr.field); }
    if (expr.kind === 'index') { const base = evaluate(expr.object, state, ctx); return indexSlots(writing ? base.objects : objects(base), evaluate(expr.index, state, ctx), state, writing); }
    return [];
  }
  function initializer(slot: string, expr: Expr, layouts: ReturnType<RelationIndex['layout']>, state: State, ctx: Context) {
    if (layouts.length > 1) {
      const variants = layouts.map(layout => { const branch = clone(state); initializer(slot, expr, [layout], branch, ctx); return branch; });
      Object.assign(state, variants.slice(1).reduce((a, b) => joinStates(a, b), variants[0])); return;
    }
    if (expr.kind === 'choice') {
      const variants = expr.values.map(value => { const branch = clone(state); initializer(slot, value, layouts, branch, ctx); return branch; });
      if (variants.length) Object.assign(state, variants.slice(1).reduce((a, b) => joinStates(a, b), variants[0]));
      return;
    }
    if (expr.kind !== 'initializer') {
      const value = evaluate(expr, state, ctx);
      write(slot, layouts.length && layouts.every(layout => !layout.layers.length && layout.scalar) ? scalar(value) : value, state, ctx); return;
    }
    const layout = layouts[0] ?? { id: '', layers: [], conditions: [], fields: [] };
    if (layout.layers[0] !== 'array' && (layout.layers.length || !layout.fields.length)) {
      if (expr.entries[0]) initializer(slot, expr.entries[0].value, [], state, ctx);
      return;
    }
    write(slot, { ...blank(), objects: new Set([slot]) }, state, ctx);
    let next = 0;
    for (const entry of expr.entries) {
      const path = entry.path.length ? entry.path : [layout.layers[0] === 'array' ? next : layout.fields[next]?.name ?? String(next)];
      let target = slot, current = layout;
      for (const part of path) {
        if (typeof part === 'number' || part === '*') {
          target += '[' + part + ']'; current = { ...current, layers: current.layers.slice(1) };
          if (typeof part === 'number') next = part;
        } else {
          target += '.' + part;
          const field = current.fields.find(s => s.name === part);
          if (field) { next = current.fields.indexOf(field); current = index.layout(field)[0] ?? { id: '', layers: [], conditions: [], fields: [] }; }
          else current = { id: '', layers: [], conditions: [], fields: [] };
        }
      }
      initializer(target, entry.value, [current], state, ctx); next++;
    }
  }
  function scalar(value: Value): Value {
    if (!value.targets.size && !value.objects.size && !value.params.size) return value;
    return { ...blank(), numbers: value.numbers, nil: value.nil, unknown: true, reasons: ['Callback/storage addresses converted to scalar values are not tracked'] };
  }
  function evaluate(expr: Expr, state: State, ctx: Context): Value {
    if (expired()) return unknown('Callback analysis time budget reached');
    if (++steps > 2_000_000) { notices.add('Callback analysis work limit reached'); return unknown('Callback analysis work limit'); }
    if (expr.kind === 'number') {
      const text = expr.value.replace(/[uUlL]+$/, ''), n = /^0[0-7]+$/.test(text) ? parseInt(text, 8) : Number(text);
      return Number.isFinite(n) ? { ...blank(), numbers: new Set([n]), nil: n === 0 } : unknown('Nonconstant numeric address');
    }
    if (expr.kind === 'name') {
      const values: Value[] = expr.localId ? [expr.localId, ...(expr.alternatives ?? [])].map(id => read(id, state)) : [];
      for (const symbol of !expr.localId || expr.globalFallback ? globalSymbols(expr) : []) {
        if (symbol.kind === 'function') {
          const value = blank(); value.targets.set(symbol.id, [{ location: expr.location, reason: 'Function address: ' + symbol.name }]); values.push(value);
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
      const targets = slots(expr.object, state, ctx);
      publish({ ...blank(), objects: new Set(targets) }, state);
      return { ...blank(), objects: new Set(targets) };
    }
    if (expr.kind === 'cast') return evaluate(expr.object, state, ctx);
    if (expr.kind === 'dereference') {
      const pointer = evaluate(expr.object, state, ctx);
      if (pointer.targets.size) return pointer;
      return union(...[...objects(pointer)].map(slot => read(slot, state)));
    }
    if (expr.kind === 'member' || expr.kind === 'index') return storedValue(expr, union(...slots(expr, state, ctx).map(slot => read(slot, state))), state, ctx);
    if (expr.kind === 'choice') {
      const variants = expr.values.map(value => { const branch = clone(state); return { state: branch, value: evaluate(value, branch, ctx) }; });
      if (variants.length) Object.assign(state, variants.slice(1).reduce((a, b) => joinStates(a, b.state), variants[0].state));
      return union(...variants.map(variant => variant.value));
    }
    if (expr.kind === 'sequence') { let value = blank(); for (const child of expr.values) value = evaluate(child, state, ctx); return value; }
    if (expr.kind === 'assign') {
      const targets = slots(expr.left, state, ctx, true), record = valueType(expr.left, ctx);
      if (expr.right.kind === 'initializer') {
        for (const target of targets) initializer(target, expr.right, record ? index.layout(record) : [], state, ctx);
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
      for (const target of targets) write(target, value, state, ctx, targets.length === 1);
      return value;
    }
    if (expr.kind === 'call') {
      const callee = evaluate(expr.callee, state, ctx), resolved = materialize(callee), args = expr.args.map(arg => evaluate(arg, state, ctx));
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
      let opaque = resolved.unknown || resolved.nil || !resolved.targets.size;
      for (const fn of resolved.targets.keys()) {
        depend(fn);
        const target = summaries.get(fn);
        if (!target) { opaque = true; returns.push(unknown('External function return')); continue; }
        if (target.incomplete) opaque = true;
        args.forEach((arg, n) => {
          if (!parameterLayouts.get(fn)?.[n]?.some(layout => layout.layers.length || layout.fields.length)) return;
          const value = evidence(arg, { location: expr.location, reason: 'Argument ' + (n + 1) + ' to ' + (index.symbol(fn)?.name ?? 'function') }), old = target.params[n];
          target.params[n] = old ? joined(old, value) : value;
          if (!old || signature(old) !== signature(target.params[n])) { changed = true; parameterRevision++; target.version++; }
        });
        returns.push(instantiate(target.returns, fn, args));
        for (const [key, effect] of target.effects) {
          const part = formal(key);
          const keys = part?.fn === fn ? [...(args[part.index]?.objects ?? [])].map(actual => actual + part.suffix) : [key];
          for (const key of keys) {
            if (!effects.has(key) && effects.size >= 256) { opaque = true; state.incomplete = true; notices.add('Callback mutation limit: 256 slots per function; targets may be incomplete'); continue; }
            const value = instantiate(effect.value, fn, args), old = effects.get(key);
            effects.set(key, { value: old ? union(old.value, value) : value, count: (old?.count ?? 0) + 1, definite: (old?.definite ?? true) && effect.definite && keys.length === 1 });
          }
        }
      }
      if (opaque) for (const [n, arg] of args.entries()) for (const root of opaqueRoots(expr.args[n], arg, state, ctx)) {
        heapShape();
        const keys = new Set([root, ...descendants(state.memory, root), ...descendants(heap, root)]);
        for (const key of keys) write(key, unknown('Address passed to an opaque call may be modified'), state, ctx);
      }
      for (const [key, effect] of effects) write(key, effect.value, state, ctx, effect.definite && !opaque && effect.count === resolved.targets.size);
      return returns.length ? union(...returns) : unknown('Unknown function return');
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
        if (!stable) notices.add('Callback loop propagation limit: 4 passes; targets may be incomplete');
        state = combined;
      }
    }
    return state;
  }
  const globalProgram: FlowProgram = { id: 'global', locals: [], params: [], body: [] };
  const persistent = new Map(programs.flatMap(program => program.locals.filter(local => local.persistent).map(local => [local.id, local] as const)));
  const globalContext: Context = { program: globalProgram, locals: persistent, exits: [], returned: blank() };
  for (const file of files) for (const init of file.initializers ?? []) {
    const local = persistent.get(init.id);
    const symbol = index.symbol(init.id) ?? (local && valueType({ kind: 'name', name: local.name, localId: local.id, location: local.location }, globalContext));
    if (symbol) initializer(init.id, init.value, index.layout(symbol), { memory: new Map(), effects: new Map(), alive: true }, globalContext);
  }
  let converged = false;
  for (let round = 0; round < 12; round++) {
    changed = false; observations.clear(); argumentObservations.clear(); steps = 0;
    for (const [id, list] of byFunction) {
      if (expired()) break;
      const exits: State[] = [], target = summaries.get(id)!; let returned = blank();
      const previous = completed.get(id);
      if (previous && previous.params.length === target.params.length && previous.params.every((value, n) => value === target.params[n]) &&
        [...previous.dependencies.heap].every(([key, value]) => heap.get(key) === value) &&
        [...previous.dependencies.functions].every(([fn, version]) => summaries.get(fn)?.version === version) &&
        (previous.dependencies.shape === undefined || previous.dependencies.shape === heap.size)) {
        previous.observations.forEach((value, key) => observations.set(key, value));
        previous.arguments.forEach((value, key) => argumentObservations.set(key, value)); continue;
      }
      const beforeParams = [...target.params];
      dependencies = { heap: new Map(), functions: new Map(), observations: new Set(), arguments: new Set() };
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
      for (const [key, effect] of all?.effects ?? []) {
        if (!target.effects.has(key) && target.effects.size >= 256) {
          if (!target.incomplete) { target.incomplete = true; target.version++; changed = true; }
          notices.add('Callback mutation limit: 256 slots per function; targets may be incomplete'); continue;
        }
        const old = target.effects.get(key), value = old ? joined(old.value, effect.value) : effect.value;
        if (!old || signature(old.value) !== signature(value) || old.definite !== effect.definite) { changed = true; target.version++; }
        target.effects.set(key, { value, definite: effect.definite });
      }
      completed.set(id, { dependencies, params: beforeParams, observations: new Map([...dependencies.observations].map(key => [key, observations.get(key)!])),
        arguments: new Map([...dependencies.arguments].map(key => [key, argumentObservations.get(key)!])) });
      dependencies = undefined;
    }
    if (timedOut) break;
    if (!changed) { converged = true; break; }
  }
  if (!converged && !timedOut) notices.add('Callback propagation limit: 12 project passes; targets may be incomplete');
  for (const observation of argumentObservations.values()) for (const [n, observed] of observation.values) {
    const value = materialize(observed);
    functionArguments.add(observation.call, n, new Map([...value.targets].map(([id, chain]) => [id, frames([...chain, ...value.evidence])])),
      true, value.unknown || value.nil || !converged || notices.size > 0, [...new Set([...value.reasons, ...notices])]);
  }
  const warningFile = files.find(file => file.references.some(ref => ref.kind === 'call'))?.uri;
  const results = files.map(file => {
    let modified = false; const refs: ReferenceRecord[] = [];
    for (const ref of file.references) {
      const observation = ref.kind === 'call' && ref.flowKey ? observations.get(ref.flowKey) : undefined;
      if (!observation) { refs.push(ref); continue; }
      modified = true;
      const value = materialize(observation.value), incomplete = value.unknown || value.nil || !value.targets.size || !converged || notices.size > 0;
      const inference = { expression: observation.expression, evidence: value.evidence, incomplete, reasons: [...new Set([...value.reasons, ...notices, ...(value.nil ? ['Some paths have a null/non-callable value'] : [])])] };
      refs.push({ ...ref, kind: 'reference', indirect: ref.indirect || (observation.kind === 'variable' && index.resolveReference(ref).some(symbol => symbol.kind === 'function')) });
      for (const [targetId, chain] of value.targets) refs.push({
        ...ref, id: ref.id + ':target:' + targetId, name: index.symbol(targetId)?.name ?? ref.name, targetId, indirect: false, callKind: 'inferred',
        inference: { ...inference, evidence: frames([...chain, ...value.evidence]) }
      });
      if (incomplete) refs.push({ ...ref, id: ref.id + ':unknown', targetId: undefined, indirect: true, callKind: 'indirect', unresolvedKind: observation.kind, inference });
    }
    const unique = uniqueCalls(refs);
    const warnings = file.uri === warningFile ? [...notices] : [];
    modified ||= unique.length !== refs.length;
    const argumentsFound = functionArguments.forFile(file.uri);
    if (!modified && !warnings.length && !argumentsFound.length) return file;
    const fingerprint = JSON.stringify([unique.filter(ref => ref.inference).map(ref => [ref.id, ref.name, ref.targetId, ref.callKind, ref.inference]), warnings, argumentsFound]);
    const previous = fileCache.get(file);
    if (previous?.fingerprint === fingerprint) return previous.result;
    const result = { ...file, references: unique, issues: [...file.issues, ...warnings], functionArguments: argumentsFound.length ? argumentsFound : undefined };
    fileCache.set(file, { fingerprint, result }); return result;
  });
  projectCache.set(files[0], { inputs: files, results }); return results;
}
