import { AnalysisWorkBudget } from './analysis-budget';
import { FileAnalysis, FlowExpression, FlowProgram, GlobalInitializer, Location, MacroBranch, PreprocessorEvent, ReferenceRecord, fileKey, locationKey } from './model';
import { identifier, joinTokens, locationIn, tokenizeC } from './c-tokens';
import { MacroChoice, MacroExpander, macroMemoryLimit } from './macro-expansion';
import { combineBranches, outsideBranches } from './preprocessor-branches';

type Analyze = (uri: string, text: string, skip?: boolean) => FileAnalysis;
interface Event { offset: number; value: PreprocessorEvent }
interface IncludeSummary { files: FileAnalysis[]; events: PreprocessorEvent[]; opaque?: boolean }
interface Cached { raw: FileAnalysis; paths: string; dependencies: Set<FileAnalysis>; result: FileAnalysis; analyzeCallbacks: boolean }
const caches = new WeakMap<Analyze, Map<string, Cached>>();
const bindingCaches = new WeakMap<Analyze, Map<string, { raw: FileAnalysis; names: string; paths: string; dependencies: Set<FileAnalysis>; result: FileAnalysis }>>();
export function clearMacroCache(analyze: Analyze) { caches.delete(analyze); bindingCaches.delete(analyze); }
const includeLimit = 'Macro include traversal limit reached; call relationships may be incomplete';
const macroCancelled = 'Macro analysis cancelled; call relationships may be incomplete.';
const macroWorkLimit = 'Macro analysis work limit reached; some calls remain unexpanded';
const unknownInclude = 'Macro definition lookup includes unavailable or opaque headers';
function timeline(file: FileAnalysis, files: Map<string, FileAnalysis>, issues: Set<string>, dependencies: Set<FileAnalysis>, memoryPressure?: () => boolean, shouldCancel?: () => boolean, referenceNames?: Set<string>, summaries?: Map<string, IncludeSummary>): Event[] {
  if (file.context) { dependencies.add(file); return file.context.prepared.timeline; }
  const result: Event[] = [];
  const defined = new Set<string>();
  const uncertainGuards = new Set<string>();
  const bindings = new Map<string, {version: number; dependencies: Set<string>; opaque: boolean}>(), equivalent = new Map<string, string>(), opaqueFiles = new Map<FileAnalysis, boolean>();
  let bindingVersion = 0, branchId = 0, opaqueEnvironment = false;
  function identity(branch: MacroBranch, identities: Map<string, string>) {
    const previous = identities.get(branch.key);
    if (previous) return previous;
    const local = () => `branch:${++branchId}`;
    if (opaqueEnvironment || referenceNames) { const key = local(); identities.set(branch.key, key); return key; }
    const text = branch.condition.replace(/^else of /, '').replace(/^#\s*elif/, '#if');
    const tokens = tokenizeC(text, locationIn(text, '')), names = [...new Set(tokens.slice(2).filter(token => identifier.test(token.text)).map(token => token.text))];
    // Repeated alias conditions share a choice only while every transitive
    // definition is unchanged. Pasting and dynamic builtins remain opaque.
    const dependencies = new Set(names);
    let opaque = false;
    for (const name of dependencies) {
      const binding = bindings.get(name);
      if (dependencies.size > 256 || name.startsWith('__') || binding?.opaque) { opaque = true; break; }
      for (const dependency of binding?.dependencies ?? []) {
        dependencies.add(dependency);
        if (dependencies.size > 256) { opaque = true; break; }
      }
      if (opaque) break;
    }
    const signature = opaque ? undefined : JSON.stringify([tokens.map(token => token.text), [...dependencies].sort().map(name => [name, bindings.get(name)?.version ?? 0])]);
    const key = signature === undefined ? local() : equivalent.get(signature) ?? local();
    if (signature !== undefined) equivalent.set(signature, key);
    identities.set(branch.key, key); return key;
  }
  let visits = 0;
  let definitionRevision = 0;
  const lastDefinitions = new Map<string, string>(), completedIncludes = new Map<string, number>();
  const byName = new Map<string, string[]>();
  const guards = referenceNames && new Set([...files.values()].flatMap(file => file.guard ? [file.guard.name] : []));
  for (const uri of files.keys()) { const name = uri.split('/').pop()!; const list = byName.get(name) ?? []; list.push(uri); byName.set(name, list); }
  function includeMatches(current: FileAnalysis, event: Extract<PreprocessorEvent,{kind:'include'}>) {
    const relative = new URL(event.path, current.uri).href;
    return !event.system && files.has(relative) ? [relative] : (byName.get(encodeURIComponent(event.path.split('/').pop()!)) ?? []).filter(uri => decodeURIComponent(uri).endsWith('/' + event.path));
  }
  function visit(current: FileAnalysis, offset: number | undefined, stack: Set<string>, inherited: string[], inheritedBranches: MacroBranch[] = []) {
    if (shouldCancel?.()) { issues.add(macroCancelled); return; }
    if (issues.has(macroMemoryLimit)) return;
    if ((visits & 255) === 0 && memoryPressure?.()) { issues.add(macroMemoryLimit); return; }
    if (visits > 40_000) return;
    dependencies.add(current);
    const includeKey = referenceNames ? current.uri + '\n' + inherited.join('\n') : undefined;
    // Basic binding needs definition identities, not repeated token streams.
    // Reuse an include only in the same conditional context and while tracked
    // definitions/guards have not changed. Full expansion keeps its own walk.
    if (includeKey && completedIncludes.get(includeKey) === definitionRevision) return;
    if (++visits > 40_000) { issues.add(includeLimit); return; }
    const visitId = String(visits), identities = new Map<string, string>();
    if (current.guard && defined.has(current.guard.name)) return;
    const optionalGuard = referenceNames && current.guard && uncertainGuards.has(current.guard.name) ? current.guard : undefined;
    if (stack.has(current.uri)) return;
    if (stack.size >= 64 || result.length >= 40_000) { issues.add('Macro include/event limit reached'); return; }
    if (!opaqueFiles.has(current)) opaqueFiles.set(current, /^[\t ]*#[\t ]*(?:pragma[\t ]+(?:push_macro|pop_macro)|include_next)\b/m.test(current.text));
    if (opaqueFiles.get(current)) { opaqueEnvironment = true; if (referenceNames) issues.add(unknownInclude); }
    const next = new Set(stack).add(current.uri);
    for (const event of current.preprocessor ?? []) {
      if (shouldCancel?.()) { issues.add(macroCancelled); break; }
      if (issues.has(macroMemoryLimit)) break;
      if ((result.length & 255) === 0 && memoryPressure?.()) { issues.add(macroMemoryLimit); break; }
      if (visits > 40_000) break;
      if (result.length >= 40_000) { issues.add('Macro include/event limit reached'); break; }
      const name = event.kind === 'define' ? event.macro.name : event.kind === 'undef' ? event.name : undefined;
      if (referenceNames && name && !referenceNames.has(name) && !guards!.has(name)) continue;
      const conditions = [...inherited, ...(optionalGuard ? [optionalGuard.condition] : []), ...event.conditions.filter(condition => condition !== current.guard?.condition)];
      const branches = combineBranches(inheritedBranches, [...(optionalGuard ? [{key:`${visitId}:guard`,value:true,condition:optionalGuard.condition}] : []), ...(event.branches ?? []).filter(branch => branch.condition !== current.guard?.condition).map(branch => ({...branch, key: identity(branch, identities)}))]);
      if (!branches) continue;
      if (event.kind !== 'include') {
        if (referenceNames) {
          const identity = `${current.uri}:${event.location.start}:${event.kind}:${conditions.join('|')}`;
          if (lastDefinitions.get(name!) !== identity) { lastDefinitions.set(name!, identity); definitionRevision++; }
        }
        if (!opaqueEnvironment && !referenceNames) {
          const name = event.kind === 'define' ? event.macro.name : event.name;
          const tokens = event.kind === 'define' ? tokenizeC(event.macro.body, () => event.location) : [];
          const parameters = event.kind === 'define' ? new Set([...(event.macro.parameters ?? []), event.macro.variadic]) : new Set();
          const dependencies = new Set(tokens.filter(token => identifier.test(token.text) && !parameters.has(token.text)).map(token => token.text));
          const previous = branches.length ? bindings.get(name) : undefined;
          previous?.dependencies.forEach(dependency => dependencies.add(dependency));
          bindings.set(name, {version: ++bindingVersion, dependencies, opaque: tokens.some(token => token.text === '#' || token.text === '##') || previous?.opaque === true});
        }
        if (!conditions.length) { if (event.kind === 'define') defined.add(event.macro.name); else defined.delete(event.name); uncertainGuards.delete(name!); }
        else if (referenceNames && guards!.has(name!) && (event.kind === 'undef' ? defined.has(name!) : !defined.has(name!))) {
          defined.delete(name!); uncertainGuards.add(name!);
        }
        if (referenceNames && !referenceNames.has(name!)) continue;
        result.push({ offset: offset ?? event.location.start, value: event.kind === 'define'
          ? { ...event, conditions, branches, macro: { ...event.macro, conditions, branches } } : { ...event, conditions, branches } });
        continue;
      }
      const matches = includeMatches(current, event);
      if (!matches.length) {
        opaqueEnvironment = true;
        if (referenceNames) {
          for (const name of referenceNames) if (lastDefinitions.get(name) !== 'unknown') { lastDefinitions.set(name, 'unknown'); definitionRevision++; }
          result.push({offset:offset??event.location.start,value:{...event,conditions,branches:[...branches,{key:`${visitId}:missing:${event.location.start}`,value:true,condition:`Unknown header: ${event.path}`} ]}});
        }
      }
      if (referenceNames && matches.length > 1) {
        const key = matches.join('\n'); let summary = summaries?.get(key);
        if (!summary) {
          summary = {files:[],events:[]}; const pending=[...matches], seen=new Set(matches);
          for(let n=0;n<pending.length;n++){
            if(shouldCancel?.()) {issues.add(macroCancelled);break;}
            if(memoryPressure?.()) {issues.add(macroMemoryLimit);break;}
            const uri=pending[n];
            const header=files.get(uri)!;summary.files.push(header);
            if(/^[\t ]*#[\t ]*(?:pragma[\t ]+(?:push_macro|pop_macro)|include_next)\b/m.test(header.text))summary.opaque=true;
            for(const directive of header.preprocessor??[]){
              if(directive.kind!=='include')summary.events.push(directive);
              else {const targets=includeMatches(header,directive);if(targets.length){for(const target of targets)if(!seen.has(target)){seen.add(target);pending.push(target);}}else summary.events.push(directive);}
            }
          }
          if(!shouldCancel?.()&&!issues.has(macroMemoryLimit))summaries?.set(key,summary);
        }
        summary.files.forEach(header=>dependencies.add(header));
        if(summary.opaque)issues.add(unknownInclude);
        // Header search paths are unknown. A basic lookup joins possible
        // definitions once; it does not enumerate whole preprocessor worlds.
        for(const directive of summary.events){
          const name=directive.kind==='define'?directive.macro.name:directive.kind==='undef'?directive.name:undefined;
          if(name&&guards!.has(name)){defined.delete(name);uncertainGuards.add(name);}
          if(name&&!referenceNames.has(name))continue;
          const condition=`Header candidates for ${event.path}`;
          const selected=[...branches,{key:`${visitId}:candidates:${event.location.start}`,value:true,condition}];
          const conditionsWithHeader=[...conditions,condition,...directive.conditions];
          result.push({offset:offset??event.location.start,value:directive.kind==='define'
            ? {...directive,conditions:conditionsWithHeader,branches:selected,macro:{...directive.macro,conditions:conditionsWithHeader,branches:selected}}
            : {...directive,conditions:conditionsWithHeader,branches:directive.kind==='include'?[...selected,{key:`${visitId}:unknown:${directive.location.uri}:${directive.location.start}`,value:true,condition:`Unknown header: ${directive.path}`}]:selected}});
        }
        definitionRevision++; continue;
      }
      for (const [candidate, uri] of matches.entries()) {
        const selected = [...branches];
        // A balanced choice tree keeps one exclusive header path logarithmic
        // even when a source folder contains many platform implementations.
        for (let start = 0, end = matches.length; end - start > 1;) {
          const middle = (start + end) >>> 1, value = candidate < middle;
          selected.push({key: `${visitId}:include:${event.location.start}:${start}:${end}`, value,
            condition: `Header candidates for ${event.path}: ${value ? start + 1 : middle + 1}..${value ? middle : end}`});
          if (value) end = middle; else start = middle;
        }
        visit(files.get(uri)!, offset ?? event.location.start, next, matches.length > 1 ? [...conditions, `Header candidate: ${uri}`] : conditions, selected);
      }
    }
    if (includeKey) completedIncludes.set(includeKey, definitionRevision);
  }
  visit(file, undefined, new Set(), []);
  return result;
}
function environment(events: Event[], issues: Set<string>, bindingsOnly = false) {
  const definitions = new Map<string, {events: Event[]; choices: MacroChoice[]; applied: number; merged?: boolean}>(), unknown: Event[] = [];
  for (const event of events) {
    if (event.value.kind === 'include') { unknown.push(event); continue; }
    const name = event.value.kind === 'define' ? event.value.macro.name : event.value.name;
    let entry = definitions.get(name);
    if (!entry) { entry = {events: [], choices: [], applied: 0}; definitions.set(name, entry); }
    entry.events.push(event);
  }
  const order = unknown.length ? new Map(events.map((event,n)=>[event,n])) : undefined;
  return (name: string, offset: number) => {
    let entry = definitions.get(name);
    if (!entry) { if (!unknown.length) return []; entry={events:[],choices:[],applied:0};definitions.set(name,entry); }
    if (order && !entry.merged) { entry.events=[...entry.events,...unknown].sort((a,b)=>order.get(a)!-order.get(b)!);entry.merged=true; }
    let low = 0, high = entry.events.length;
    while (low < high) { const mid = (low + high) >>> 1; if (entry.events[mid].offset <= offset) low = mid + 1; else high = mid; }
    // Argument prescan may move backwards in source without crossing a directive.
    if (low < entry.applied) { entry.choices = []; entry.applied = 0; }
    while (entry.applied < low) {
      const event = entry.events[entry.applied++].value;
      const branches = event.branches ?? [];
      const previous = entry.choices.length ? entry.choices : [{branches: []}];
      if (bindingsOnly) {
        const macro = event.kind === 'define' ? event.macro : undefined;
        // Basic navigation needs possible definition identities, not every
        // boolean environment. Conditional writes conservatively join;
        // unconditional define/undef replaces the previous binding.
        const same = previous.findIndex(choice => choice.macro?.location.uri === macro?.location.uri && choice.macro?.location.start === macro?.location.start);
        entry.choices = !branches.length ? [{macro,branches}] : same < 0 ? [...previous,{macro,branches}]
          : event.kind === 'include' ? previous.map((choice,n)=>n===same?{macro,branches}:choice) : previous;
        continue;
      }
      const choices: MacroChoice[] = [{macro: event.kind === 'define' ? event.macro : undefined, branches},
        ...previous.flatMap(choice => outsideBranches(choice.branches, branches).map(branches => ({...choice, branches})))];
      if (choices.length > 32) {
        issues.add('Macro environment alternative limit: 32 candidates');
        choices.splice(31, choices.length - 31, {branches: []});
      }
      entry.choices = choices;
    }
    return entry.choices;
  };
}
export function bindMacroReferences(raw: FileAnalysis[], owner: Analyze, shouldCancel?: () => boolean, memoryPressure?: () => boolean): FileAnalysis[] {
  const files = new Map(raw.map(file => [fileKey(file), file])), definitions = new Map<string, string[]>();
  for (const file of raw) for (const symbol of file.symbols) if (symbol.kind === 'macro') {
    const ids=definitions.get(symbol.name)??[];ids.push(symbol.id);definitions.set(symbol.name,ids);
  }
  const names = new Set(definitions.keys());
  const nameKey = [...names].sort().join('\n'), paths = raw.map(file => fileKey(file)).join('\n');
  const summaries = new Map<string, IncludeSummary>();
  let cache = bindingCaches.get(owner); if (!cache) bindingCaches.set(owner, cache = new Map());
  for (const uri of cache.keys()) if (!files.has(uri)) cache.delete(uri);
  return raw.map(file => {
    const previous = cache!.get(fileKey(file));
    if (previous && previous.raw.symbols !== file.symbols) cache!.delete(fileKey(file));
    if (file.projectScoped || shouldCancel?.() || memoryPressure?.()) return file;
    if (!file.references.some(ref => ref.kind !== 'declaration' && !ref.indirect && !ref.member && !ref.targetId)) { cache!.delete(fileKey(file)); return file; }
    if (previous?.raw === file && previous.names === nameKey && previous.paths === paths && [...previous.dependencies].every(dep => files.get(fileKey(dep)) === dep)) return previous.result;
    const wanted = new Set(file.references.filter(ref => ref.kind !== 'declaration' && !ref.indirect && !ref.member && !ref.targetId && names.has(ref.name)).map(ref => ref.name));
    const issues = new Set<string>(), dependencies = new Set<FileAnalysis>([file]);
    const events = wanted.size ? timeline(file, files, issues, dependencies, memoryPressure, shouldCancel, wanted, summaries) : [];
    if (shouldCancel?.() || issues.has(macroMemoryLimit)) return file;
    const lookup = environment(events, issues, true);
    const references = file.references.map(ref => {
      if (!wanted.has(ref.name) || ref.kind === 'declaration' || ref.indirect || ref.member || ref.targetId) return ref;
      const choices = lookup(ref.name, ref.location.start), incomplete = issues.size > 0 || choices.some(choice=>choice.branches.some(branch=>branch.condition.includes('Unknown header:')));
      const macroIds = incomplete && !file.context ? definitions.get(ref.name)! : [...new Set(choices.flatMap(choice => choice.macro ? [`${locationKey(choice.macro.location)}#${choice.macro.location.start}`] : []))];
      return { ...ref, macroIds, macroUncertain: incomplete || (macroIds.length > 0 && choices.some(choice => !choice.macro)) };
    });
    const result = { ...file, references, projectScoped: true, issues: [...file.issues, ...[...issues].filter(issue => issue !== unknownInclude)
      .map(issue => issue.replace(/^Macro include/, 'Macro definition lookup'))] };
    cache!.set(fileKey(file), { raw: file, names: nameKey, paths, dependencies, result }); return result;
  });
}
function activeText(file: FileAnalysis, start: number, end: number) {
  let text = (file.context?.prepared.maskedText ?? file.text).slice(start, end);
  const directives = file.splitStatements?.length ? file.directives?.filter(range => !file.splitStatements!.some(group => range.start >= group.start && range.start < group.end)) : file.directives;
  for (const range of [...(file.inactive ?? []), ...(directives ?? [])]) {
    const a = Math.max(0, range.start - start), b = Math.min(text.length, range.end - start);
    if (b > a) text = text.slice(0, a) + text.slice(a, b).replace(/[^\r\n]/g, ' ') + text.slice(b);
  }
  return text;
}

// Flow facts are immutable. Share only structurally identical subtrees; numeric
// choices, locations, variant call keys and local IDs remain part of identity.
function sharedFlowStructure() {
  const entries = new Map<string, { value: object; id: number }>(), known = new WeakMap<object, { value: object; id: number }>();
  let nextId = 0;
  function share<T>(value: T): T {
    if (!value || typeof value !== 'object') return value;
    const previous = known.get(value); if (previous) return previous.value as T;
    let changed = false;
    const fields = Object.entries(value).map(([key, part]) => { const shared = share(part); changed ||= shared !== part; return [key, shared] as const; });
    const key = JSON.stringify([Array.isArray(value), fields.map(([name, part]) => [name,
      part && typeof part === 'object' ? { id: known.get(part)!.id } : part])]);
    let entry = entries.get(key);
    if (!entry) {
      entry = { value: changed ? Array.isArray(value) ? fields.map(([, part]) => part) : Object.fromEntries(fields) : value, id: ++nextId };
      entries.set(key, entry); known.set(entry.value, entry);
    }
    known.set(value, entry); return entry.value as T;
  }
  return share;
}

// The analyzer callback uses the already initialized C parser, in the Worker.
export function deriveMacroCalls(raw: FileAnalysis[], analyze: Analyze, parseCalls: (uri: string, text: string, original?: (start: number, end: number) => Location, namespace?: string, context?: (location: Location) => string[]) => { references: ReferenceRecord[]; issues: string[]; programs: FlowProgram[]; initializers: GlobalInitializer[] },
  parseInitializer: (uri: string, text: string, original: (start: number, end: number) => Location, context?: (location: Location) => string[]) => { value: FlowExpression; issues: string[] }, memoryPressure?: () => boolean, analyzeCallbacks = true, shouldCancel?: () => boolean, budget?: AnalysisWorkBudget): FileAnalysis[] {
  const files = new Map(raw.map(file => [fileKey(file), file]));
  let cache = caches.get(analyze); if (!cache) caches.set(analyze, cache = new Map());
  for (const uri of cache.keys()) if (!files.has(uri)) cache.delete(uri);
  const paths = raw.map(file => fileKey(file)).join('\n');
  return raw.map(file => {
    if (file.expandMacros === false) { cache!.delete(fileKey(file)); return file; }
    if (!file.functions?.length && !file.initializers?.length) { cache!.delete(fileKey(file)); return file; }
    const previous = cache!.get(fileKey(file));
    if (!shouldCancel?.() && previous?.raw === file && !previous.result.issues.some(issue=>/work limit|cancelled/i.test(issue)) && previous.analyzeCallbacks === analyzeCallbacks && previous.paths === paths && [...previous.dependencies].every(dep => files.get(fileKey(dep)) === dep) &&
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
      if (reason === macroCancelled) cache!.delete(fileKey(file));
      else cache!.set(fileKey(file), { raw: file, paths, dependencies, result, analyzeCallbacks });
      return result;
    };
    if (shouldCancel?.()) return partial(macroCancelled);
    if (memoryPressure?.()) return partial(macroMemoryLimit);
    if (budget?.projectExhausted) return partial(macroWorkLimit);
    const events = timeline(file, files, issues, dependencies, memoryPressure, shouldCancel);
    if (shouldCancel?.()) return partial(macroCancelled);
    if (issues.has(macroMemoryLimit)) return partial(macroMemoryLimit);
    if (issues.has(includeLimit)) return partial(includeLimit);
    const lookup = environment(events, issues);
    const originalLocation = locationIn(file.text, file.uri);
    const sourceLocation: ReturnType<typeof locationIn> = (start, end) => ({...originalLocation(start, end), ...(file.context ? {context:fileKey(file)} : {})});
    const macroIds = (name: string, offset: number) => [...new Set(lookup(name, offset).flatMap(choice => choice.macro ? [`${locationKey(choice.macro.location)}#${choice.macro.location.start}`] : []))];
    let references = file.references.map(ref => {
      const ids = macroIds(ref.name, ref.location.start);
      return ids.length ? { ...ref, macroIds: ids } : ref;
    });
    if (!events.some(event => event.value.kind === 'define')) {
      const result = { ...file, projectScoped: true };
      cache!.set(fileKey(file), { raw: file, paths, dependencies, result, analyzeCallbacks }); return result;
    }
    // Initializer values feed callback propagation, not ordinary references or
    // literal function arguments. Keep raw facts intact for later re-enabling.
    const sourceConditions = new Map([...file.symbols.map(symbol => [symbol.location.start, symbol.conditions] as const), ...file.references.map(ref => [ref.location.start, ref.conditions] as const),
      ...(file.statementConditions ?? []).map(statement => [statement.start, statement.conditions] as const)]);
    let initializers = (analyzeCallbacks ? file.initializers ?? [] : []).map(init => {
      if (shouldCancel?.()) { issues.add(macroCancelled); return init; }
      if (memoryPressure?.()) { issues.add(macroMemoryLimit); return init; }
      const tokens = tokenizeC(activeText(file, init.location.start, init.location.end), (start, end) => sourceLocation(init.location.start + start, init.location.start + end));
      const expander = new MacroExpander(lookup, memoryPressure, shouldCancel, budget, init.id), variants = expander.expand(tokens);
      expander.issues.forEach(issue => issues.add(issue));
      if (budget?.projectExhausted) return init;
      if (issues.has(macroMemoryLimit)) return init;
      if (!variants.some(variant => variant.changed)) return init;
      const values = variants.map(variant => {
        if (shouldCancel?.()) { issues.add(macroCancelled); return init.value; }
        if (memoryPressure?.()) { issues.add(macroMemoryLimit); return init.value; }
        const offsets: number[] = []; let length = 0;
        for (const token of variant.tokens) { offsets.push(length); length += token.text.length + 1; }
        const original = (start: number, end: number): Location => {
          const pick = (position: number) => { let low = 0, high = offsets.length; while (low + 1 < high) { const mid = (low + high) >>> 1; if (offsets[mid] <= position) low = mid; else high = mid; } return variant.tokens[low]?.location ?? init.location; };
          const a = pick(start), b = pick(Math.max(start, end - 1));
          return { ...a, end: Math.max(a.end, b.end), endLine: b.endLine, endColumn: b.endColumn };
        };
        const parsed = parseInitializer(file.uri, joinTokens(variant.tokens), original, location => sourceConditions.get(location.start) ?? []);
        if (parsed.issues.length) issues.add('Macro-expanded initializer near line ' + (init.location.line + 1) + ' has unsupported syntax');
        return parsed.value;
      });
      const value: FlowExpression = values.length === 1 ? values[0] : { kind: 'choice', values, location: init.location };
      return { ...init, value };
    });
    if (shouldCancel?.()) return partial(macroCancelled);
    if (issues.has(macroMemoryLimit)) return partial(macroMemoryLimit);
    if (budget?.projectExhausted) return partial(macroWorkLimit);
    let programs = file.programs ?? [];
    for (const fn of file.functions ?? []) {
      if (shouldCancel?.()) return partial(macroCancelled);
      if (memoryPressure?.()) return partial(macroMemoryLimit);
      const tokens = tokenizeC(activeText(file, fn.body.start, fn.body.end), (start, end) => sourceLocation(fn.body.start + start, fn.body.start + end));
      const expander = new MacroExpander(lookup, memoryPressure, shouldCancel, budget, fn.id), variants = expander.expand(tokens);
      expander.issues.forEach(issue => issues.add(issue));
      if (budget?.projectExhausted) return partial(macroWorkLimit);
      if (shouldCancel?.()) return partial(macroCancelled);
      if (issues.has(macroMemoryLimit)) return partial(macroMemoryLimit);
      if (!variants.some(variant => variant.changed)) continue;
      const calls: ReferenceRecord[] = [], seen = new Set<string>();
      const generatedPrograms: FlowProgram[] = [];
      const generatedInitializers: GlobalInitializer[] = [];
      const parsedVariants = new Map<string, ReturnType<typeof parseCalls>>();
      const share = variants.length > 1 ? sharedFlowStructure() : <T>(value: T) => value;
      for (const [variantIndex, variant] of variants.entries()) {
        if (shouldCancel?.()) return partial(macroCancelled);
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
          generated.programs = generated.programs.map(share);
          generated.initializers = generated.initializers.map(share);
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
    cache!.set(fileKey(file), { raw: file, paths, dependencies, result, analyzeCallbacks }); return result;
  });
}
