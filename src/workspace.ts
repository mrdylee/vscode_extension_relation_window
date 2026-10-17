import * as vscode from 'vscode';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { FileAnalysis } from './model';
import { RelationIndex } from './relations';
import { Minimatch } from 'minimatch';

const builtInExcludes = ['**/node_modules/**', '**/.git/**', '**/.vscode-test/**'];

export class WorkspaceIndex implements vscode.Disposable {
  readonly index = new RelationIndex();
  readonly changed = new vscode.EventEmitter<void>();
  readonly ready: Promise<void>;
  status = 'Preparing C index…';
  failures = new Map<string, string>();
  private worker: Worker;
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
  private disposables: vscode.Disposable[] = [];
  private serial = 0;
  private epoch = 0;
  private disposed = false;
  private workerError?: Error;
  private scopes = new Map<string, { include: string[]; exclude: string[]; included: Minimatch[]; excluded: Minimatch[] }>();
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
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('cRelation.skipInactive') || event.affectsConfiguration('cRelation.include') || event.affectsConfiguration('cRelation.exclude')) void this.reindex();
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
      value = { include, exclude, included: include.map(match), excluded: exclude.map(match) };
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
      if (text.length > 2_000_000) throw new Error('File exceeds the 2,000,000 character analysis limit');
      const request = this.request<FileAnalysis>({ uri: key, text, skip: this.skipInactive });
      const result = await request.promise;
      if (this.disposed || epoch !== this.epoch || version !== this.versions.get(key)) return;
      this.rawVersions.set(key, request.id); this.appliedDerived.delete(key); this.revision++;
      this.index.update(result); this.failures.delete(key); this.changed.fire();
    } catch (error) {
      if (this.disposed || epoch !== this.epoch || version !== this.versions.get(key)) return;
      this.index.remove(key); this.rawVersions.delete(key); this.appliedDerived.delete(key); this.revision++;
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
  private derive(): Promise<void> {
    if (this.deriving) return this.deriving;
    if (this.disposed || this.workerError || this.indexing || this.jobs.size || this.timers.size || this.derivedRevision === this.revision) return Promise.resolve();
    this.deriving = (async () => {
      while (!this.disposed && !this.indexing && !this.jobs.size && !this.timers.size && this.derivedRevision !== this.revision) {
        const revision = this.revision;
        const versions = [...this.rawVersions].map(([uri, id]) => [uri, id, this.appliedDerived.get(uri) ?? -id]);
        const result = await this.request<{ stale: boolean; files: FileAnalysis[]; versions: [string, number][] }>({ type: 'derive', versions }).promise;
        if (this.disposed || revision !== this.revision) continue;
        if (result.stale) break;
        for (const file of result.files) this.index.update(file);
        for (const [uri, stamp] of result.versions) this.appliedDerived.set(uri, stamp);
        this.derivedRevision = revision; this.failures.delete('derived'); this.changed.fire();
      }
    })().catch(error => {
      if (!this.disposed) { this.failures.set('derived', `Call analysis: ${String(error)}`); this.changed.fire(); }
    }).finally(() => { this.deriving = undefined; });
    return this.deriving;
  }
  async reindex() {
    const epoch = ++this.epoch;
    this.indexing = true; this.rawVersions.clear(); this.appliedDerived.clear(); this.revision++;
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
          const found = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, include), exclude, scope.include.length ? undefined : 10001 - uris.length);
          if (this.disposed || epoch !== this.epoch) return;
          for (const uri of found) {
            const key = uri.toString();
            if (!seen.has(key) && this.eligible(uri)) { seen.add(key); uris.push(uri); }
            if (uris.length > 10000) break;
          }
          if (uris.length > 10000) break;
        }
        if (uris.length > 10000) break;
      }
      for (const uri of uris.slice(0, 10000)) {
        if (this.disposed || epoch !== this.epoch) return;
        await this.enqueue(uri);
      }
      if (epoch === this.epoch) {
        this.indexing = false;
        this.status = 'Resolving macro calls…'; this.changed.fire();
        await this.derive();
        if (epoch !== this.epoch) return;
        this.status = uris.length > 10000 ? 'Partial index: 10,000 file limit reached' : 'Index ready';
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
    this.disposables.forEach(d => d.dispose()); this.changed.dispose();
  }
}
