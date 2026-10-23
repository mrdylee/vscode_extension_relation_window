import { FileAnalysis } from './model';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, link, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface CachedAnalysis { raw: FileAnalysis; derived: FileAnalysis; skip: boolean; expandMacros: boolean }
interface Entry { uri: string; name: string; digest: string; source: string; skip: boolean; expandMacros: boolean }
// Bump only when parsing, macro expansion, callback derivation or stored analysis
// semantics change. UI, packaging and other compatible releases keep this value.
export const ANALYSIS_CACHE_VERSION = 9;
export type CacheIncompatibility = 'analysis-version' | 'workspace-settings' | 'legacy-format';
interface Manifest { legacyRoots?: string[]; schema: 2; analysisVersion: number; key: string; generation: string; previous?: string; entries: Entry[]; callbackPolicy?: string; retryable?: boolean }
const workerFields = new Set(['text', 'programs', 'initializers', 'argumentPrograms', 'registrationPrograms', 'registrationInitializers', 'statementConditions']);
const maxFiles = 10_000, maxRecordBytes = 64 * 1024 * 1024, maxGenerationBytes = 1024 * 1024 * 1024;
const maxManifestBytes = 4 * 1024 * 1024;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const digestPattern = /^[a-f0-9]{64}$/;
const generationPattern = /^generation-[a-f0-9-]{36}$/;
async function boundedRead(filename: string, limit: number) {
  if ((await stat(filename)).size > limit) throw new Error('Analysis cache size limit');
  const data = await readFile(filename, 'utf8');
  if (Buffer.byteLength(data) > limit) throw new Error('Analysis cache size limit');
  return data;
}
function validFile(value: FileAnalysis, uri: string) {
  return value?.uri === uri && typeof value.text === 'string' && Array.isArray(value.symbols) &&
    Array.isArray(value.references) && Array.isArray(value.includes) && Array.isArray(value.issues);
}
export class AnalysisCache {
  legacyRoots: string[] = [];
  state: 'missing' | 'ready' | 'incompatible' | 'invalid' = 'missing';
  reason?: CacheIncompatibility;
  savedVersion?: number;
  private manifest?: Manifest;
  private entries = new Map<string, Entry>();
  private constructor(private directory: string, private key: string, private analysisVersion: number) {}
  static async open(directory: string, key: string, analysisVersion = ANALYSIS_CACHE_VERSION) {
    const cache = new AnalysisCache(directory, key, analysisVersion);
    try {
      const data = JSON.parse(await boundedRead(path.join(directory, 'manifest.json'), maxManifestBytes)) as Manifest;
      if (!Number.isSafeInteger(data.schema) || data.schema < 1 || typeof data.key !== 'string' || !generationPattern.test(data.generation) ||
        (data.previous !== undefined && (!generationPattern.test(data.previous) || data.previous === data.generation)) ||
        !Array.isArray(data.entries) || data.entries.length > maxFiles || data.entries.some(entry =>
          !entry || typeof entry.uri !== 'string' || !digestPattern.test(entry.digest) || !digestPattern.test(entry.source) ||
          entry.name !== hash(entry.uri) + '.json' || typeof entry.skip !== 'boolean' || typeof entry.expandMacros !== 'boolean') ||
        new Set(data.entries.map(entry => entry.uri)).size !== data.entries.length) throw new Error('Invalid analysis cache');
      if (data.schema !== 2) { cache.state = 'incompatible'; cache.reason = 'legacy-format'; return cache; }
      if (!Number.isSafeInteger(data.analysisVersion) || data.analysisVersion < 1) throw new Error('Invalid analysis cache version');
      if (data.callbackPolicy !== undefined && typeof data.callbackPolicy !== 'string') throw new Error('Invalid callback policy');
      if (data.retryable !== undefined && typeof data.retryable !== 'boolean') throw new Error('Invalid callback retry state');
      cache.savedVersion = data.analysisVersion;
      if (data.analysisVersion !== analysisVersion || data.key !== key) {
        cache.state = 'incompatible'; cache.reason = data.analysisVersion !== analysisVersion ? 'analysis-version' : 'workspace-settings'; return cache;
      }
      cache.manifest = data; cache.entries = new Map(data.entries.map(entry => [entry.uri, entry])); cache.state = 'ready';
    } catch (error) { cache.state = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'invalid'; }
    return cache;
  }
  async restore(uri: string, text: string, skip: boolean, expandMacros: boolean, propagateCallbacks = true): Promise<CachedAnalysis | undefined> {
    const entry = this.entries.get(uri);
    if (this.state !== 'ready' || !this.manifest || !entry || entry.source !== hash(text) || entry.skip !== skip || entry.expandMacros !== expandMacros) return;
    try {
      const data = await boundedRead(path.join(this.directory, this.manifest.generation, entry.name), maxRecordBytes);
      if (hash(data) !== entry.digest) throw new Error('Analysis cache checksum mismatch');
      const record = JSON.parse(data) as CachedAnalysis & { removed?: (keyof FileAnalysis)[] };
      record.derived = { ...record.raw, ...record.derived, text: record.raw?.text,
        programs: undefined, initializers: undefined, argumentPrograms: undefined, registrationPrograms: undefined, registrationInitializers: undefined, statementConditions: undefined };
      for (const key of record.removed ?? []) delete record.derived[key];
      if (!validFile(record.raw, uri) || !validFile(record.derived, uri) || record.raw.text !== text ||
        record.skip !== skip || record.expandMacros !== expandMacros || (record.raw.analysisPolicy?.propagateCallbacks ?? true) !== propagateCallbacks) throw new Error('Invalid analysis cache record');
      return record;
    } catch { this.state = 'invalid'; return; }
  }
  matches(uris: string[]) {
    // Recompute relationships from old fixed-deadline caches while retaining IR.
    return this.state === 'ready' && this.manifest?.callbackPolicy === 'manual-stop' && !this.manifest.retryable &&
      uris.length === this.entries.size && new Set(uris).size === uris.length && uris.every(uri => this.entries.has(uri));
  }
  async save(records: Iterable<CachedAnalysis>, reuseUris: ReadonlySet<string> = new Set()): Promise<{ saved: boolean; reason?: string }> {
    const generation = `generation-${randomUUID()}`, directory = path.join(this.directory, generation);
    const temporary = path.join(this.directory, `manifest-${randomUUID()}.tmp`);
    const previous = this.manifest?.generation;
    const retired = this.manifest?.previous;
    let committed = false;
    try {
      await mkdir(directory, { recursive: true });
      const entries: Entry[] = [], seen = new Set<string>(); let bytes = 0, retryable = false;
      for (const record of records) {
        if (seen.has(record.raw.uri) || seen.size >= maxFiles || record.derived.uri !== record.raw.uri || record.derived.text !== record.raw.text)
          throw new Error('Invalid analysis cache generation');
        seen.add(record.raw.uri);
        retryable ||= record.derived.callbackDiagnostics?.some(detail => ['cancelled', 'time', 'memory', 'work'].includes(detail.kind)) ?? false;
        retryable ||= record.derived.issues.some(issue => /analysis cancelled|memory budget|analysis (?:time )?budget|work limit/i.test(issue));
        const cached = this.entries.get(record.raw.uri);
        // The Worker proves both raw input and derived identity unchanged.
        if (reuseUris.has(record.raw.uri) && previous && cached && cached.skip === record.skip && cached.expandMacros === record.expandMacros) {
          const source = path.join(this.directory, previous, cached.name), destination = path.join(directory, cached.name);
          const size = (await stat(source)).size; bytes += size;
          if (size > maxRecordBytes || bytes > maxGenerationBytes) throw new Error('Analysis cache size limit');
          await link(source, destination).catch(() => copyFile(source, destination));
          entries.push(cached); continue;
        }
        // Preserve shared arrays between raw and derived data when hydrating.
        const derived: Partial<FileAnalysis> = {}, removed: (keyof FileAnalysis)[] = [];
        for (const key of Object.keys(record.derived) as (keyof FileAnalysis)[]) {
          if (workerFields.has(key) || record.derived[key] === record.raw[key]) continue;
          if (record.derived[key] === undefined) removed.push(key);
          else (derived as Record<string, unknown>)[key] = record.derived[key];
        }
        const data = JSON.stringify({ ...record, derived, removed });
        const size = Buffer.byteLength(data); bytes += size;
        if (size > maxRecordBytes || bytes > maxGenerationBytes) throw new Error('Analysis cache size limit');
        const name = hash(record.raw.uri) + '.json';
        await writeFile(path.join(directory, name), data);
        entries.push({ uri: record.raw.uri, name, digest: hash(data), source: hash(record.raw.text), skip: record.skip, expandMacros: record.expandMacros });
      }
      const manifest: Manifest = { legacyRoots: this.legacyRoots, schema: 2, analysisVersion: this.analysisVersion, key: this.key, generation, previous, entries, callbackPolicy: 'manual-stop', retryable };
      const serialized = JSON.stringify(manifest);
      if (Buffer.byteLength(serialized) > maxManifestBytes) throw new Error('Analysis cache manifest size limit');
      await writeFile(temporary, serialized);
      await rename(temporary, path.join(this.directory, 'manifest.json'));
      committed = true; this.manifest = manifest; this.entries = new Map(entries.map(entry => [entry.uri, entry])); this.state = 'ready';
      this.reason = undefined; this.savedVersion = this.analysisVersion;
      // Prune only a known superseded ancestor, never another writer's staging
      // directory. Interrupted process orphans can remain until manual cleanup.
      if (retired) await rm(path.join(this.directory, retired), { recursive: true, force: true }).catch(() => {});
      return { saved: true };
    } catch (error) { return committed ? { saved: true } : { saved: false, reason: String(error) }; }
    finally {
      await rm(temporary, { force: true }).catch(() => {});
      if (!committed) await rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  }
}
