import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import { createAnalyzer } from './analyzer';
const analyzer = createAnalyzer(path.join(workerData.assets, 'web-tree-sitter.wasm'), path.join(workerData.assets, 'tree-sitter-c.wasm'));
parentPort!.on('message', async (request: { id: number; uri: string; text: string; skip: boolean }) => {
  try {
    const result = (await analyzer).analyze(request.uri, request.text, request.skip);
    parentPort!.postMessage({ id: request.id, result });
  } catch (error) {
    parentPort!.postMessage({ id: request.id, error: String(error) });
  }
});
