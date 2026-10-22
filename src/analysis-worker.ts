import { parentPort, threadId, workerData } from 'node:worker_threads';
import path from 'node:path';
import { getHeapStatistics } from 'node:v8';
import { createAnalyzer } from './analyzer';
import { FileAnalysis } from './model';
import { AnalysisPhase, WorkerDiagnostics } from './diagnostics';
import { AnalysisCache, CachedAnalysis } from './analysis-cache';
import { IncrementalAnalysis } from './incremental-analysis';
const analyzer = createAnalyzer(path.join(workerData.assets, 'web-tree-sitter.wasm'), path.join(workerData.assets, 'tree-sitter-c.wasm'));
type Request = { id: number; uri: string; text: string; skip: boolean; expandMacros?: boolean; type?: 'analyze' }
  | { type: 'derive'; id: number; analyzeCallbacks?: boolean; versions: [string, number, number][] }
  | { type: 'cache-init'; id: number; directory: string; key: string }
  | { type: 'cache-restore'; id: number; uri: string; text: string; skip: boolean; expandMacros?: boolean }
  | { type: 'cache-validate'; id: number; versions: [string, number, number][]; analyzeCallbacks?: boolean }
  | { type: 'cache-save'; id: number; versions: [string, number, number][] }
  | { type: 'remove'; uri: string } | { type: 'reset' } | { type: 'diagnostics' };
