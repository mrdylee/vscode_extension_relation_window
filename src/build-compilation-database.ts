import { BuildEntry, BuildFileSystem, BuildProfile, buildDirectory, fingerprintBuildInput, normalizeCompileContext, resolveBuildUri, splitBuildWords } from './build-context';

function shellEffects(command: string, dialect: 'posix' | 'windows') {
  let quote = '';
  for (let n=0;n<command.length;n++) {
    const c=command[n];
    if (dialect==='posix' && c==='\\' && quote!=="'") { n++; continue; }
    if (c==='"' || dialect==='posix' && c==="'") { if (!quote) quote=c; else if (quote===c) quote=''; continue; }
    if (!quote && /[;&|<>]/.test(c) || quote!=="'" && /[$`]/.test(c) || dialect==='windows' && c==='%') return true;
  }
  return false;
}

// A database records compile invocations, not a proof of the final link set.
export async function readCompilationDatabase(fs: BuildFileSystem, entry: BuildEntry): Promise<BuildProfile> {
  const profile: BuildProfile = {id:entry.id,entry,fingerprint:'',units:[],coverage:'partial',dependencies:[],relevantEnvironment:[],issues:[]};
  const issue = (code: string, message: string) => { if (profile.issues.length < 128) profile.issues.push({code,message}); };
  let text: string | undefined;
  try { text = await fs.readText(entry.entryUri); } catch { /* Report unavailable metadata below. */ }
  profile.dependencies.push({uri:entry.entryUri,digest:fingerprintBuildInput(text??null)});
  let records: unknown;
  if (text === undefined) issue('missing-build-input','Compilation database is unavailable.');
  else if (Buffer.byteLength(text) > 16 * 1024 * 1024) issue('file-limited','Compilation database exceeds 16 MiB.');
  else {
    try { records = JSON.parse(text); } catch { issue('invalid-compilation-database','Compilation database is not valid JSON.'); }
    if (records !== undefined && !Array.isArray(records)) issue('invalid-compilation-database','Compilation database must contain an array.');
  }
  if (Array.isArray(records)) {
    if (records.length > 10_000) issue('extraction-limited','Compilation database exceeds 10,000 records.');
    for (const [index, record] of records.slice(0,10_000).entries()) {
      const invalid = () => issue('invalid-compile-command',`Compilation database record ${index+1} has invalid directory, file or command fields.`);
      if (!record || typeof record !== 'object' || typeof record.directory !== 'string' || !record.directory || typeof record.file !== 'string' || !record.file) { invalid(); continue; }
      try {
        const cwdUri=resolveBuildUri(buildDirectory(entry.entryUri),record.directory),sourceUri=resolveBuildUri(cwdUri,record.file);
        if (!/\.c$/i.test(new URL(sourceUri).pathname)) continue;
        const dialect=/^[A-Za-z]:[\\/]|^\\\\/.test(record.directory)?'windows':'posix';
        // Prefer argv: unlike command text, its quotes and metacharacters are literal.
        const argv=Array.isArray(record.arguments) && record.arguments.length && record.arguments.every((arg:unknown)=>typeof arg==='string')
          ? record.arguments : record.arguments !== undefined ? undefined : typeof record.command==='string' ? splitBuildWords(record.command,dialect) : undefined;
        if (!argv?.length || !argv[0] || argv.length > 4096 || argv.join(' ').length > 65_536) { invalid(); continue; }
        if (record.arguments === undefined && shellEffects(record.command,dialect)) {
          issue('unsupported-command',`Compilation database record ${index+1} contains shell expansion or compound commands.`); continue;
        }
        if (record.output !== undefined && typeof record.output !== 'string') { invalid(); continue; }
        const unit=await normalizeCompileContext({profileId:entry.id,sourceUri,cwdUri,argv,dialect,
          outputUri:record.output?resolveBuildUri(cwdUri,record.output):undefined,
          evidence:[{uri:entry.entryUri,line:0,expression:`Compilation database record ${index+1}: ${record.file}`}]},fs);
        if (unit.compiler==='unknown') unit.membership='unknown';
        profile.units.push(unit);
      } catch { invalid(); }
    }
  }
  profile.units=[...new Map(profile.units.map(unit=>[unit.id,unit])).values()];
  for (const unit of profile.units) for (const dependency of unit.dependencies)
    if (!profile.dependencies.some(existing=>existing.uri===dependency.uri)) profile.dependencies.push(dependency);
  profile.fingerprint=fingerprintBuildInput(['compilation-database:1',entry,profile.units.map(unit=>unit.fingerprint),profile.dependencies,profile.issues]);
  return profile;
}
