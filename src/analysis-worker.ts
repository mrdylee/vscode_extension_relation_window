import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import { getHeapStatistics } from 'node:v8';
import { createAnalyzer } from './analyzer';
import { FileAnalysis } from './model';
const analyzer = createAnalyzer(path.join(workerData.assets, 'web-tree-sitter.wasm'), path.join(workerData.assets, 'tree-sitter-c.wasm'));
type Request = { id: number; uri: string; text: string; skip: boolean; expandMacros?: boolean; type?: 'analyze' }
  | { type: 'derive'; id: number; versions: [string, number, number][] }
  | { type: 'remove'; uri: string } | { type: 'reset' };
const raw = new Map<string, { id: number; file: FileAnalysis }>();
const stamps = new WeakMap<FileAnalysis, number>(); let serial = 0;
const forIndex = (file: FileAnalysis): FileAnalysis => ({ ...file, programs: undefined, initializers: undefined, argumentPrograms: undefined, statementConditions: undefined });
let queue = Promise.resolve();
const memoryPressure = () => {
  const heap = getHeapStatistics();
  // Reserve room for graph indexes, literal arguments and the next source edit.
  return heap.used_heap_size > heap.heap_size_limit * 0.6;
};
parentPort!.on('message', (request: Request) => {
  queue = queue.then(async () => {
    if (request.type === 'reset') { raw.clear(); return; }
    if (request.type === 'remove') { raw.delete(request.uri); return; }
    try {
      const parser = await analyzer;
      if (request.type === 'derive') {
        if (request.versions.some(([uri, id]) => raw.get(uri)?.id !== id)) {
          parentPort!.postMessage({ id: request.id, result: { stale: true, files: [] } }); return;
        }
        const files = request.versions.map(([uri]) => raw.get(uri)!.file);
        const active = new Set(request.versions.map(([uri]) => uri));
        for (const uri of raw.keys()) if (!active.has(uri)) raw.delete(uri);
        const changed: FileAnalysis[] = [], versions: [string, number][] = [];
        parser.derive(files, memoryPressure).forEach((file, i) => {
          let stamp = file === files[i] ? -request.versions[i][1] : stamps.get(file);
          if (stamp === undefined) { stamp = ++serial; stamps.set(file, stamp); }
          if (stamp !== request.versions[i][2]) { changed.push(forIndex(file)); versions.push([file.uri, stamp]); }
        });
        parentPort!.postMessage({ id: request.id, result: { stale: false, files: changed, versions } });
      } else {
        if (memoryPressure()) throw new Error('Source analysis memory budget reached. Narrow Include/Exclude, then Rebuild index.');
        const result = { ...parser.analyze(request.uri, request.text, request.skip), expandMacros: request.expandMacros };
        raw.set(request.uri, { id: request.id, file: result });
        parentPort!.postMessage({ id: request.id, result: forIndex(result) });
      }
    } catch (error) {
      parentPort!.postMessage({ id: request.id, error: String(error) });
    }
  });
});
