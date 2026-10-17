import * as vscode from 'vscode';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { FileAnalysis } from './model';
import { RelationIndex } from './relations';

export class WorkspaceIndex implements vscode.Disposable {
  readonly index = new RelationIndex();
  readonly changed = new vscode.EventEmitter<void>();
  readonly ready: Promise<void>;
  status = 'Preparing C index…';
  failures = new Map<string, string>();
  private worker: Worker;
  private requests = new Map<number, { resolve: (file: FileAnalysis) => void; reject: (error: Error) => void }>();
  private jobs = new Set<Promise<void>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private versions = new Map<string, number>();
  private disposables: vscode.Disposable[] = [];
  private serial = 0;
  private epoch = 0;
  private disposed = false;
  private workerError?: Error;
  get skipInactive() { return vscode.workspace.getConfiguration('cRelation').get<boolean>('skipInactive', true); }
  constructor(extensionPath: string) {
    const assets = path.join(extensionPath, 'dist');
    this.worker = new Worker(path.join(assets, 'analysis-worker.cjs'), { workerData: { assets } });
    this.worker.on('message', ({ id, result, error }) => {
      const request = this.requests.get(id);
      this.requests.delete(id);
      if (error) request?.reject(new Error(error)); else request?.resolve(result);
    });
    this.worker.on('error', error => {
      this.workerError = error;
      for (const request of this.requests.values()) request.reject(error);
      this.requests.clear();
      this.status = `Analysis unavailable: ${error.message}`;
      this.changed.fire();
    });
    const watch = vscode.workspace.createFileSystemWatcher('**/*.{c,h}');
    this.disposables.push(watch, watch.onDidCreate(uri => this.schedule(uri)), watch.onDidChange(uri => this.schedule(uri)),
      watch.onDidDelete(uri => this.remove(uri)),
      vscode.workspace.onDidChangeTextDocument(event => { if (event.contentChanges.length) this.schedule(event.document.uri); }),
      vscode.workspace.onDidCloseTextDocument(document => this.schedule(document.uri)),
      vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('cRelation.skipInactive')) void this.reindex(); }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.reindex()));
    this.ready = this.reindex();
  }
  private eligible(uri: vscode.Uri) {
    return /\.[ch]$/i.test(uri.path) && !!vscode.workspace.getWorkspaceFolder(uri) &&
      !/\/(?:node_modules|\.git|\.vscode-test)\//.test(uri.path);
  }
  private remove(uri: vscode.Uri) {
    const key = uri.toString();
    this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
    clearTimeout(this.timers.get(key)); this.timers.delete(key);
    this.index.remove(key); this.failures.delete(key); this.changed.fire();
  }
  private schedule(uri: vscode.Uri) {
    if (this.disposed || !this.eligible(uri)) return;
    const key = uri.toString();
    // Invalidate in-flight results immediately, even during the debounce period.
    this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => { this.timers.delete(key); void this.enqueue(uri); }, 100));
  }
  private enqueue(uri: vscode.Uri) {
    const job = this.analyze(uri);
    this.jobs.add(job);
    void job.finally(() => this.jobs.delete(job));
    return job;
  }
  private async analyze(uri: vscode.Uri) {
    const key = uri.toString(), epoch = this.epoch;
    const version = (this.versions.get(key) ?? 0) + 1;
    this.versions.set(key, version);
    try {
      if (this.workerError) throw this.workerError;
      // Opening every file as an editor document causes cache eviction and close/reopen loops.
      const doc = vscode.workspace.textDocuments.find(document => !document.isClosed && document.uri.toString() === key);
      const text = doc ? doc.getText() : Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      if (text.length > 2_000_000) throw new Error('File exceeds the 2,000,000 character analysis limit');
      const id = ++this.serial;
      const result = await new Promise<FileAnalysis>((resolve, reject) => {
        this.requests.set(id, { resolve, reject });
        this.worker.postMessage({ id, uri: key, text, skip: this.skipInactive });
      });
      if (this.disposed || epoch !== this.epoch || version !== this.versions.get(key)) return;
      this.index.update(result); this.failures.delete(key); this.changed.fire();
    } catch (error) {
      if (this.disposed || epoch !== this.epoch || version !== this.versions.get(key)) return;
      this.index.remove(key); this.failures.set(key, String(error)); this.changed.fire();
    }
  }
  async reindex() {
    const epoch = ++this.epoch;
    this.index.clear(); this.failures.clear();
    this.status = 'Indexing C sources…'; this.changed.fire();
    try {
      const uris = await vscode.workspace.findFiles('**/*.{c,h}', '**/{node_modules,.git,.vscode-test}/**', 10001);
      for (const uri of uris.slice(0, 10000)) {
        if (this.disposed || epoch !== this.epoch) return;
        await this.enqueue(uri);
      }
      if (epoch === this.epoch) {
        this.status = uris.length > 10000 ? 'Partial index: 10,000 file limit reached' : 'Index ready';
        this.changed.fire();
      }
    } catch (error) { this.status = `Index error: ${String(error)}`; this.changed.fire(); }
  }
  async whenIdle() {
    while (this.jobs.size || this.timers.size || this.status.startsWith('Indexing')) {
      await Promise.all([...this.jobs]);
      if (this.jobs.size || this.timers.size || this.status.startsWith('Indexing')) await new Promise(r => setTimeout(r, 30));
    }
  }
  dispose() {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const request of this.requests.values()) request.reject(new Error('Analysis disposed'));
    this.requests.clear();
    void this.worker.terminate();
    this.disposables.forEach(d => d.dispose()); this.changed.dispose();
  }
}