const raw = new Map<string, { id: number; file: FileAnalysis; skip: boolean; expandMacros: boolean }>();
const stamps = new WeakMap<FileAnalysis, number>(); let serial = 0;
const forIndex = (file: FileAnalysis): FileAnalysis => ({ ...file, programs: undefined, initializers: undefined, argumentPrograms: undefined, statementConditions: undefined });
let cache: AnalysisCache | undefined;
const incremental = new IncrementalAnalysis();
let savedVersions = new Map<string, { id: number; stamp: number }>();
type Snapshot = Map<string, { id: number; stamp: number; file: FileAnalysis }>;
const restored: Snapshot = new Map();
let derivedSnapshot: Snapshot | undefined;
function matches(versions: [string, number, number][], snapshot: Snapshot | undefined) {
  return !!snapshot && snapshot.size === versions.length && raw.size === versions.length && new Set(versions.map(([uri]) => uri)).size === versions.length &&
    versions.every(([uri, id, stamp]) => raw.get(uri)?.id === id && snapshot.get(uri)?.id === id && snapshot.get(uri)?.stamp === stamp);
}
let queue = Promise.resolve();
let run = 0, lastReport = 0;
function memory() {
  const heap = getHeapStatistics();
  return { at: Date.now(), heapUsed: heap.used_heap_size, heapLimit: heap.heap_size_limit, external: heap.external_memory };
}
function freshDiagnostics(): WorkerDiagnostics {
  const sample = memory();
  return { run: `${threadId}:${++run}`, phase: 'idle', sample, peakHeap: sample.heapUsed, phases: {},
    counts: { files: 0, sourceChars: 0, references: 0, programs: 0, macroFiles: 0 } };
}
let diagnostics = freshDiagnostics();
function report(force = false) {
  const sample = diagnostics.sample = memory();
  diagnostics.peakHeap = Math.max(diagnostics.peakHeap, sample.heapUsed);
  if (force || sample.at - lastReport >= 500) {
    lastReport = sample.at;
    parentPort!.postMessage({ type: 'diagnostics', diagnostics });
  }
}
function phase(value: AnalysisPhase | 'idle') {
  if (diagnostics.phase === value) return;
  const sample = memory(), previous = diagnostics.phase;
  diagnostics.peakHeap = Math.max(diagnostics.peakHeap, sample.heapUsed);
  if (previous !== 'idle') diagnostics.phases[previous]!.after = sample;
  diagnostics.phase = value;
  if (value !== 'idle') diagnostics.phases[value] = { before: sample };
  report(true);
}
function count(file: FileAnalysis, sign: number) {
  const counts = diagnostics.counts;
  counts.files += sign; counts.sourceChars += sign * file.text.length;
  counts.references += sign * file.references.length; counts.programs += sign * (file.programs?.length ?? 0);
  counts.macroFiles += sign * Number(file.expandMacros !== false);
}
function remove(uri: string) {
  const previous = raw.get(uri); if (previous) count(previous.file, -1);
  raw.delete(uri); restored.delete(uri); derivedSnapshot = undefined;
}
const memoryPressure = () => {
  report();
  // Reserve room for graph indexes, literal arguments and the next source edit.
  const limited = diagnostics.sample.heapUsed > diagnostics.sample.heapLimit * 0.6;
  if (limited && !diagnostics.firstLimit) {
    diagnostics.firstLimit = { phase: diagnostics.phase, sample: diagnostics.sample }; report(true);
  }
  return limited;
};
parentPort!.on('message', (request: Request) => {
  queue = queue.then(async () => {
    if (request.type === 'remove') { remove(request.uri); report(); return; }
    if (request.type === 'diagnostics') { report(true); return; }
    try {
      const parser = await analyzer;
      if (request.type === 'reset') { raw.clear(); restored.clear(); savedVersions.clear(); derivedSnapshot = undefined; incremental.clear(); parser.reset(); diagnostics = freshDiagnostics(); report(true); return; }
      if (request.type === 'cache-init') {
        cache = await AnalysisCache.open(request.directory, request.key); restored.clear(); savedVersions.clear(); derivedSnapshot = undefined;
        parentPort!.postMessage({ id: request.id, result: { state: cache.state,
          ...(cache.reason ? { reason: cache.reason } : {}), ...(cache.savedVersion === undefined ? {} : { savedVersion: cache.savedVersion }) } }); return;
      }
      if (request.type === 'cache-restore') {
        const record = !memoryPressure() ? await cache?.restore(request.uri, request.text, request.skip, request.expandMacros !== false) : undefined;
        if (!record) { parentPort!.postMessage({ id: request.id, result: { hit: false, ...(cache?.state === 'invalid' ? { invalid: true } : {}) } }); return; }
        remove(request.uri); count(record.raw, 1);
        raw.set(request.uri, { id: request.id, file: record.raw, skip: record.skip, expandMacros: record.expandMacros });
        const stamp = ++serial; stamps.set(record.derived, stamp);
        restored.set(request.uri, { id: request.id, stamp, file: record.derived });
        parentPort!.postMessage({ id: request.id, result: { hit: true, file: forIndex(record.derived), stamp } }); report(true); return;
      }
      if (request.type === 'cache-validate') {
        const valid = !!cache?.matches(request.versions.map(([uri]) => uri)) && matches(request.versions, restored);
        if (valid) {
          derivedSnapshot = new Map(restored);
          savedVersions = new Map(request.versions.map(([uri, id, stamp]) => [uri, { id, stamp }]));
          incremental.seed(request.versions.map(([uri]) => raw.get(uri)!.file), request.versions.map(([uri]) => restored.get(uri)!.file), request.analyzeCallbacks);
        }
        parentPort!.postMessage({ id: request.id, result: { valid } }); return;
      }
      if (request.type === 'cache-save') {
        let result: { saved: boolean; reason?: string } = { saved: false, reason: 'No current derived snapshot' };
        if (cache && matches(request.versions, derivedSnapshot)) {
          const versions = request.versions;
          function* records(): Iterable<CachedAnalysis> {
            for (const [uri] of versions) {
              const input = raw.get(uri)!;
              yield { raw: input.file, derived: derivedSnapshot!.get(uri)!.file, skip: input.skip, expandMacros: input.expandMacros };
            }
          }
          const reusable = new Set(versions.filter(([uri, id, stamp]) => savedVersions.get(uri)?.id === id && savedVersions.get(uri)?.stamp === stamp).map(([uri]) => uri));
          result = await cache.save(records(), reusable);
          if (result.saved) savedVersions = new Map(versions.map(([uri, id, stamp]) => [uri, { id, stamp }]));
        }
        parentPort!.postMessage({ id: request.id, result }); return;
      }
      if (request.type === 'derive') {
        if (request.versions.some(([uri, id]) => raw.get(uri)?.id !== id)) {
          parentPort!.postMessage({ id: request.id, result: { stale: true, files: [] } }); return;
        }
        const files = request.versions.map(([uri]) => raw.get(uri)!.file);
        const active = new Set(request.versions.map(([uri]) => uri));
        for (const uri of raw.keys()) if (!active.has(uri)) remove(uri);
        const changed: FileAnalysis[] = [], versions: [string, number][] = [];
        const derived = incremental.derive(files, dirty => parser.derive(dirty, memoryPressure, phase, request.analyzeCallbacks), request.analyzeCallbacks);
        const snapshot: Snapshot = new Map();
        phase('transfer');
        derived.forEach((file, i) => {
          let stamp = file === files[i] ? -request.versions[i][1] : stamps.get(file);
          if (stamp === undefined) { stamp = ++serial; stamps.set(file, stamp); }
          snapshot.set(file.uri, { id: request.versions[i][1], stamp, file });
          if (stamp !== request.versions[i][2]) { changed.push(forIndex(file)); versions.push([file.uri, stamp]); }
        });
        restored.clear(); derivedSnapshot = snapshot;
        parentPort!.postMessage({ id: request.id, result: { stale: false, files: changed, versions } });
        phase('idle');
      } else {
        restored.clear(); derivedSnapshot = undefined;
        phase('sources');
        if (memoryPressure()) throw new Error('Source analysis memory budget reached. Narrow Include/Exclude, then Rebuild index.');
        const result = { ...parser.analyze(request.uri, request.text, request.skip), expandMacros: request.expandMacros };
        remove(request.uri); count(result, 1);
        raw.set(request.uri, { id: request.id, file: result, skip: request.skip, expandMacros: request.expandMacros !== false });
        parentPort!.postMessage({ id: request.id, result: forIndex(result) });
        report();
      }
    } catch (error) {
      report(true);
      if (request.type !== 'reset') parentPort!.postMessage({ id: request.id, error: String(error) });
    }
  });
});
