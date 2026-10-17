import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import { createAnalyzer } from './analyzer';
import { FileAnalysis } from './model';
const analyzer = createAnalyzer(path.join(workerData.assets, 'web-tree-sitter.wasm'), path.join(workerData.assets, 'tree-sitter-c.wasm'));
type Request = { id: number; uri: string; text: string; skip: boolean; type?: 'analyze' }
  | { type: 'derive'; id: number; versions: [string, number, number][] }
  | { type: 'remove'; uri: string } | { type: 'reset' };
const raw = new Map<string, { id: number; file: FileAnalysis }>();
const stamps = new WeakMap<FileAnalysis, number>(); let serial = 0;
let queue = Promise.resolve();
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
        parser.derive(files).forEach((file, i) => {
          let stamp = file === files[i] ? -request.versions[i][1] : stamps.get(file);
          if (stamp === undefined) { stamp = ++serial; stamps.set(file, stamp); }
          if (stamp !== request.versions[i][2]) { changed.push(file); versions.push([file.uri, stamp]); }
        });
        parentPort!.postMessage({ id: request.id, result: { stale: false, files: changed, versions } });
      } else {
        const result = parser.analyze(request.uri, request.text, request.skip);
        raw.set(request.uri, { id: request.id, file: result });
        parentPort!.postMessage({ id: request.id, result });
      }
    } catch (error) {
      parentPort!.postMessage({ id: request.id, error: String(error) });
    }
  });
});
