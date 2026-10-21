import { FileAnalysis, FlowExpression, FlowProgram, GlobalInitializer, Location, MacroDefinition, PreprocessorEvent, ReferenceRecord } from './model';
import { joinTokens, locationIn, tokenizeC } from './c-tokens';
import { MacroExpander, macroMemoryLimit } from './macro-expansion';

type Analyze = (uri: string, text: string, skip?: boolean) => FileAnalysis;
interface Event { offset: number; value: PreprocessorEvent }
interface Cached { raw: FileAnalysis; paths: string; dependencies: Set<FileAnalysis>; result: FileAnalysis; analyzeCallbacks: boolean }
const caches = new WeakMap<Analyze, Map<string, Cached>>();
export function clearMacroCache(analyze: Analyze) { caches.delete(analyze); }
const includeLimit = 'Macro include traversal limit reached; call relationships may be incomplete';
function timeline(file: FileAnalysis, files: Map<string, FileAnalysis>, issues: Set<string>, dependencies: Set<FileAnalysis>, memoryPressure?: () => boolean): Event[] {
  const result: Event[] = [];
  const defined = new Set<string>();
  let visits = 0;
  const byName = new Map<string, string[]>();
  for (const uri of files.keys()) { const name = uri.split('/').pop()!; const list = byName.get(name) ?? []; list.push(uri); byName.set(name, list); }
  function visit(current: FileAnalysis, offset: number | undefined, stack: Set<string>, inherited: string[]) {
    if (issues.has(macroMemoryLimit)) return;
    if ((visits & 255) === 0 && memoryPressure?.()) { issues.add(macroMemoryLimit); return; }
    if (visits > 40_000) return;
    dependencies.add(current);
    if (++visits > 40_000) { issues.add(includeLimit); return; }
    if (current.guard && defined.has(current.guard.name)) return;
    if (stack.has(current.uri)) return;
    if (stack.size >= 64 || result.length >= 40_000) { issues.add('Macro include/event limit reached'); return; }
    const next = new Set(stack).add(current.uri);
    for (const event of current.preprocessor ?? []) {
      if (issues.has(macroMemoryLimit)) break;
      if ((result.length & 255) === 0 && memoryPressure?.()) { issues.add(macroMemoryLimit); break; }
      if (visits > 40_000) break;
      if (result.length >= 40_000) { issues.add('Macro include/event limit reached'); break; }
      const conditions = [...inherited, ...event.conditions.filter(condition => condition !== current.guard?.condition)];
      if (event.kind !== 'include') {
        if (!conditions.length) { if (event.kind === 'define') defined.add(event.macro.name); else defined.delete(event.name); }
        result.push({ offset: offset ?? event.location.start, value: event.kind === 'define'
          ? { ...event, conditions, macro: { ...event.macro, conditions } } : { ...event, conditions } });
        continue;
      }
      const relative = new URL(event.path, current.uri).href;
      const matches = !event.system && files.has(relative) ? [relative] : (byName.get(encodeURIComponent(event.path.split('/').pop()!)) ?? []).filter(uri => decodeURIComponent(uri).endsWith('/' + event.path));
      for (const uri of matches) visit(files.get(uri)!, offset ?? event.location.start, next,
        matches.length > 1 ? [...conditions, `Header candidate: ${uri}`] : conditions);
    }
  }
  visit(file, undefined, new Set(), []);
  return result;
}
function environment(events: Event[]) {
  const definitions = new Map<string, { choices: Map<string, MacroDefinition | undefined>; values?: (MacroDefinition | undefined)[] }>(); let applied = 0;
  return (name: string, offset: number) => {
    let low = 0, high = events.length;
    while (low < high) { const mid = (low + high) >>> 1; if (events[mid].offset <= offset) low = mid + 1; else high = mid; }
    // Argument prescan may move backwards in source without crossing a directive.
    if (low < applied) { definitions.clear(); applied = 0; }
    while (applied < low) {
      const event = events[applied++].value;
      if (event.kind === 'include') continue;
      const value = event.kind === 'define' ? event.macro : undefined;
      const key = event.kind === 'define' ? event.macro.name : event.name;
      let entry = definitions.get(key);
      if (!event.conditions.length || !entry) {
        entry = { choices: new Map(event.conditions.length ? [['undefined', undefined]] : []) };
        definitions.set(key, entry);
      }
      entry.choices.set(value ? `${value.location.uri}#${value.location.start}` : 'undefined', value);
      entry.values = undefined;
    }
    const entry = definitions.get(name);
    return entry ? entry.values ??= [...entry.choices.values()] : [];
  };
}
function activeText(file: FileAnalysis, start: number, end: number) {
  let text = file.text.slice(start, end);
  for (const range of [...(file.inactive ?? []), ...(file.directives ?? [])]) {
    const a = Math.max(0, range.start - start), b = Math.min(text.length, range.end - start);
    if (b > a) text = text.slice(0, a) + text.slice(a, b).replace(/[^\r\n]/g, ' ') + text.slice(b);
  }
  return text;
}

