import { CompileUnitContext, BuildFileSystem, BuildIssue, buildDirectory, fingerprintBuildInput, resolveBuildUri } from './build-context';
import { AnalysisWorkBudget } from './analysis-budget';
import { MacroBranch, MacroDefinition, PreprocessorEvent } from './model';
import { locationIn, tokenizeC } from './c-tokens';
export interface PreparedOccurrence {
  macrosOnly?: boolean;
  key: string; uri: string; text: string; entryEnvironmentFingerprint: string; maskedText: string;
  inactive: { start: number; end: number }[];
  timeline: { offset: number; value: PreprocessorEvent; inherited?: boolean }[];
  resolvedIncludes: { start: number; uri: string; key?: string }[];
}
export interface PreparedContext {
  occurrences: PreparedOccurrence[]; dependencies: { uri: string; digest: string }[];
  missingCandidates: string[]; issues: BuildIssue[]; fingerprint: string;
}
export function maskInactive(text: string, ranges: readonly { start: number; end: number }[]) {
  const chars = text.split('');
  for (const { start, end } of ranges) for (let n = start; n < end; n++) if (chars[n] !== '\n' && chars[n] !== '\r') chars[n] = ' ';
  return chars.join('');
}
type Truth = boolean | undefined;
type Environment = Map<string, MacroDefinition | null | undefined>;
const both = (a: Truth, b: Truth): Truth => a === false || b === false ? false : a === true && b === true ? true : undefined;
const inverse = (a: Truth): Truth => a === undefined ? undefined : !a;

// A deliberately small C integer subset. Unknown ABI width/signedness never uses JS bitwise coercion.
function integerCondition(expression: string, env: Environment, closed: boolean, seen = new Set<string>()): bigint | undefined {
  if (seen.size > 32) return;
  const tokens = tokenizeC(expression, locationIn(expression, '')).map(t => t.text); let at = 0;
  const priorities: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4 };
  const known = (name: string): Truth => env.has(name) ? env.get(name) === undefined ? undefined : env.get(name) !== null : closed ? false : undefined;
  function atom(): bigint | undefined {
    const token = tokens[at++];
    if (token === '!') { const value = atom(); return value === undefined ? undefined : value === 0n ? 1n : 0n; }
    if (token === '(') { const value = parse(1); if (tokens[at++] !== ')') return; return value; }
    if (token === 'defined') {
      const parenthesis = tokens[at] === '('; if (parenthesis) at++;
      const name = tokens[at++]; if (!name || !/^[A-Za-z_]\w*$/.test(name) || parenthesis && tokens[at++] !== ')') return;
      const value = known(name); return value === undefined ? undefined : value ? 1n : 0n;
    }
    if (/^(?:0x[0-9a-f]+|0[0-7]*|[1-9]\d*)$/i.test(token ?? '')) {
      const value = /^0[0-7]+$/.test(token) ? BigInt('0o' + token.slice(1)) : BigInt(token);
      return value <= 2_147_483_647n ? value : undefined;
    }
    if (/^[A-Za-z_]\w*$/.test(token ?? '')) {
      if (seen.has(token)) return;
      const macro = env.get(token);
      if (macro && !macro.parameters && !macro.opaque) return integerCondition(macro.body, env, closed, new Set([...seen, token]));
      return known(token) === false ? 0n : undefined;
    }
    return;
  }
  function parse(minimum: number): bigint | undefined {
    let left = atom();
    while ((priorities[tokens[at]] ?? 0) >= minimum) {
      const operator = tokens[at++], right = parse(priorities[operator] + 1);
      if (operator === '&&') left = left === 0n || right === 0n ? 0n : left !== undefined && right !== undefined ? 1n : undefined;
      else if (operator === '||') left = left !== undefined && left !== 0n || right !== undefined && right !== 0n ? 1n : left === 0n && right === 0n ? 0n : undefined;
      else if (left === undefined || right === undefined) left = undefined;
      else left = (operator === '==' ? left === right : operator === '!=' ? left !== right : operator === '<' ? left < right : operator === '>' ? left > right : operator === '<=' ? left <= right : left >= right) ? 1n : 0n;
    }
    return left;
  }
  const result = parse(1); return at === tokens.length ? result : undefined;
}

