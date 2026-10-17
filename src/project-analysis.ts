import { FileAnalysis, MacroDefinition, PreprocessorEvent, ReferenceRecord } from './model';
import { joinTokens, locationIn, tokenizeC } from './c-tokens';
import { MacroExpander } from './macro-expansion';

type Analyze = (uri: string, text: string, skip?: boolean) => FileAnalysis;
interface Event { offset: number; value: PreprocessorEvent }
interface Cached { raw: FileAnalysis; paths: string; dependencies: Set<FileAnalysis>; result: FileAnalysis }
const caches = new WeakMap<Analyze, Map<string, Cached>>();
function timeline(file: FileAnalysis, files: Map<string, FileAnalysis>, issues: Set<string>, dependencies: Set<FileAnalysis>): Event[] {
  const result: Event[] = [];
  const defined = new Set<string>();
  const byName = new Map<string, string[]>();
  for (const uri of files.keys()) { const name = uri.split('/').pop()!; const list = byName.get(name) ?? []; list.push(uri); byName.set(name, list); }
  function visit(current: FileAnalysis, offset: number | undefined, stack: Set<string>, inherited: string[]) {
    dependencies.add(current);
    if (current.guard && defined.has(current.guard.name)) return;
    if (stack.has(current.uri)) return;
    if (stack.size >= 64 || result.length >= 40_000) { issues.add('Macro include/event limit reached'); return; }
    const next = new Set(stack).add(current.uri);
    for (const event of current.preprocessor ?? []) {
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
export function deriveMacroCalls(raw: FileAnalysis[], analyze: Analyze, parseCalls: (uri: string, text: string) => { references: ReferenceRecord[]; issues: string[] }): FileAnalysis[] {
  const files = new Map(raw.map(file => [file.uri, file]));
  let cache = caches.get(analyze); if (!cache) caches.set(analyze, cache = new Map());
  for (const uri of cache.keys()) if (!files.has(uri)) cache.delete(uri);
  const paths = raw.map(file => file.uri).join('\n');
  return raw.map(file => {
    if (!file.functions?.length) return file;
    const previous = cache!.get(file.uri);
    if (previous?.raw === file && previous.paths === paths && [...previous.dependencies].every(dep => files.get(dep.uri) === dep)) return previous.result;
    const dependencies = new Set<FileAnalysis>();
    const issues = new Set<string>(); const events = timeline(file, files, issues, dependencies);
    const lookup = environment(events);
    const macroIds = (name: string, offset: number) => lookup(name, offset).filter((m): m is MacroDefinition => !!m).map(m => `${m.location.uri}#${m.location.start}`);
    let references = file.references.map(ref => {
      const ids = macroIds(ref.name, ref.location.start);
      return ids.length ? { ...ref, macroIds: ids } : ref;
    });
    if (!events.some(event => event.value.kind === 'define')) {
      const result = { ...file, projectScoped: true };
      cache!.set(file.uri, { raw: file, paths, dependencies, result }); return result;
    }
    const sourceConditions = new Map(file.references.map(ref => [ref.location.start, ref.conditions]));
    for (const fn of file.functions) {
      const tokens = tokenizeC(activeText(file, fn.body.start, fn.body.end), locationIn(file.text, file.uri, fn.body.start));
      const expander = new MacroExpander(lookup), variants = expander.expand(tokens);
      expander.issues.forEach(issue => issues.add(issue));
      if (!variants.some(variant => variant.changed)) continue;
      const calls: ReferenceRecord[] = [], seen = new Set<string>();
      for (const variant of variants) {
        const prefix = file.text.slice(fn.location.start, fn.body.start);
        const offsets: number[] = []; let length = prefix.length;
        for (const token of variant.tokens) { offsets.push(length); length += token.text.length + 1; }
        const generated = parseCalls(file.uri, prefix + joinTokens(variant.tokens));
        const previews = new Map<number, string[]>();
        const expansions = new Map<string, NonNullable<ReferenceRecord['expansion']>>();
        for (const token of variant.tokens) if (token.invocation) {
          const parts = previews.get(token.invocation.start) ?? []; parts.push(token.text); previews.set(token.invocation.start, parts);
        }
        if (generated.issues.length) issues.add(`Macro expansion near line ${fn.body.line + 1}: generated C has incomplete or unsupported syntax`);
        const origin = (position: number) => {
          let low = 0, high = offsets.length;
          while (low + 1 < high) { const mid = (low + high) >>> 1; if (offsets[mid] <= position) low = mid; else high = mid; }
          return position >= prefix.length ? variant.tokens[low] : undefined;
        };
        for (const ref of generated.references) {
          if (ref.kind !== 'call' || !ref.access) continue;
          const token = origin(ref.location.start); if (!token) continue;
          const chain = token.chain ?? [];
          const conditions = [...new Set([...variant.conditions, ...(sourceConditions.get(token.location.start) ?? [])])];
          const key = `${ref.name}:${token.location.start}:${ref.location.start}:${chain.map(frame => frame.name).join('/')}`;
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
          calls.push({ ...ref, id: `${file.uri}@${token.location.start}:expanded:${calls.length}:${fn.id}`, location: token.location,
            ownerId: fn.id, functionId: fn.id, conditions, callKind: chain.length ? 'expanded' : undefined,
            expansion, macroIds: token.unexpanded ? macroIds(ref.name, token.location.start) : [] });
        }
      }
      // Retain source-level macro/address references, but replace effective calls.
      const replaced = new Set(calls.map(ref => `${ref.name}:${ref.location.start}`));
      references = references.flatMap(ref => ref.functionId === fn.id && ref.kind === 'call'
        ? replaced.has(`${ref.name}:${ref.location.start}`) && !ref.macroIds?.length ? [] : [{ ...ref, kind: 'reference' as const }] : [ref]).concat(calls);
    }
    const result = { ...file, projectScoped: true, references, issues: [...file.issues, ...issues] };
    cache!.set(file.uri, { raw: file, paths, dependencies, result }); return result;
  });
}
