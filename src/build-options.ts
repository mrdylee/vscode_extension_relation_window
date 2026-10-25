import { BuildEntry, BuildEvidence, BuildFileSystem, BuildIssue, BuildProfile, buildDirectory, fingerprintBuildInput, normalizeCompileContext, resolveBuildUri, splitBuildWords } from './build-context';

interface Variable { value: string; simple: boolean; origin: 'environment' | 'file' | 'command'; exported?: boolean }
interface Rule { targets: string[]; prerequisites: string[]; recipes: { text: string; evidence: BuildEvidence }[] }
const unknown = '\u0000';
function logicalLines(text: string, continuation = '\\') {
  const physical=text.split(/\r?\n/), result:{text:string;line:number}[]=[];
  for(let line=0;line<physical.length;line++) {
    const start=line;let text=physical[line];
    while(text.endsWith(continuation)&&line+1<physical.length)text=text.slice(0,-1)+' '+physical[++line];
    result.push({text,line:start});
  }
  return result;
}
export async function extractStaticBuildOptions(fs: BuildFileSystem, entry: BuildEntry, sourceUris: readonly string[], environment: Record<string, string | undefined>): Promise<BuildProfile> {
  const profile: BuildProfile = { id: entry.id, entry, fingerprint: '', units: [], coverage: 'partial', dependencies: [], relevantEnvironment: [], issues: [] };
  const readCache = new Map<string, string | undefined>(), dependencies = new Map<string, string>(), usedEnvironment = new Set<string>();
  let operations = 0, failed = false, bytesRead = 0;
  const issue = (code: string, message: string, evidence?: BuildEvidence) => { failed = true; if (profile.issues.length < 128) profile.issues.push({ code, message, evidence }); };
  async function read(uri: string, evidence?: BuildEvidence, optional = false) {
    if (readCache.has(uri)) {
      const text=readCache.get(uri);
      if(text===undefined&&!optional)issue('missing-build-input',`Build input unavailable: ${uri}`,evidence);
      return text;
    }
    if (++operations > 20_000) { issue('extraction-limited', 'Build extraction operation limit', evidence); return; }
    let text: string | undefined;
    try { text = await fs.readText(uri); } catch { /* Report the unavailable dependency below. */ }
    if (text !== undefined && text.length > 1_048_576) { issue('file-limited', `Build input exceeds 1 MiB: ${uri}`, evidence); text = undefined; }
    if(text!==undefined&&(bytesRead+=Buffer.byteLength(text))>16*1024*1024){issue('extraction-limited','Build input exceeds the 16 MiB extraction budget',evidence);text=undefined;}
    readCache.set(uri, text); dependencies.set(uri, fingerprintBuildInput(text ?? null));
    if (text === undefined && !optional) issue('missing-build-input', `Build input unavailable: ${uri}`, evidence);
    return text;
  }
  function expand(text: string, variables: Map<string, Variable>, evidence: BuildEvidence, automatic: Record<string, string> = {}, seen = new Set<string>()): string {
    if (++operations > 20_000 || seen.size > 32) { issue('extraction-limited', 'Build variable expansion limit', evidence); return unknown; }
    if(text.length>65_536){issue('extraction-limited','Expanded build argument exceeds 64 KiB',evidence);return unknown;}
    let length=text.length,limited=false;
    const result=text.replace(/\$\(([^()]*)\)|\$\{([^{}]*)\}|\$([@<^A-Za-z_])/g, (all, paren, brace, single) => {
      const name = paren ?? brace ?? single;
      if (name in automatic) return automatic[name];
      if (!/^[A-Za-z_]\w*$/.test(name) || seen.has(name)) { issue('unsupported-expression', `Cannot statically evaluate ${name}`, evidence); return unknown; }
      const variable = variables.get(name);
      if (variable?.origin === 'environment') usedEnvironment.add(name);
      const value=!variable ? '' : variable.simple ? variable.value : expand(variable.value, variables, evidence, automatic, new Set([...seen, name]));
      length+=value.length-all.length;
      if(length>65_536){limited=true;return unknown;}
      return value;
    }).replace(/\$\([^)]*\)|\$\{[^}]*\}|`[^`]*`/g, expression => { issue('unsupported-expression', `Cannot statically evaluate ${expression}`, evidence); return unknown; });
    if(limited){issue('extraction-limited','Expanded build argument exceeds 64 KiB',evidence);return unknown;}
    return result;
  }
  function words(text: string, dialect: 'posix' | 'windows', evidence: BuildEvidence): string[] {
    const result = splitBuildWords(text, dialect);
    if (!result) issue('invalid-quoting', 'Unclosed build command quoting', evidence);
    return result ?? [];
  }
  const envVariables = (env: Record<string, string | undefined>): Map<string, Variable> => new Map(Object.entries(env).filter((pair): pair is [string, string] => pair[1] !== undefined).map(([key, value]) => [key, { value, simple: true, origin: 'environment' as const }]));
  const makeControls = new Set(['MAKEFLAGS','MFLAGS','MAKEOVERRIDES','MAKEFILES']);
  async function make(args: string[], cwd: string, env: Record<string, string | undefined>, chain: BuildEvidence[], depth: number) {
    if (depth > 32) { issue('extraction-limited', 'Recursive Make depth limit', chain.at(-1)); return; }
    const variables = envVariables(env), filenames: string[] = [], selected: string[] = [];
    for (let n = 0; n < args.length; n++) {
      const arg = args[n];
      if (arg === '-C' || arg === '--directory') { const value = args[++n]; if (value) cwd = resolveBuildUri(cwd, value); else issue('missing-option-value', 'Make directory missing', chain.at(-1)); }
      else if (arg.startsWith('-C') && arg.length > 2) cwd = resolveBuildUri(cwd, arg.slice(2));
      else if (arg === '-f' || arg === '--file') { const value = args[++n]; if (value) filenames.push(value); else issue('missing-option-value', 'Make file missing', chain.at(-1)); }
      else if (arg.startsWith('-f') && arg.length > 2) filenames.push(arg.slice(2));
      else if (/^[A-Za-z_]\w*=/.test(arg)) { const at = arg.indexOf('='); variables.set(arg.slice(0, at), { value: arg.slice(at + 1), simple: false, origin: 'command' }); }
      else if (arg.startsWith('-')) { if (!/^(?:-j\d*|-s|--silent|--no-print-directory)$/.test(arg)) issue('unsupported-make-option', `Unresolved Make option ${arg}`, chain.at(-1)); }
      else selected.push(arg);
    }
    for(const name of makeControls)if(variables.get(name)?.value.trim()) {
      if(variables.get(name)?.origin==='environment')usedEnvironment.add(name);
      issue('unsupported-make-environment',`Make control variable is not interpreted: ${name}`,chain.at(-1));
    }
    if (!filenames.length) {
      for (const name of ['GNUmakefile', 'makefile', 'Makefile']) {
        const uri = resolveBuildUri(cwd, name), text = await read(uri,chain.at(-1),true);
        if (text !== undefined) { filenames.push(name); break; }
      }
      if (!filenames.length) { issue('missing-build-input', `No Makefile at ${cwd}`, chain.at(-1)); return; }
    }
    const rules: Rule[] = [], reading = new Set<string>(); let defaultTarget: string | undefined;
    async function parse(uri: string, nesting: number) {
      if (nesting > 32 || reading.has(uri)) { issue('include-cycle', `Make include cycle/depth at ${uri}`); return; }
      const text = await read(uri); if (text === undefined) return;
      reading.add(uri); let current: Rule | undefined;
      const conditionals: { parent: boolean; value: boolean | undefined; otherwise: boolean }[] = [];
      let active = true;
    const lines = logicalLines(text);
      for (const {text:original,line} of lines) {
        const evidence = { uri, line, expression: original };
        if (++operations > 20_000) { issue('extraction-limited', 'Build statement limit', evidence); break; }
        if (/^\t/.test(original)) { if (active && current) current.recipes.push({ text: original.trim(), evidence }); continue; }
        const value = original.replace(/(?<!\\)#.*$/, '').trim(); if (!value) continue;
        const condition = /^(ifeq|ifneq|ifdef|ifndef)\s+(.+)$/.exec(value);
        if (condition) {
          const expression = expand(condition[2], variables, evidence); let known: boolean | undefined;
          if (!expression.includes(unknown)) {
            if (condition[1] === 'ifdef' || condition[1] === 'ifndef') {
              const variable = variables.get(expression.trim()); known = !!variable?.value;
              if (condition[1] === 'ifndef') known = !known;
            } else {
              const pair = /^\(([^,]*),([^)]*)\)$/.exec(expression);
              if (pair) known = condition[1] === 'ifeq' ? pair[1] === pair[2] : pair[1] !== pair[2];
            }
          }
          if (known === undefined) issue('unsupported-condition', `Unresolved Make condition: ${value}`, evidence);
          conditionals.push({ parent: active, value: known, otherwise: false }); active = active && known !== false; current = undefined; continue;
        }
        if (value === 'else') { const state = conditionals.at(-1); if (!state || state.otherwise) issue('invalid-condition', 'Unexpected Make else', evidence); else { state.otherwise = true; active = state.parent && state.value !== true; } current = undefined; continue; }
        if (value === 'endif') { const state = conditionals.pop(); if (!state) issue('invalid-condition', 'Unexpected Make endif', evidence); active = state?.parent ?? true; current = undefined; continue; }
        if (!active) continue;
        if (conditionals.some(c => c.value === undefined)) { current = undefined; continue; }
        const include = /^(include|-include|sinclude)\s+(.+)$/.exec(value);
        if (include) {
          const paths = words(expand(include[2], variables, evidence), 'posix', evidence);
          for (const path of paths) {
            if (/[\u0000*?]/.test(path)) { issue('unsupported-include', `Unresolved Make include: ${path}`, evidence); continue; }
            const next = resolveBuildUri(cwd, path);
            if (include[1] !== 'include' && await fs.readText(next) === undefined) { dependencies.set(next, fingerprintBuildInput(null)); continue; }
            await parse(next, nesting + 1);
          }
          current = undefined; continue;
        }
        const assignment = /^(?:export\s+)?([A-Za-z_]\w*)\s*(:=|\?=|\+=|=)\s*(.*)$/.exec(value);
        if (assignment) {
          const [, name, operator, raw] = assignment, old = variables.get(name);
          if (old?.origin === 'command' || operator === '?=' && old) continue;
          const simple = operator === ':=' || operator === '+=' && old?.simple === true;
          const next = simple ? expand(raw, variables, evidence) : raw;
          if(makeControls.has(name)&&next.trim())issue('unsupported-make-environment',`Make control variable is not interpreted: ${name}`,evidence);
          variables.set(name, { value: operator === '+=' && old ? old.value + ' ' + next : next, simple, origin: 'file', exported:/^export\s+/.test(value)||old?.exported||old?.origin==='environment' }); current = undefined; continue;
        }
        if(/^export\s+[A-Za-z_]\w*$/.test(value)){const name=value.split(/\s+/)[1],old=variables.get(name);variables.set(name,{value:old?.value??'',simple:old?.simple??true,origin:old?.origin??'file',exported:true});continue;}
        const rule = /^([^:]+):([^=]*)$/.exec(value);
        if (rule && !/\b(?:override|define|eval)\b/.test(value)) {
          const targets = words(expand(rule[1], variables, evidence), 'posix', evidence);
          if (targets.some(t => /[\u0000*?]/.test(t))) { issue('unsupported-target', `Unresolved target: ${value}`, evidence); continue; }
          current = { targets, prerequisites: words(expand(rule[2], variables, evidence), 'posix', evidence), recipes: [] }; rules.push(current);
          if (!defaultTarget && !targets[0]?.startsWith('.') && !targets[0]?.includes('%')) defaultTarget = targets[0];
        } else { issue('unsupported-statement', `Unresolved Make statement: ${value}`, evidence); current = undefined; }
      }
      if (conditionals.length) issue('invalid-condition', `Unclosed Make condition in ${uri}`);
      reading.delete(uri);
    }
    for (const filename of filenames) await parse(resolveBuildUri(cwd, filename), 0);
    const visited = new Set<string>(), visiting = new Set<string>();
    async function target(name: string, level: number) {
      if (visited.has(name)) return;
      if (level > 64 || visiting.has(name)) { issue('target-cycle', `Target cycle/depth: ${name}`); return; }
      visiting.add(name);
      let selectedRules = rules.filter(rule => rule.targets.includes(name)), stem: string | undefined;
      if (!selectedRules.length) {
        const pattern = rules.find(rule => rule.targets.some(value => { const parts = value.split('%'); return parts.length === 2 && name.startsWith(parts[0]) && name.endsWith(parts[1]); }));
        if (pattern) { selectedRules = [pattern]; const parts = pattern.targets.find(t => t.includes('%'))!.split('%'); stem = name.slice(parts[0].length, name.length - parts[1].length); }
      }
      for (const rule of selectedRules) {
        const prerequisites = rule.prerequisites.map(p => stem === undefined ? p : p.replace(/%/g, stem));
        for (const prerequisite of prerequisites) await target(prerequisite, level + 1);
        for (const recipe of rule.recipes) {
          const command = expand(recipe.text.replace(/^[@+-]+/, ''), variables, recipe.evidence, { '@': name, '<': prerequisites[0] ?? '', '^': prerequisites.join(' '), MAKE: 'make' });
          if (command.includes(unknown)) continue;
          const argv = words(command, 'posix', recipe.evidence);
          if (!argv.length) continue;
          const binary = argv[0].split(/[\\/]/).pop()!.replace(/\.exe$/, '');
          if (/^(?:g?make)$/.test(binary)) {
            const inherited=Object.fromEntries([...variables].filter(([,v])=>v.exported||v.origin==='environment').map(([name,v])=>[name,expand(v.value,variables,recipe.evidence)]));
            const overrides=[...variables].filter(([,v])=>v.origin==='command').map(([name,v])=>name+'='+expand(v.value,variables,recipe.evidence));
            await make([...overrides,...argv.slice(1)], cwd, inherited, [...chain, recipe.evidence], depth + 1); continue;
          }
          if (!/(?:^|-)gcc$|^(?:cc|dcc|clang)$/.test(binary)) { issue('unsupported-recipe', `Recipe cannot be evaluated statically: ${argv[0]}`, recipe.evidence); continue; }
          if (argv.some(v => /[;&|<>`]/.test(v))) { issue('unsupported-recipe', 'Shell operators in compile command', recipe.evidence); continue; }
          const source = argv.find(arg => /\.[cC]$/.test(arg));
          if (!source) { if (argv.includes('-c')) issue('missing-source', 'Compile command has no resolved source', recipe.evidence); continue; }
          const sourceUri = resolveBuildUri(cwd, source);
          const unit = await normalizeCompileContext({ profileId: profile.id, sourceUri, cwdUri: cwd, argv, dialect: 'posix', evidence: [...chain, recipe.evidence] }, fs);
          profile.units.push(unit);
        }
      }
      visiting.delete(name); visited.add(name);
    }
    for (const name of selected.length ? selected : defaultTarget ? [defaultTarget] : []) await target(name, 0);
    if (!defaultTarget && !selected.length) issue('missing-target', 'No statically known Make target');
  }
  const scriptStack = new Set<string>();
  async function script(uri: string, args: string[], cwd: string, env: Record<string, string | undefined>, dialect: 'sh' | 'cmd', chain: BuildEvidence[], depth: number, exported = new Set(Object.keys(env))): Promise<{ env: Record<string, string | undefined>; cwd: string; exported:Set<string> } | undefined> {
    const key = fingerprintBuildInput([uri, args, cwd, env]);
    if (depth > 32 || scriptStack.has(key)) { issue('script-cycle', `Script cycle/depth: ${uri}`); return; }
    const text = await read(uri); if (text === undefined) return; scriptStack.add(key);
    const local = { ...env }, scopes: Record<string, string | undefined>[] = [], directories: string[] = [];
    const lines = logicalLines(text,dialect==='cmd'?'^':'\\');
    const substitute = (value: string, evidence: BuildEvidence) => {
      const variable = (name: string) => { if (!(name in local)) { issue('unknown-script-variable', `Missing script variable: ${name}`, evidence); return unknown; } usedEnvironment.add(name); return local[name] ?? ''; };
      if (dialect === 'cmd') return value.replace(/%~dp0/gi, decodeURIComponent(new URL(buildDirectory(uri) + '/').pathname).replace(/^\/([A-Za-z]:)/, '$1')).replace(/%([A-Za-z_]\w*)%|%([1-9])/g, (_m, name, position) => name ? variable(name) : args[Number(position) - 1] ?? (issue('missing-script-argument', `Missing argument ${position}`, evidence), unknown));
      if (/`|\$\(/.test(value)) { issue('unsupported-expression', 'Dynamic shell expression', evidence); return unknown; }
      return value.replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)|\$([1-9])/g, (_m, brace, name, position) => position ? args[Number(position) - 1] ?? (issue('missing-script-argument', `Missing argument ${position}`, evidence), unknown) : variable(brace ?? name));
    };
    for (const {text:original,line} of lines) {
      const evidence = { uri, line, expression: original };
      let value = original.trim().replace(/^@/, '');
      if (!value || /^#!|^#|^::|^rem\b/i.test(value)) continue;
      if(/^echo\b/i.test(value)){if(/[;&|<>`]|\$\(/.test(value))issue('unsupported-statement','Echo has shell side effects',evidence);continue;}
      if (/^setlocal(?:\s|$)/i.test(value)) { if (/enabledelayedexpansion/i.test(value)) issue('unsupported-statement', 'Delayed cmd expansion', evidence); scopes.push({ ...local }); continue; }
      if (/^endlocal$/i.test(value)) { const prior = scopes.pop(); if (prior) { for (const key of Object.keys(local)) delete local[key]; Object.assign(local, prior); } else issue('invalid-scope', 'Unexpected endlocal', evidence); continue; }
      if (dialect === 'sh') value = value.replace(/\s+#.*$/, '');
      const assignment = dialect === 'cmd' ? /^set\s+"?([A-Za-z_]\w*)=(.*?)"?$/i.exec(value) : /^(?:export\s+)?([A-Za-z_]\w*)=(.*)$/.exec(value);
      if (assignment) { const raw = substitute(assignment[2], evidence), parts = words(raw, dialect === 'cmd' ? 'windows' : 'posix', evidence); local[assignment[1]] = parts.join(' '); if(/^export\s+/.test(value)||dialect==='cmd')exported.add(assignment[1]); continue; }
      if (dialect === 'sh' && /^export\s+[A-Za-z_]\w*$/.test(value)) {exported.add(value.split(/\s+/)[1]);continue;}
      value = substitute(value, evidence); if (value.includes(unknown)) continue;
      const argv = words(value, dialect === 'cmd' ? 'windows' : 'posix', evidence); if (!argv.length) continue;
      if (argv.some(v => /[;&|<>`]/.test(v))) { issue('unsupported-statement', 'Compound shell statement', evidence); continue; }
      const command = argv.shift()!.toLowerCase();
      if (command === 'cd' || command === 'pushd') { if (argv[0]?.toLowerCase() === '/d') argv.shift(); if (command === 'pushd') directories.push(cwd); if (argv.length === 1) cwd = resolveBuildUri(cwd, argv[0]); else issue('unsupported-directory', 'Directory not resolved', evidence); }
      else if (command === 'popd') { const prior = directories.pop(); if (prior) cwd = prior; else issue('unsupported-directory', 'Unmatched popd', evidence); }
      else if (/^(?:.*[\\/])?g?make(?:\.exe)?$/.test(command)) await make(argv, cwd, dialect==='cmd'?local:Object.fromEntries([...exported].map(name=>[name,local[name]])), [...chain, evidence], depth + 1);
      else if (['sh', 'bash', 'call', '.', 'source'].includes(command)) {
        const next = argv.shift(); if (!next) { issue('missing-script', 'Script path missing', evidence); continue; }
        const shared=['call','.','source'].includes(command), inherited=shared?local:Object.fromEntries([...exported].map(name=>[name,local[name]]));
        const result = await script(resolveBuildUri(cwd, next), argv, cwd, inherited, /\.(?:bat|cmd)$/i.test(next) ? 'cmd' : 'sh', [...chain, evidence], depth + 1, shared?new Set(exported):new Set(Object.keys(inherited)));
        if (result && shared) { for (const key of Object.keys(local)) delete local[key]; Object.assign(local, result.env); cwd = result.cwd; exported=result.exported; }
      } else issue('unsupported-statement', `Unresolved script statement: ${command}`, evidence);
    }
    scriptStack.delete(key);
    return { env: local, cwd, exported };
  }
  if (entry.dialect === 'make') await make(['-f', entry.entryUri, ...entry.args], entry.cwdUri, environment, entry.evidence, 0);
  else await script(entry.entryUri, entry.args, entry.cwdUri, environment, entry.dialect, entry.evidence, 0);
  profile.units = [...new Map(profile.units.map(unit => [unit.id, unit])).values()];
  if (failed) for (const unit of profile.units) { unit.status = 'partial'; unit.membership='unknown'; unit.issues.push(...profile.issues); }
  // Reaching some compile recipes does not prove the full target/link source set.
  profile.coverage = 'partial';
  profile.dependencies = [...dependencies].map(([uri, digest]) => ({ uri, digest }));
  profile.units.forEach(unit => unit.dependencies.forEach(d => { if (!dependencies.has(d.uri)) profile.dependencies.push(d); }));
  profile.relevantEnvironment = [...usedEnvironment].filter(name => environment[name] !== undefined).sort();
  profile.fingerprint = fingerprintBuildInput([entry, profile.units.map(u => u.fingerprint), profile.dependencies, profile.relevantEnvironment.map(name => [name, environment[name]]), profile.issues]);
  return profile;
}
