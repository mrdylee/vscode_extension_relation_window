import { parentPort, threadId, workerData } from 'node:worker_threads';
import path from 'node:path';
import { getHeapStatistics } from 'node:v8';
import { createAnalyzer } from './analyzer';
import { FileAnalysis } from './model';
import { AnalysisPhase, WorkerDiagnostics } from './diagnostics';
const analyzer = createAnalyzer(path.join(workerData.assets, 'web-tree-sitter.wasm'), path.join(workerData.assets, 'tree-sitter-c.wasm'));
type Request = { id: number; uri: string; text: string; skip: boolean; expandMacros?: boolean; type?: 'analyze' }
  | { type: 'derive'; id: number; versions: [string, number, number][] }
  | { type: 'remove'; uri: string } | { type: 'reset' } | { type: 'diagnostics' };
const raw = new Map<string, { id: number; file: FileAnalysis }>();
const stamps = new WeakMap<FileAnalysis, number>(); let serial = 0;
const forIndex = (file: FileAnalysis): FileAnalysis => ({ ...file, programs: undefined, initializers: undefined, argumentPrograms: undefined, statementConditions: undefined });
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
  raw.delete(uri);
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
    if (request.type === 'reset') { raw.clear(); diagnostics = freshDiagnostics(); report(true); return; }
    if (request.type === 'remove') { remove(request.uri); report(); return; }
    if (request.type === 'diagnostics') { report(true); return; }
    try {
      const parser = await analyzer;
      if (request.type === 'derive') {
        if (request.versions.some(([uri, id]) => raw.get(uri)?.id !== id)) {
          parentPort!.postMessage({ id: request.id, result: { stale: true, files: [] } }); return;
        }
        const files = request.versions.map(([uri]) => raw.get(uri)!.file);
        const active = new Set(request.versions.map(([uri]) => uri));
        for (const uri of raw.keys()) if (!active.has(uri)) remove(uri);
        const changed: FileAnalysis[] = [], versions: [string, number][] = [];
        const derived = parser.derive(files, memoryPressure, phase);
        phase('transfer');
        derived.forEach((file, i) => {
          let stamp = file === files[i] ? -request.versions[i][1] : stamps.get(file);
          if (stamp === undefined) { stamp = ++serial; stamps.set(file, stamp); }
          if (stamp !== request.versions[i][2]) { changed.push(forIndex(file)); versions.push([file.uri, stamp]); }
        });
        parentPort!.postMessage({ id: request.id, result: { stale: false, files: changed, versions } });
        phase('idle');
      } else {
        phase('sources');
        if (memoryPressure()) throw new Error('Source analysis memory budget reached. Narrow Include/Exclude, then Rebuild index.');
        const result = { ...parser.analyze(request.uri, request.text, request.skip), expandMacros: request.expandMacros };
        remove(request.uri); count(result, 1);
        raw.set(request.uri, { id: request.id, file: result });
        parentPort!.postMessage({ id: request.id, result: forIndex(result) });
        report();
      }
    } catch (error) {
      report(true);
      parentPort!.postMessage({ id: request.id, error: String(error) });
    }
  });
});
