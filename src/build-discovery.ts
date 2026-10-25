import { BuildDiscovery, BuildFileSystem, buildDirectory, fingerprintBuildInput } from './build-context';
import { BuildEntry, BuildProfile } from './build-context';
import { extractStaticBuildOptions } from './build-options';

export class BuildMetadataCache implements BuildFileSystem {
  private texts = new Map<string, Promise<string | undefined>>();
  private sizes = new Map<string, number>();
  private dependencies = new Set<string>();
  private retainedBytes = 0;
  private directories = new Map<string, ReturnType<BuildFileSystem['list']>>();
  private discoveries = new Map<string, Promise<BuildDiscovery>>();
  private profiles = new Map<string, Promise<BuildProfile>>();
  constructor(private fs: BuildFileSystem) {}
  readText(uri: string) {
    this.dependencies.add(uri);
    let result = this.texts.get(uri);
    if (!result) {
      result = this.fs.readText(uri).then(text=>{
        if(this.texts.get(uri)===result){
          const bytes=text===undefined?0:Buffer.byteLength(text);this.sizes.set(uri,bytes);this.retainedBytes+=bytes;
          while(this.retainedBytes>8*1024*1024||this.texts.size>128)this.removeText(this.texts.keys().next().value!);
        }
        return text;
      });
      this.texts.set(uri, result);
    }
    return result;
  }
  private removeText(uri:string){this.retainedBytes-=this.sizes.get(uri)??0;this.sizes.delete(uri);this.texts.delete(uri);}
  list(uri: string) {
    let result = this.directories.get(uri);
    if (!result) { result = this.fs.list(uri); this.directories.set(uri, result); if(this.directories.size>20_000)this.directories.delete(this.directories.keys().next().value!); }
    return result;
  }
  discover(request: { rootUri: string; sourceUris: readonly string[]; explicitEntryUri?: string }) {
    const key = fingerprintBuildInput([request.rootUri, [...request.sourceUris].sort(), request.explicitEntryUri]);
    let result = this.discoveries.get(key);
    if (!result) { result = discoverBuildEntries(this, request); this.discoveries.set(key, result); if(this.discoveries.size>8)this.discoveries.delete(this.discoveries.keys().next().value!); }
    return result;
  }
  profile(entry: BuildEntry, sourceUris: readonly string[], environment: Record<string, string | undefined>) {
    const key = fingerprintBuildInput([entry, [...sourceUris].sort(), environment]);
    let result = this.profiles.get(key);
    if (!result) { result = extractStaticBuildOptions(this, entry, sourceUris, environment); this.profiles.set(key, result); if(this.profiles.size>8)this.profiles.delete(this.profiles.keys().next().value!); }
    return result;
  }
  invalidate(uri: string) {
    const parent = buildDirectory(uri), metadata = /(?:\/(?:GNUmakefile|[Mm]akefile)|\.(?:mk|sh|bat|cmd))$/i.test(uri);
    if (!this.dependencies.has(uri) && !(metadata && this.directories.has(parent))) return false;
    this.removeText(uri); this.directories.delete(parent); this.discoveries.clear(); this.profiles.clear();
    return true;
  }
  clear() { this.texts.clear(); this.sizes.clear(); this.dependencies.clear(); this.retainedBytes=0; this.directories.clear(); this.discoveries.clear(); this.profiles.clear(); }
}
export async function discoverBuildEntries(fs: BuildFileSystem, request: { rootUri: string; sourceUris: readonly string[]; explicitEntryUri?: string }, shouldCancel?: () => boolean): Promise<BuildDiscovery> {
  const result: BuildDiscovery = { entries: [], candidates: [], dependencies: [], missingCandidates: [], issues: [], counts: { directories: 0, filesRead: 0, bytesRead: 0 } };
  const root = request.rootUri.replace(/\/$/, ''), directories = new Set<string>([root]);
  for (const source of request.sourceUris) {
    if (!source.startsWith(root + '/')) continue;
    let directory = buildDirectory(source);
    while (directory === root || directory.startsWith(root + '/')) {
      if(directories.size>=20_000){result.issues.push({code:'discovery-limited',message:'Build discovery reached 20,000 ancestor directories'});break;}
      directories.add(directory); if (directory === root) break;
      directory = buildDirectory(directory);
    }
    if(directories.size>=20_000)break;
  }
  let visits = 0;
  const add = (uri: string, explicit = false) => {
    if (!result.candidates.includes(uri)) result.candidates.push(uri);
    const name = decodeURIComponent(uri.split('/').pop()!);
    if (!explicit && !/^(?:GNUmakefile|[Mm]akefile)$|\.(?:sh|bat|cmd)$/i.test(name)) return;
    const dialect = /\.(?:bat|cmd)$/i.test(name) ? 'cmd' : /\.sh$/i.test(name) ? 'sh' : 'make';
    result.entries.push({ id: fingerprintBuildInput([root, uri]), rootUri: root, entryUri: uri, cwdUri: root, dialect, args: [], evidence: [] });
  };
  for (const directory of directories) {
    if (shouldCancel?.()) { result.issues.push({ code: 'cancelled', message: 'Build discovery cancelled' }); break; }
    result.counts.directories++; result.dependencies.push(directory);
    let entries: Awaited<ReturnType<BuildFileSystem['list']>>;
    try { entries = await fs.list(directory); }
    catch { result.issues.push({ code: 'unreadable-directory', message: `Cannot inspect ${directory}` }); continue; }
    for (const entry of entries) {
      if (++visits > 20_000) break;
      if (entry.kind !== 'file') continue;
      const name = decodeURIComponent(entry.uri.split('/').pop()!);
      if (/^(?:GNUmakefile|[Mm]akefile)$|\.mk$/i.test(name) || directory === root && /\.(?:sh|bat|cmd)$/i.test(name)) add(entry.uri);
    }
    if (visits > 20_000) { result.issues.push({ code: 'discovery-limited', message: 'Build discovery visited 20,000 entries' }); break; }
  }
  if (request.explicitEntryUri && !result.entries.some(e => e.entryUri === request.explicitEntryUri)) add(request.explicitEntryUri, true);
  return result;
}