// The analyzer callback uses the already initialized C parser, in the Worker.
export function deriveMacroCalls(raw: FileAnalysis[], analyze: Analyze, parseCalls: (uri: string, text: string, original?: (start: number, end: number) => Location, namespace?: string, context?: (location: Location) => string[]) => { references: ReferenceRecord[]; issues: string[]; programs: FlowProgram[]; initializers: GlobalInitializer[] },
  parseInitializer: (uri: string, text: string, original: (start: number, end: number) => Location) => { value: FlowExpression; issues: string[] }, memoryPressure?: () => boolean, analyzeCallbacks = true): FileAnalysis[] {
  const files = new Map(raw.map(file => [file.uri, file]));
  let cache = caches.get(analyze); if (!cache) caches.set(analyze, cache = new Map());
  for (const uri of cache.keys()) if (!files.has(uri)) cache.delete(uri);
  const paths = raw.map(file => file.uri).join('\n');
  return raw.map(file => {
    if (file.expandMacros === false) { cache!.delete(file.uri); return file; }
    if (!file.functions?.length && !file.initializers?.length) { cache!.delete(file.uri); return file; }
    const previous = cache!.get(file.uri);
    if (previous?.raw === file && previous.analyzeCallbacks === analyzeCallbacks && previous.paths === paths && [...previous.dependencies].every(dep => files.get(dep.uri) === dep) &&
      (!previous.result.issues.includes(macroMemoryLimit) || memoryPressure?.())) return previous.result;
    const dependencies = new Set<FileAnalysis>();
    const issues = new Set<string>();
    const partial = (reason: string) => {
      issues.add(reason);
      // A prefix cannot establish the active macro environment. Retain source
      // calls as partial candidates. Raw flow is only for literal arguments.
      const result: FileAnalysis = { ...file, programs: [], initializers: [], argumentPrograms: file.programs,
        references: file.references.map(ref => ref.kind === 'call' ? { ...ref,
          inference: { expression: ref.name, evidence: [], incomplete: true, reasons: [reason] } } : ref),
        issues: [...file.issues, ...issues] };
      cache!.set(file.uri, { raw: file, paths, dependencies, result, analyzeCallbacks }); return result;
    };
    if (memoryPressure?.()) return partial(macroMemoryLimit);
    const events = timeline(file, files, issues, dependencies, memoryPressure);
    if (issues.has(macroMemoryLimit)) return partial(macroMemoryLimit);
    if (issues.has(includeLimit)) return partial(includeLimit);
    const lookup = environment(events);
    const sourceLocation = locationIn(file.text, file.uri);
    const macroIds = (name: string, offset: number) => lookup(name, offset).filter((m): m is MacroDefinition => !!m).map(m => `${m.location.uri}#${m.location.start}`);
    let references = file.references.map(ref => {
      const ids = macroIds(ref.name, ref.location.start);
      return ids.length ? { ...ref, macroIds: ids } : ref;
    });
    if (!events.some(event => event.value.kind === 'define')) {
      const result = { ...file, projectScoped: true };
      cache!.set(file.uri, { raw: file, paths, dependencies, result, analyzeCallbacks }); return result;
    }
    // Initializer values feed callback propagation, not ordinary references or
    // literal function arguments. Keep raw facts intact for later re-enabling.
    let initializers = (analyzeCallbacks ? file.initializers ?? [] : []).map(init => {
      if (memoryPressure?.()) { issues.add(macroMemoryLimit); return init; }
      const tokens = tokenizeC(file.text.slice(init.location.start, init.location.end), (start, end) => sourceLocation(init.location.start + start, init.location.start + end));
      const expander = new MacroExpander(lookup, memoryPressure), variants = expander.expand(tokens);
      expander.issues.forEach(issue => issues.add(issue));
      if (issues.has(macroMemoryLimit)) return init;
      if (!variants.some(variant => variant.changed)) return init;
      const values = variants.map(variant => {
        if (memoryPressure?.()) { issues.add(macroMemoryLimit); return init.value; }
        const offsets: number[] = []; let length = 0;
        for (const token of variant.tokens) { offsets.push(length); length += token.text.length + 1; }
        const original = (start: number, end: number): Location => {
          const pick = (position: number) => { let low = 0, high = offsets.length; while (low + 1 < high) { const mid = (low + high) >>> 1; if (offsets[mid] <= position) low = mid; else high = mid; } return variant.tokens[low]?.location ?? init.location; };
          const a = pick(start), b = pick(Math.max(start, end - 1));
          return { ...a, end: Math.max(a.end, b.end), endLine: b.endLine, endColumn: b.endColumn };
        };
        const parsed = parseInitializer(file.uri, joinTokens(variant.tokens), original);
        if (parsed.issues.length) issues.add('Macro-expanded initializer near line ' + (init.location.line + 1) + ' has unsupported syntax');
        return parsed.value;
      });
      const value: FlowExpression = values.length === 1 ? values[0] : { kind: 'choice', values, location: init.location };
      return { ...init, value };
    });
    if (issues.has(macroMemoryLimit)) return partial(macroMemoryLimit);
    const sourceConditions = new Map([...file.symbols.map(symbol => [symbol.location.start, symbol.conditions] as const), ...file.references.map(ref => [ref.location.start, ref.conditions] as const),
      ...(file.statementConditions ?? []).map(statement => [statement.start, statement.conditions] as const)]);
    let programs = file.programs ?? [];
    for (const fn of file.functions ?? []) {
      if (memoryPressure?.()) return partial(macroMemoryLimit);
      const tokens = tokenizeC(activeText(file, fn.body.start, fn.body.end), (start, end) => sourceLocation(fn.body.start + start, fn.body.start + end));
      const expander = new MacroExpander(lookup, memoryPressure), variants = expander.expand(tokens);
      expander.issues.forEach(issue => issues.add(issue));
      if (issues.has(macroMemoryLimit)) return partial(macroMemoryLimit);
      if (!variants.some(variant => variant.changed)) continue;
      const calls: ReferenceRecord[] = [], seen = new Set<string>();
      const generatedPrograms: FlowProgram[] = [];
      const generatedInitializers: GlobalInitializer[] = [];
      const parsedVariants = new Map<string, ReturnType<typeof parseCalls>>();
      for (const [variantIndex, variant] of variants.entries()) {
        if (memoryPressure?.()) return partial(macroMemoryLimit);
        const prefix = file.text.slice(fn.location.start, fn.body.start);
        const offsets: number[] = []; let length = prefix.length;
        for (const token of variant.tokens) { offsets.push(length); length += token.text.length + 1; }
        const previews = new Map<number, string[]>();
        const expansions = new Map<string, NonNullable<ReferenceRecord['expansion']>>();
        for (const token of variant.tokens) if (token.invocation) {
          const parts = previews.get(token.invocation.start) ?? []; parts.push(token.text); previews.set(token.invocation.start, parts);
        }
        const origin = (position: number) => {
          let low = 0, high = offsets.length;
          while (low + 1 < high) { const mid = (low + high) >>> 1; if (offsets[mid] <= position) low = mid; else high = mid; }
          return position >= prefix.length ? variant.tokens[low] : undefined;
        };
        const mapLocation = (start: number, end: number): Location => {
          const first = origin(start), last = origin(Math.max(start, end - 1));
          if (!first) return sourceLocation(fn.location.start + start, fn.location.start + end);
          const finish = last?.location ?? first.location;
          return { ...first.location, end: Math.max(first.location.end, finish.end), endLine: finish.endLine, endColumn: finish.endColumn };
        };
        const code = prefix + joinTokens(variant.tokens);
        const syntaxKey = code + '\n' + variant.tokens.map(token => token.location.start + ':' + token.location.end).join(',');
        let generated = parsedVariants.get(syntaxKey);
        if (!generated) {
          generated = parseCalls(file.uri, code, mapLocation, `:variant:${variantIndex}`, location => sourceConditions.get(location.start) ?? []);
          parsedVariants.set(syntaxKey, generated);
          generatedPrograms.push(...generated.programs);
          if (analyzeCallbacks) generatedInitializers.push(...generated.initializers);
        }
        if (generated.issues.length) issues.add(`Macro expansion near line ${fn.body.line + 1}: generated C has incomplete or unsupported syntax`);
        for (const ref of generated.references) {
          if (ref.kind !== 'call' || !ref.access) continue;
          const token = origin(ref.location.start); if (!token) continue;
          const chain = token.chain ?? [];
          const conditions = [...new Set([...variant.conditions, ...(sourceConditions.get(token.location.start) ?? [])])];
          const key = `${ref.name}:${token.location.start}:${ref.location.start}:${chain.map(frame => frame.name).join('/')}:${ref.flowKey}`;
          if (seen.has(key)) continue; seen.add(key);
          let expansion: ReferenceRecord['expansion'];
          if (chain.length) {
            const expansionKey = `${token.invocation?.start}:${chain.map(frame => `${frame.location.uri}#${frame.location.start}`).join('/')}`;
            expansion = expansions.get(expansionKey);
            if (!expansion) {
              expansion = { chain, text: (previews.get(token.invocation!.start) ?? []).join(' ').slice(0, 4000) };
              expansions.set(expansionKey, expansion);
            }
          }
          calls.push({ ...ref, id: `${file.uri}@${token.location.start}:expanded:${calls.length}:${fn.id}`, location: chain.length ? token.location : mapLocation(ref.location.start, ref.location.end),
            ownerId: fn.id, functionId: fn.id, conditions, callKind: chain.length ? 'expanded' : undefined,
            expansion, macroIds: token.unexpanded ? macroIds(ref.name, token.location.start) : [] });
        }
      }
      programs = programs.filter(program => program.id !== fn.id).concat(generatedPrograms);
      initializers = initializers.filter(init => !init.id.startsWith(fn.id + ':static:')).concat(generatedInitializers);
      // Retain source-level macro/address references, but replace effective calls.
      const replaced = new Set(calls.map(ref => `${ref.name}:${ref.location.start}`));
      references = references.flatMap(ref => ref.functionId === fn.id && ref.kind === 'call'
        ? replaced.has(`${ref.name}:${ref.location.start}`) && !ref.macroIds?.length ? [] : [{ ...ref, kind: 'reference' as const }] : [ref]).concat(calls);
    }
    const result = { ...file, programs, initializers, projectScoped: true, references, issues: [...file.issues, ...issues] };
    cache!.set(file.uri, { raw: file, paths, dependencies, result, analyzeCallbacks }); return result;
  });
}
