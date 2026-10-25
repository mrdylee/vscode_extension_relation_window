import { createHash } from 'node:crypto';

export interface BuildEvidence { uri: string; line: number; expression: string }
export interface BuildIssue { code: string; message: string; evidence?: BuildEvidence }
export interface BuildFileSystem {
  readText(uri: string): Promise<string | undefined>;
  list(uri: string): Promise<readonly { uri: string; kind: 'file' | 'directory' | 'link' }[]>;
}
export interface BuildEntry {
  id: string; rootUri: string; entryUri: string; cwdUri: string;
  dialect: 'sh' | 'cmd' | 'make'; args: string[]; evidence: BuildEvidence[];
}
export interface BuildDiscovery {
  entries: BuildEntry[]; candidates: string[]; dependencies: string[]; missingCandidates: string[]; issues: BuildIssue[];
  counts: { directories: number; filesRead: number; bytesRead: number };
}
export interface CompileInvocation {
  profileId: string; sourceUri: string; outputUri?: string; cwdUri: string; argv: string[];
  dialect: 'posix' | 'windows'; evidence: BuildEvidence[];
}
export interface CompileUnitContext extends CompileInvocation {
  id: string; fingerprint: string; compiler: 'gcc' | 'diab' | 'unknown'; status: 'resolved' | 'partial' | 'conflicting';
  membership: 'included' | 'excluded' | 'unknown'; builtins: 'known' | 'partial' | 'unknown';
  macroActions: { kind: 'define' | 'undef'; name: string; replacement?: string }[];
  includeSearch: { kind: 'quote' | 'user' | 'system' | 'after'; uri: string }[];
  forcedInputs: { kind: 'macros' | 'header'; uri: string }[];
  dependencies: { uri: string; digest: string }[]; issues: BuildIssue[];
}
export interface BuildProfile {
  id: string; entry: BuildEntry; fingerprint: string; units: CompileUnitContext[];
  coverage: 'complete' | 'partial' | 'unknown'; dependencies: { uri: string; digest: string }[];
  relevantEnvironment: string[]; issues: BuildIssue[];
}
export interface BuildEpoch { profileId: string; fingerprint: string; contextRevision: number; sourceRevision: number }
export interface BuildSourceScope { rootUri: string; include: string[]; exclude: string[]; nocase?: boolean }
export function fingerprintBuildInput(value: unknown): string {
  const normalize = (item: unknown): unknown => Array.isArray(item) ? item.map(normalize) : item && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child)])) : item;
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}
export function sameBuildEpoch(a: BuildEpoch, b: BuildEpoch) {
  return a.profileId === b.profileId && a.fingerprint === b.fingerprint && a.contextRevision === b.contextRevision && a.sourceRevision === b.sourceRevision;
}
export function buildDirectory(uri: string) { return new URL('.', uri).href.replace(/\/$/, ''); }
export function canonicalBuildUri(uri:string,nocase=process.platform==='win32') {
  const url=new URL(uri),segments=url.pathname.split('/').map(segment=>encodeURIComponent(decodeURIComponent(segment)));
  const drive=/^[A-Za-z]%3A$/i.test(segments[1]??'');
  if(drive)segments[1]=segments[1].slice(0,1).toLowerCase()+':';
  url.pathname=segments.join('/');
  if(nocase||drive)url.pathname=url.pathname.toLowerCase();
  return url.href;
}
export function resolveBuildUri(cwd: string, name: string) {
  if (/^[a-z][\w+.-]*:\/\//i.test(name)) return new URL(name).href.replace(/\/$/, '');
  name = name.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(name)) return new URL('file:///' + name.replace(/#/g, '%23')).href.replace(/\/$/, '');
  if (name.startsWith('//')) return new URL('file:' + name).href.replace(/\/$/, '');
  return new URL(name.replace(/#/g, '%23'), cwd.replace(/\/$/, '') + '/').href.replace(/\/$/, '');
}
// This is tokenization only: no shell expansion, substitution or process execution.
export function splitBuildWords(text: string, dialect: 'posix' | 'windows' = 'posix'): string[] | undefined {
  const words: string[] = []; let word = '', quote = '', started = false;
  for (let n = 0; n < text.length; n++) {
    const c = text[n];
    if (c === '\\' && dialect === 'posix' && quote !== "'" && n + 1 < text.length &&
      (!quote || /[\s"\\$`]/.test(text[n + 1]))) { word += text[++n]; started = true; continue; }
    if ((c === '"' || (c === "'" && dialect === 'posix')) && (!quote || quote === c)) { quote = quote ? '' : c; started = true; continue; }
    if (!quote && /\s/.test(c)) { if (started) { words.push(word); word = ''; started = false; } }
    else { word += c; started = true; }
  }
  if (quote) return;
  if (started) words.push(word);
  return words;
}
export async function normalizeCompileContext(invocation: CompileInvocation, fs: BuildFileSystem): Promise<CompileUnitContext> {
  const binary = invocation.argv[0]?.split(/[\\/]/).pop()?.replace(/\.exe$/i, '') ?? '';
  const compiler: CompileUnitContext['compiler'] = /(?:^|-)gcc$/.test(binary) ? 'gcc' : binary === 'dcc' ? 'diab' : 'unknown';
  const unit: CompileUnitContext = { ...invocation, id: '', fingerprint: '', compiler, status: 'resolved', membership: 'included', builtins: 'unknown', macroActions: [], includeSearch: [], forcedInputs: [], dependencies: [], issues: [] };
  const issue = (code: string, message: string) => { unit.status = 'partial'; unit.issues.push({ code, message }); };
  let responseOperations=0,responseCharacters=0;
  async function response(args: string[], seen = new Set<string>(), depth = 0): Promise<string[]> {
    const out: string[] = [];
    for (const arg of args) {
      if(++responseOperations>4096){issue('response-limit','Response argument limit: 4096');break;}
      if (!arg.startsWith('@')) {
        responseCharacters+=arg.length;
        if(responseCharacters>65_536){issue('response-limit','Expanded command exceeds 64 KiB');break;}
        out.push(arg); continue;
      }
      const uri = resolveBuildUri(invocation.cwdUri, arg.slice(1));
      if (compiler !== 'gcc' || depth >= 8 || seen.has(uri)) { issue('unsupported-response', `Cannot resolve response file: ${uri}`); continue; }
      const text = await fs.readText(uri);
      if (text === undefined || text.length > 1_048_576) { issue('missing-response', `Response file unavailable: ${uri}`); continue; }
      unit.dependencies.push({ uri, digest: fingerprintBuildInput(text) });
      const words = splitBuildWords(text);
      if (!words) { issue('invalid-response', `Unclosed response quoting: ${uri}`); continue; }
      out.push(...await response(words, new Set([...seen, uri]), depth + 1));
    }
    return out;
  }
  const args = await response(invocation.argv.slice(1));
  if (compiler !== 'gcc') issue('unsupported-compiler-options', `Compiler options have not been verified for ${binary || 'this command'}`);
  for (let n = 0; n < args.length && compiler === 'gcc'; n++) {
    const arg = args[n];
    const value = (prefix: string) => arg === prefix ? args[++n] : arg.slice(prefix.length);
    if (/^-([DU])/.test(arg)) {
      const body = value(arg.slice(0, 2));
      if (!body || !/^[A-Za-z_]\w*(?:\([^)]*\))?(?:=|$)/.test(body)) { issue('invalid-macro-option', `Invalid macro option: ${arg}`); continue; }
      const equal = body.indexOf('='), name = equal < 0 ? body : body.slice(0, equal);
      unit.macroActions.push(arg[1] === 'U' ? { kind: 'undef', name } : { kind: 'define', name, replacement: equal < 0 ? '1' : body.slice(equal + 1) });
    } else {
      const include = ['-iquote', '-isystem', '-idirafter', '-I'].find(prefix => arg.startsWith(prefix));
      const forced = ['-imacros', '-include'].find(prefix => arg.startsWith(prefix));
      if (include || forced) {
        const raw = value((include ?? forced)!);
        if (!raw) { issue('missing-option-value', `Missing option value: ${arg}`); continue; }
        if(raw==='-'||raw.startsWith('=')||raw.startsWith('$SYSROOT')){issue('unsupported-option',`Include search semantics not resolved: ${arg} ${raw}`);continue;}
        const uri = resolveBuildUri(invocation.cwdUri, raw);
        if (include) unit.includeSearch.push({ kind: include === '-iquote' ? 'quote' : include === '-isystem' ? 'system' : include === '-idirafter' ? 'after' : 'user', uri });
        else unit.forcedInputs.push({ kind: forced === '-imacros' ? 'macros' : 'header', uri });
      } else if (arg === '-o') { const output = args[++n]; if (output) unit.outputUri = resolveBuildUri(invocation.cwdUri, output); else issue('missing-option-value', 'Missing output path'); }
      else if (/^-M[FQT]/.test(arg)) {if(arg.length===3&&!args[++n])issue('missing-option-value',`Missing dependency output: ${arg}`);}
      else if (arg === '-x') { if (!args[++n]) issue('missing-option-value', 'Missing language'); }
      else if (arg.startsWith('-') && !/^(?:-c|-S|-E|-g\w*|-O[\w]*|-W[\w=,-]*|-std=[\w+]+|-f(?:no-)?(?:builtin|common|strict-aliasing|function-sections|data-sections|omit-frame-pointer|unwind-tables|asynchronous-unwind-tables)|-m[\w=.+-]+|-M(?:D|MD|P)?|-pipe)$/.test(arg))
        issue('unsupported-option', `Option semantics not resolved: ${arg}`);
    }
  }
  unit.id = fingerprintBuildInput([invocation.profileId, invocation.sourceUri, unit.outputUri, invocation.cwdUri, invocation.argv]);
  unit.fingerprint = fingerprintBuildInput({ ...unit, id: undefined, fingerprint: undefined, evidence: undefined });
  return unit;
}