export async function preparePreprocessorContext(unit: CompileUnitContext, fs: BuildFileSystem, text: string,
  control: { shouldCancel?: () => boolean; workBudget: AnalysisWorkBudget; eligibleHeader: (uri: string) => boolean }): Promise<PreparedContext> {
  const result: PreparedContext = { occurrences: [], dependencies: [], missingCandidates: [], issues: [], fingerprint: '' };
  const environment: Environment = new Map(), texts = new Map<string, string | undefined>([[unit.sourceUri, text]]), stack = new Set<string>();
  let serial = 0, stopped = false, definitionVersion = 0, opaqueVersion = 0;
  const versions = new Map<string, number>(), identities = new Map<string, string>();
  const once = new Set<string>();
  const addIssue = (code: string, message: string) => { if (result.issues.length < 128) result.issues.push({ code, message }); };
  const envFingerprint = (env: Environment) => fingerprintBuildInput([...env].map(([name, macro]) => [name, macro, macro === undefined]));
  const opaque = (env: Environment) => { opaqueVersion++; for (const name of env.keys()) env.set(name, undefined); };
  function conditionIdentity(kind: string, expression: string, env: Environment, fallback: string) {
    kind = kind.replace(/^elif/, 'if');
    const names = new Set(tokenizeC(expression, locationIn(expression, '')).filter(t => /^[A-Za-z_]\w*$/.test(t.text) && t.text !== 'defined').map(t => t.text));
    for (const name of names) {
      const macro = env.get(name);
      if (names.size > 256 || name.startsWith('__') || macro?.opaque || macro?.body.includes('##')) return fallback;
      if (macro) for (const token of tokenizeC(macro.body, () => macro.location)) if (/^[A-Za-z_]\w*$/.test(token.text) && !macro.parameters?.includes(token.text)) names.add(token.text);
    }
    const signature = fingerprintBuildInput([kind, expression, opaqueVersion, [...names].sort().map(name => [name, versions.get(name) ?? 0])]);
    const previous = identities.get(signature); if (previous) return previous;
    identities.set(signature, fallback); return fallback;
  }
  async function read(uri: string) {
    if (texts.has(uri)) return texts.get(uri);
    const value = await fs.readText(uri); texts.set(uri, value);
    result.dependencies.push({ uri, digest: fingerprintBuildInput(value ?? null) });
    if (value === undefined) result.missingCandidates.push(uri);
    return value;
  }
  const origin = { ...locationIn(text, unit.sourceUri)(0, 0), context: 'command:' + unit.id };
  for (const action of unit.macroActions) {
    const fn = /^(\w+)\(([^)]*)\)$/.exec(action.name), name = fn?.[1] ?? action.name;
    environment.set(name, action.kind === 'undef' ? null : { name, body: action.replacement ?? '1', parameters: fn ? fn[2].split(',').map(v => v.trim()).filter(Boolean) : undefined, location: origin, conditions: [] });
  }
  async function visit(uri: string, source: string, env: Environment, depth: number): Promise<PreparedOccurrence | undefined> {
    const entryEnvironmentFingerprint = envFingerprint(env);
    const key = fingerprintBuildInput([unit.id, uri, entryEnvironmentFingerprint, ++serial]);
    if (control.shouldCancel?.() || depth > 32 || serial > 40_000 || stack.has(uri + ':' + entryEnvironmentFingerprint)) {
      addIssue(control.shouldCancel?.() ? 'cancelled' : 'preprocessor-limit', `Preprocessor traversal stopped at ${uri}`); opaque(env); return;
    }
    const originalLocation = locationIn(source, uri), locate: ReturnType<typeof locationIn> = (start, end) => ({ ...originalLocation(start, end), context: key });
    const tokens = tokenizeC(source, locate);
    if (control.workBudget.consumeProject(tokens.length, 'macros') !== 'ok') { addIssue('preprocessor-limit', 'Preprocessor work limit'); stopped = true; opaque(env); return; }
    const occurrence: PreparedOccurrence = { key, uri, text: source, entryEnvironmentFingerprint, maskedText: source, inactive: [], timeline: [], resolvedIncludes: [] };
    if (once.has(uri)) { occurrence.inactive = [{start:0,end:source.length}]; occurrence.maskedText = maskInactive(source, occurrence.inactive); result.occurrences.push(occurrence); return occurrence; }
    const guardName = tokens[0]?.text === '#' && tokens[1]?.text === 'ifndef' && tokens.at(-2)?.text === '#' && tokens.at(-1)?.text === 'endif' ? tokens[2]?.text : undefined;
    const guardDefine = guardName && tokens[3]?.text === '#' && tokens[4]?.text === 'define' && tokens[5]?.text === guardName;
    const hasGuardUndef = guardName && tokens.some((token, n) => token.text === '#' && tokens[n+1]?.text === 'undef' && tokens[n+2]?.text === guardName);
    const guardOpaqueVersion = opaqueVersion;
    for (const [name, macro] of env) if (macro !== undefined && !macro?.opaque) occurrence.timeline.push({ offset: -1, inherited: true,
      value: macro ? { kind: 'define', location: macro.location, conditions: [], macro: { ...macro, conditions: [], branches: [] } } : { kind: 'undef', location: origin, conditions: [], name } });
    const conditional: { parent: Truth; remaining: Truth; branch: Truth; base: Environment; outcomes: Environment[]; choices: MacroBranch[]; remainingChoices: MacroBranch[]; key: string; label: string }[] = [];
    const replacements: { start: number; end: number; value: string }[] = [];
    let active: Truth = true, cursor = 0;
    const currentBranches = () => conditional.flatMap(c => c.choices);
    const defineEvent = (event: PreprocessorEvent, offset: number) => occurrence.timeline.push({ offset, value: event });
    const merge = (outcomes: Environment[]) => {
      const names = new Set(outcomes.flatMap(value => [...value.keys()])); env.clear();
      for (const name of names) {
        const first = outcomes[0]?.get(name), signature = fingerprintBuildInput([first, first === undefined]);
        env.set(name, outcomes.every(value => fingerprintBuildInput([value.get(name), value.get(name) === undefined]) === signature) ? first : undefined);
      }
    };
    const restore = (value: Environment) => { env.clear(); value.forEach((macro, name) => env.set(name, macro)); };
    stack.add(uri + ':' + entryEnvironmentFingerprint);
    for (let n = 0; n < tokens.length; n++) {
      if((n&255)===0&&control.shouldCancel?.()){addIssue('cancelled','Preprocessor analysis cancelled');stopped=true;opaque(env);break;}
      const token = tokens[n];
      if (token.text !== '#' || n && tokens[n - 1].location.line === token.location.line) continue;
      let end = source.indexOf('\n', token.location.start);
      while (end >= 0 && /\\\r?$/.test(source.slice(token.location.start, end))) end = source.indexOf('\n', end + 1);
      if (end < 0) end = source.length; else end++;
      if (active === false && cursor < token.location.start) occurrence.inactive.push({ start: cursor, end: token.location.start });
      cursor = end;
      let last = n + 1; while (last < tokens.length && tokens[last].location.start < end) last++;
      const directive = tokens[n + 1]?.text, tail = tokens.slice(n + 2, last), expression = tail.map(t => t.text).join(' '), location = locate(token.location.start, end);
      const raw = source.slice(token.location.start, end).replace(/\\\r?\n/g, ' ').trim();
      n = last - 1;
      const test = (kind: string): Truth => {
        if (kind === 'ifdef' || kind === 'ifndef' || kind === 'elifdef' || kind === 'elifndef') {
          const name = tail[0]?.text, known = env.has(name) ? env.get(name) === undefined ? undefined : env.get(name) !== null : unit.builtins === 'known' ? false : undefined;
          return kind.endsWith('ndef') ? inverse(known) : known;
        }
        const number = integerCondition(expression, env, unit.builtins === 'known'); return number === undefined ? undefined : number !== 0n;
      };
      if (['if', 'ifdef', 'ifndef'].includes(directive)) {
        const value = test(directive), label = raw, branchKey = conditionIdentity(directive, expression, env, key + ':' + location.start);
        conditional.push({ parent: active, remaining: inverse(value), branch: both(active, value), base: new Map(env), outcomes: [], key: branchKey, label,
          choices: value === undefined ? [{ key: branchKey, value: true, condition: label }] : [], remainingChoices: value === undefined ? [{key:branchKey,value:false,condition:`else of ${label}`}] : [] });
        active = both(active, value);
        if (value !== undefined) replacements.push({ start: location.start, end, value: `#if ${value ? 1 : 0}` });
      } else if (['elif', 'elifdef', 'elifndef', 'else'].includes(directive)) {
        const state = conditional.at(-1); if (!state) { addIssue('invalid-condition', `Unexpected #${directive} in ${uri}`); continue; }
        if (state.branch !== false) state.outcomes.push(new Map(env));
        restore(state.base);
        const value = directive === 'else' ? true : test(directive), branch = both(state.remaining, value);
        const branchKey = conditionIdentity(directive, expression, env, key + ':' + location.start);
        state.choices = [...state.remainingChoices, ...(value === undefined ? [{key:branchKey,value:true,condition:raw}] : [])];
        if(value === undefined)state.remainingChoices.push({key:branchKey,value:false,condition:`else of ${raw}`});
        state.branch = both(state.parent, branch); state.remaining = both(state.remaining, inverse(value)); active = state.branch;
        if (directive !== 'else' && value !== undefined) replacements.push({ start: location.start, end, value: `#elif ${value ? 1 : 0}` });
      } else if (directive === 'endif') {
        const state = conditional.pop(); if (!state) { addIssue('invalid-condition', `Unexpected #endif in ${uri}`); continue; }
        if (state.branch !== false) state.outcomes.push(new Map(env));
        if (state.remaining !== false || state.parent === false) state.outcomes.push(state.base);
        merge(state.outcomes); active = state.parent;
      } else if (active === false) occurrence.inactive.push({ start: location.start, end });
      else if (directive === 'define') {
        const definition = /^#\s*define\s+([A-Za-z_]\w*)(\([^)]*\))?\s*([\s\S]*)$/.exec(raw);
        if (!definition) { addIssue('invalid-define', `Unresolved macro definition in ${uri}`); opaque(env); continue; }
        const branches = currentBranches(), conditions = branches.map(b => b.condition), macro: MacroDefinition = { name: definition[1], body: definition[3],
          parameters: definition[2] ? definition[2].slice(1, -1).split(',').map(v => v.trim()).filter(Boolean) : undefined,
          location: locate(tail[0].location.start, tail[0].location.end), conditions, branches };
        if(macro.parameters?.at(-1)?.endsWith('...'))macro.variadic=macro.parameters.pop()!.slice(0,-3).trim()||'__VA_ARGS__';
        versions.set(macro.name,++definitionVersion);
        env.set(macro.name, macro); defineEvent({ kind: 'define', macro, location, conditions, branches }, location.start);
      } else if (directive === 'undef') {
        const name = tail[0]?.text; if (name) { env.set(name, null); versions.set(name,++definitionVersion); const branches = currentBranches(); defineEvent({ kind: 'undef', name, location, conditions: branches.map(b => b.condition), branches }, location.start); }
      } else if (directive === 'include') {
        const rawName = tail.length ? source.slice(tail[0].location.start,tail.at(-1)!.location.end).replace(/\\\r?\n/g,'').trim() : '', macro = env.get(rawName);
        const expanded = macro && !macro.parameters ? macro.body : rawName;
        const path = /^"([^"\n]+)"$/.exec(expanded) ?? /^<([^>\n]+)>$/.exec(expanded);
        const branches = currentBranches(), conditions = branches.map(b => b.condition), system = expanded.startsWith('<');
        let included: PreparedOccurrence | undefined;
        if (path) {
          const ordered = [...(!system ? [{ kind: 'quote', uri: buildDirectory(uri) }] : []), ...unit.includeSearch.filter(i => !system || i.kind !== 'quote')]
            .sort((a, b) => ['quote', 'user', 'system', 'after'].indexOf(a.kind) - ['quote', 'user', 'system', 'after'].indexOf(b.kind));
          for (const directory of ordered) {
            if(directory.kind==='after'&&unit.builtins!=='known'){addIssue('unknown-default-includes','Compiler default include directories precede -idirafter and are unknown');break;}
            const candidate = resolveBuildUri(directory.uri, path[1]);
            // A blocked earlier search candidate cannot silently be bypassed.
            if (!control.eligibleHeader(candidate)) { addIssue('header-out-of-scope', `Required header search is outside Include/Exclude: ${candidate}`); break; }
            const header = await read(candidate); if (header === undefined) continue;
            included = await visit(candidate, header, env, depth + 1);
            if (included) {
              occurrence.resolvedIncludes.push({ start: location.start, uri: candidate, key: included.key });
              for (const event of included.timeline) if (!event.inherited) defineEvent({ ...event.value, conditions: [...conditions, ...event.value.conditions], branches: [...branches, ...(event.value.branches ?? [])] }, location.start);
            }
            break;
          }
        }
        if (!included) {
          opaque(env); addIssue('unresolved-include', `Header not resolved at ${uri}:${location.line + 1}: ${expression}`);
          defineEvent({ kind: 'include', path: path?.[1] ?? expression, system, location, conditions, branches }, location.start);
        }
      } else if (!['pragma', 'error', 'warning', 'line'].includes(directive)) {
        opaque(env); addIssue('unsupported-directive', `Unsupported #${directive} in ${uri}`);
      } else if (directive === 'pragma' && /push_macro|pop_macro/.test(expression)) { opaque(env); addIssue('unsupported-directive', `Unsupported pragma in ${uri}`); }
      else if (directive === 'pragma' && expression === 'once' && active === true) once.add(uri);
    }
    if (active === false && cursor < source.length) occurrence.inactive.push({ start: cursor, end: source.length });
    if (conditional.length) { addIssue('invalid-condition', `Unclosed preprocessor conditional in ${uri}`); opaque(env); }
    if (guardName && guardDefine && !hasGuardUndef && opaqueVersion === guardOpaqueVersion && env.get(guardName) === undefined)
      env.set(guardName,{name:guardName,body:'',opaque:true,location:origin,conditions:[]});
    occurrence.maskedText = maskInactive(source, occurrence.inactive);
    const chars = occurrence.maskedText.split('');
    for (const replacement of replacements) {
      let written = 0;
      for (let offset = replacement.start; offset < replacement.end; offset++) if (chars[offset] !== '\r' && chars[offset] !== '\n') chars[offset] = replacement.value[written++] ?? ' ';
    }
    occurrence.maskedText = chars.join(''); result.occurrences.push(occurrence);
    stack.delete(uri + ':' + entryEnvironmentFingerprint); return occurrence;
  }
  const forcedEvents: PreparedOccurrence['timeline'] = [];
  const forcedHeaders: PreparedOccurrence['resolvedIncludes'] = [];
  for (const input of [...unit.forcedInputs.filter(i => i.kind === 'macros'), ...unit.forcedInputs.filter(i => i.kind === 'header')]) {
    if (!control.eligibleHeader(input.uri)) { opaque(environment); addIssue('header-out-of-scope', `Required forced input outside Include/Exclude: ${input.uri}`); continue; }
    const header = await read(input.uri);
    if (header === undefined) { opaque(environment); addIssue('unresolved-include', `Missing forced input: ${input.uri}`); continue; }
    const begin=result.occurrences.length,occurrence = await visit(input.uri, header, environment, 0);
    if (occurrence) {
      forcedEvents.push(...occurrence.timeline.filter(e => !e.inherited).map(e => ({ ...e, offset: -1 })));
      if(input.kind==='macros')for(const file of result.occurrences.slice(begin))file.macrosOnly=true;
      else forcedHeaders.push({start:-1,uri:input.uri,key:occurrence.key});
    }
  }
  const main = await visit(unit.sourceUri, text, environment, 0);
  if (main) {main.timeline.unshift(...forcedEvents);main.resolvedIncludes.unshift(...forcedHeaders);}
  if (stopped) result.occurrences = [];
  result.fingerprint = fingerprintBuildInput([unit.fingerprint, result.dependencies, result.missingCandidates, result.issues]);
  return result;
}
