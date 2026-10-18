import * as vscode from 'vscode';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { FileAnalysis } from './model';
import { RelationIndex } from './relations';
import { Minimatch } from 'minimatch';
import { getHeapStatistics } from 'node:v8';
import { Diagnostics, WorkerDiagnostics } from './diagnostics';

const builtInExcludes = ['**/node_modules/**', '**/.git/**', '**/.vscode-test/**'];
const maxFiles = 10_000;

export class WorkspaceIndex implements vscode.Disposable {
  readonly index = new RelationIndex();
  readonly changed = new vscode.EventEmitter<void>();
  readonly diagnosticsChanged = new vscode.EventEmitter<void>();
  readonly ready: Promise<void>;
  status = 'Preparing C index…';
  failures = new Map<string, string>();
  private worker!: Worker;
  private requests = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private rawVersions = new Map<string, number>();
  private appliedDerived = new Map<string, number>();
  private revision = 0;
  private derivedRevision = -1;
  private deriving?: Promise<void>;
  private indexing = false;
  private jobs = new Set<Promise<void>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private versions = new Map<string, number>();
  private reservedFiles = new Set<string>();
  private fileLimitReached = false;
  private disposables: vscode.Disposable[] = [];
  private serial = 0;
  private epoch = 0;
  private disposed = false;
  private workerError?: Error;
  private workerDiagnostics?: WorkerDiagnostics;
  get diagnostics(): Diagnostics {
    const heap = getHeapStatistics();
    return { environment: `${process.platform} ${process.arch} · ${vscode.env.remoteName ?? 'local'} · VS Code ${vscode.version}`,
      host: { at: Date.now(), heapUsed: heap.used_heap_size, heapLimit: heap.heap_size_limit, external: heap.external_memory },
      worker: this.workerDiagnostics, workerError: this.workerError
        ? [(this.workerError as NodeJS.ErrnoException).code, this.workerError.message].filter(Boolean).join(': ') : undefined };
  }
  refreshDiagnostics() {
    this.diagnosticsChanged.fire();
    if (!this.disposed && !this.workerError) this.worker.postMessage({ type: 'diagnostics' });
  }
  private scopes = new Map<string, { include: string[]; exclude: string[]; included: Minimatch[]; excluded: Minimatch[]; macros: Minimatch[] }>();
  get skipInactive() { return vscode.workspace.getConfiguration('cRelation').get<boolean>('skipInactive', true); }
  private startWorker() {
    const assets = path.join(this.extensionPath, 'dist');
    const worker = new Worker(path.join(assets, 'analysis-worker.cjs'), { workerData: { assets } });
    this.worker = worker; this.workerError = undefined; this.workerDiagnostics = undefined;
    worker.on('message', ({ id, result, error, type, diagnostics }) => {
      if (this.disposed || this.worker !== worker) return;
      if (type === 'diagnostics') { this.workerDiagnostics = diagnostics; this.diagnosticsChanged.fire(); return; }
      const request = this.requests.get(id);
      this.requests.delete(id);
      if (error) request?.reject(new Error(error)); else request?.resolve(result);
    });
    const failed = (error: Error) => {
      if (this.disposed || this.worker !== worker || this.workerError) return;
      this.workerError = error;
      for (const request of this.requests.values()) request.reject(error);
      this.requests.clear();
      this.status = (error as NodeJS.ErrnoException).code === 'ERR_WORKER_OUT_OF_MEMORY'
        ? 'Analysis stopped: Worker ran out of memory. Narrow Include/Exclude, then Rebuild index.'
        : `Analysis unavailable: ${error.message}`;
      this.failures.set('worker', this.status);
      this.diagnosticsChanged.fire();
      this.changed.fire();
    };
    worker.on('error', failed);
    worker.on('exit', code => failed(new Error(`Analysis Worker exited unexpectedly (${code}). Rebuild index to retry.`)));
  }
  constructor(private extensionPath: string) {
    this.startWorker();
    const watch = vscode.workspace.createFileSystemWatcher('**/*.{c,h}');
    this.disposables.push(watch, watch.onDidCreate(uri => this.schedule(uri)), watch.onDidChange(uri => this.schedule(uri)),
      watch.onDidDelete(uri => this.remove(uri)),
      vscode.workspace.onDidChangeTextDocument(event => { if (event.contentChanges.length) this.schedule(event.document.uri); }),
      vscode.workspace.onDidCloseTextDocument(document => this.schedule(document.uri)),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('cRelation.skipInactive') || event.affectsConfiguration('cRelation.include') || event.affectsConfiguration('cRelation.exclude') ||
          event.affectsConfiguration('cRelation.macroExpansionFolders')) void this.reindex();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.reindex()));
    this.ready = this.reindex();
  }
  private scope(folder: vscode.WorkspaceFolder) {
    const key = folder.uri.toString();
    let value = this.scopes.get(key);
    if (!value) {
      const config = vscode.workspace.getConfiguration('cRelation', folder.uri);
      const include = config.get<string[]>('include', []), exclude = [...builtInExcludes, ...config.get<string[]>('exclude', [])];
      const match = (pattern: string) => new Minimatch(pattern, { dot: true, nonegate: true, nocomment: true, noext: true, nocase: process.platform === 'win32' });
      value = { include, exclude, included: include.map(match), excluded: exclude.map(match), macros: config.get<string[]>('macroExpansionFolders', ['**']).map(match) };
      this.scopes.set(key, value);
    }
    return value;
  }
  private eligible(uri: vscode.Uri) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!/\.[ch]$/i.test(uri.path) || !folder) return false;
    const scope = this.scope(folder), relative = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
    return (!scope.included.length || scope.included.some(matcher => matcher.match(relative))) &&
      !scope.excluded.some(matcher => matcher.match(relative));
  }
  private remove(uri: vscode.Uri) {
    const key = uri.toString();
    this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
    clearTimeout(this.timers.get(key)); this.timers.delete(key);
    this.index.remove(key); this.rawVersions.delete(key); this.appliedDerived.delete(key); this.revision++;
    this.reservedFiles.delete(key);
    this.worker.postMessage({ type: 'remove', uri: key });
    this.failures.delete(key); this.changed.fire();
    if (!this.indexing) void this.derive();
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
    if (this.disposed || !this.eligible(uri)) return Promise.resolve();
    const key = uri.toString();
    if (!this.reservedFiles.has(key) && this.reservedFiles.size >= maxFiles) {
      this.fileLimitReached = true;
      if (!this.indexing) this.status = this.completedStatus();
      this.changed.fire();
      return this.derive();
    }
    // Reserve before IO so simultaneous new files cannot exceed the limit.
    this.reservedFiles.add(key);
    const job = this.analyze(uri);
    this.jobs.add(job);
    void job.finally(() => { this.jobs.delete(job); if (!this.indexing && !this.jobs.size && !this.timers.size) void this.derive(); });
    return job;
  }
  private async analyze(uri: vscode.Uri) {
    if (this.disposed || !this.eligible(uri)) return;
    const key = uri.toString(), epoch = this.epoch;
    const version = (this.versions.get(key) ?? 0) + 1;
    this.versions.set(key, version);
    try {
      if (this.workerError) throw this.workerError;
      // Opening every file as an editor document causes cache eviction and close/reopen loops.
      const doc = vscode.workspace.textDocuments.find(document => !document.isClosed && document.uri.toString() === key);
      const text = doc ? doc.getText() : Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      if (this.disposed || epoch !== this.epoch || version !== this.versions.get(key)) return;
      if (this.workerError) throw this.workerError;
      if (text.length > 2_000_000) throw new Error('File exceeds the 2,000,000 character analysis limit');
      const folder = vscode.workspace.getWorkspaceFolder(uri)!;
      const expandMacros = this.scope(folder).macros.some(matcher => matcher.match(vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/')));
      const request = this.request<FileAnalysis>({ uri: key, text, skip: this.skipInactive, expandMacros });
      const result = await request.promise;
      if (this.disposed || epoch !== this.epoch || version !== this.versions.get(key)) return;
      this.rawVersions.set(key, request.id); this.appliedDerived.delete(key); this.revision++;
      this.index.update(result); this.failures.delete(key); this.changed.fire();
    } catch (error) {
      if (this.disposed || epoch !== this.epoch || version !== this.versions.get(key)) return;
      this.index.remove(key); this.rawVersions.delete(key); this.appliedDerived.delete(key); this.revision++;
      this.reservedFiles.delete(key);
      this.worker.postMessage({ type: 'remove', uri: key });
      this.failures.set(key, String(error)); this.changed.fire();
    }
  }
  private request<T>(message: object) {
    const id = ++this.serial;
    const promise = new Promise<T>((resolve, reject) => {
      this.requests.set(id, { resolve: value => resolve(value as T), reject });
      this.worker.postMessage({ ...message, id });
    });
    return { id, promise };
  }
  private completedStatus() {
    if (this.workerError) return this.status;
    if (this.failures.has('derived')) return 'Partial index: call analysis failed. See Analysis notices.';
    if ([...this.failures.values()].some(error => error.includes('memory budget')) ||
      [...this.index.files.values()].some(file => file.issues.some(issue => issue.includes('memory budget'))))
      return 'Partial index: memory budget reached. Narrow Include/Exclude, then Rebuild index.';
    return this.fileLimitReached ? 'Partial index: 10,000 file limit reached' : 'Index ready';
  }
  private derive(): Promise<void> {
    if (this.deriving) return this.deriving;
    if (this.disposed || this.workerError || this.indexing || this.jobs.size || this.timers.size || this.derivedRevision === this.revision) return Promise.resolve();
    this.deriving = (async () => {
      while (!this.disposed && !this.indexing && !this.jobs.size && !this.timers.size && this.derivedRevision !== this.revision) {
        const revision = this.revision;
        const versions = [...this.rawVersions].map(([uri, id]) => [uri, id, this.appliedDerived.get(uri) ?? -id]);
        const result = await this.request<{ stale: boolean; files: FileAnalysis[]; versions: [string, number][] }>({ type: 'derive', versions }).promise;
        if (this.disposed || revision !== this.revision) continue;
        if (result.stale) throw new Error('Analysis input changed unexpectedly. Rebuild index to retry.');
        for (const file of result.files) this.index.update(file);
        for (const [uri, stamp] of result.versions) this.appliedDerived.set(uri, stamp);
        this.derivedRevision = revision; this.failures.delete('derived');
        this.status = this.completedStatus();
        this.changed.fire();
      }
    })().catch(error => {
      if (!this.disposed) {
        this.failures.set('derived', `Call analysis: ${String(error)}`);
        this.status = this.completedStatus(); this.changed.fire();
      }
    }).finally(() => { this.deriving = undefined; });
    return this.deriving;
  }
  async reindex() {
    const epoch = ++this.epoch;
    this.indexing = true;
    if (this.workerError || this.status.includes('memory budget')) {
      await this.deriving;
      if (this.disposed || epoch !== this.epoch) return;
      for (const request of this.requests.values()) request.reject(new Error('Analysis restarted'));
      this.requests.clear();
      const previous = this.worker; this.startWorker(); await previous.terminate();
      if (this.disposed || epoch !== this.epoch) return;
    }
    this.rawVersions.clear(); this.appliedDerived.clear(); this.revision++;
    this.reservedFiles.clear(); this.fileLimitReached = false;
    this.worker.postMessage({ type: 'reset' });
    this.scopes.clear();
    this.index.clear(); this.failures.clear();
    this.status = 'Indexing C sources…'; this.changed.fire();
    try {
      const uris: vscode.Uri[] = [];
      const seen = new Set<string>();
      for (const folder of vscode.workspace.workspaceFolders ?? []) {
        const scope = this.scope(folder), exclude = `{${scope.exclude.join(',')}}`;
        // Preserve each pattern: wrapping braces/commas in another brace group changes its meaning.
        for (const include of scope.include.length ? scope.include : ['**/*.{c,h}']) {
          const found = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, include), exclude, scope.include.length ? undefined : maxFiles + 1 - uris.length);
          if (this.disposed || epoch !== this.epoch) return;
          for (const uri of found) {
            const key = uri.toString();
            if (!seen.has(key) && this.eligible(uri)) { seen.add(key); uris.push(uri); }
            if (uris.length > maxFiles) break;
          }
          if (uris.length > maxFiles) break;
        }
        if (uris.length > maxFiles) break;
      }
      this.fileLimitReached ||= uris.length > maxFiles;
      for (const uri of uris.slice(0, maxFiles)) {
        if (this.disposed || epoch !== this.epoch) return;
        await this.enqueue(uri);
        if (this.workerError && epoch === this.epoch) { this.indexing = false; return; }
      }
      if (epoch === this.epoch) {
        this.indexing = false;
        this.status = 'Resolving calls and callbacks…'; this.changed.fire();
        await this.derive();
        if (epoch !== this.epoch) return;
        if (this.workerError) return;
        this.status = this.completedStatus();
        this.changed.fire();
      }
    } catch (error) {
      if (this.disposed || epoch !== this.epoch) return;
      this.indexing = false;
      this.status = `Index error: ${String(error)}`; this.changed.fire();
    }
  }
  async whenIdle() {
    while (this.jobs.size || this.timers.size || this.indexing || this.deriving || this.derivedRevision !== this.revision) {
      await Promise.all([...this.jobs]);
      await this.derive();
      if (this.disposed || this.workerError || this.failures.has('derived')) break;
      if (this.jobs.size || this.timers.size || this.indexing) await new Promise(r => setTimeout(r, 30));
    }
  }
  dispose() {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const request of this.requests.values()) request.reject(new Error('Analysis disposed'));
    this.requests.clear();
    void this.worker.terminate();
    this.disposables.forEach(d => d.dispose()); this.changed.dispose(); this.diagnosticsChanged.dispose();
  }
}
