import * as vscode from 'vscode';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FileAnalysis } from './model';
import { RelationIndex } from './relations';
import { Minimatch } from 'minimatch';
import { getHeapStatistics } from 'node:v8';
import { Diagnostics, IndexDiagnostics, RebuildReason, RebuildRecord, SourceEvent, WorkerDiagnostics } from './diagnostics';

const builtInExcludes = ['**/node_modules/**', '**/.git/**', '**/.vscode-test/**'];
const maxFiles = 10_000;

export class WorkspaceIndex implements vscode.Disposable {
  readonly index = new RelationIndex();
  readonly changed = new vscode.EventEmitter<void>();
  readonly diagnosticsChanged = new vscode.EventEmitter<void>();
  readonly sourceChanged = new vscode.EventEmitter<SourceEvent | 'configuration'>();
  readonly settled = new vscode.EventEmitter<void>();
  readonly ready: Promise<void>;
  status = 'Preparing C index…';
  failures = new Map<string, string>();
  private worker!: Worker;
  private requests = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private rawVersions = new Map<string, number>();
  private rawOptions = new Map<string, string>();
  private deleted = new Set<string>();
  private cacheBlocked = false;
  private saving?: Promise<void>;
  private savedRevision = -1;
  private reconciling?: Promise<void>;
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
  private indexDiagnostics: IndexDiagnostics = { sessionStartedAt: Date.now(), rebuildCount: 0, sourceParses: 0, relationPasses: 0, rebuilds: [] };
  copilotDiagnostics?: Diagnostics['copilot'];
  get generation() { return this.revision; }
  get stable() { return !this.disposed && !this.cacheBlocked && !this.workerError && !this.indexing && !this.jobs.size && !this.timers.size && this.derivedRevision === this.revision; }
  get hasDirtySources() { return vscode.workspace.textDocuments.some(doc => !doc.isClosed && doc.isDirty && this.eligible(doc.uri)); }
  get diagnostics(): Diagnostics {
    const heap = getHeapStatistics();
    return { environment: `${process.platform} ${process.arch} · ${vscode.env.remoteName ?? 'local'} · VS Code ${vscode.version}`,
      host: { at: Date.now(), heapUsed: heap.used_heap_size, heapLimit: heap.heap_size_limit, external: heap.external_memory },
      copilot: this.copilotDiagnostics,
      index: { ...this.indexDiagnostics, cache: this.indexDiagnostics.cache && { ...this.indexDiagnostics.cache }, rebuilds: this.indexDiagnostics.rebuilds.map(record => ({ ...record,
        files: record.files ? { ...record.files } : undefined })) },
      worker: this.workerDiagnostics, workerError: this.workerError
        ? [(this.workerError as NodeJS.ErrnoException).code, this.workerError.message].filter(Boolean).join(': ') : undefined };
  }
  refreshDiagnostics() {
    this.diagnosticsChanged.fire();
    if (!this.disposed && !this.workerError) this.worker.postMessage({ type: 'diagnostics' });
  }
  private scopes = new Map<string, { include: string[]; exclude: string[]; included: Minimatch[]; excluded: Minimatch[]; macros: Minimatch[] }>();
  get skipInactive() { return vscode.workspace.getConfiguration('dynsight').get<boolean>('skipInactive', true); }
  get analyzeCallbacks() { return vscode.workspace.getConfiguration('dynsight').get<boolean>('analyzeCallbacks', true); }
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
  constructor(private extensionPath: string, private storagePath?: string) {
    this.startWorker();
    const watch = vscode.workspace.createFileSystemWatcher('**/*.{c,h}');
    this.disposables.push(watch, watch.onDidCreate(uri => this.schedule(uri, 'file-create')), watch.onDidChange(uri => this.schedule(uri, 'file-change')),
      watch.onDidDelete(uri => { if (this.eligible(uri)) { this.indexDiagnostics.lastSourceEvent = { at: Date.now(), kind: 'file-delete' }; this.sourceChanged.fire('file-delete'); this.remove(uri); } }),
      vscode.workspace.onDidChangeTextDocument(event => { if (event.contentChanges.length) this.schedule(event.document.uri, 'editor-change'); }),
      vscode.workspace.onDidCloseTextDocument(document => this.schedule(document.uri, 'editor-close')),
      vscode.workspace.onDidChangeConfiguration(event => {
        const settings = ['skipInactive', 'include', 'exclude', 'macroExpansionFolders'].filter(key => event.affectsConfiguration(`dynsight.${key}`));
        if (settings.length) { this.sourceChanged.fire('configuration'); void this.reconcile(); }
        else if (event.affectsConfiguration('dynsight.analyzeCallbacks')) {
          this.sourceChanged.fire('configuration'); this.revision++;
          void (async () => { if (this.storagePath) await this.initCache(); await this.derive(); })();
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => { this.sourceChanged.fire('configuration'); void this.reconcile(); }));
    if (vscode.workspace.onDidSaveTextDocument) this.disposables.push(vscode.workspace.onDidSaveTextDocument(doc => this.schedule(doc.uri, 'editor-save')));
    this.ready = this.storagePath ? this.restoreCache() : this.reindex('startup');
  }
  get analysisKey() {
    const version = JSON.parse(readFileSync(path.join(this.extensionPath, 'package.json'), 'utf8')).version;
    return createHash('sha256').update(JSON.stringify({ version, schema: 1, remote: vscode.env.remoteName ?? '', skip: this.skipInactive, callbacks: this.analyzeCallbacks,
      folders: (vscode.workspace.workspaceFolders ?? []).map(folder => { const scope = this.scope(folder); return [folder.uri.toString(), scope.include, scope.exclude, scope.macros.map(m => m.pattern)]; }) })).digest('hex');
  }
  private options(uri: vscode.Uri) {
    const folder = vscode.workspace.getWorkspaceFolder(uri)!;
    const expandMacros = this.scope(folder).macros.some(matcher => matcher.match(vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/')));
    return { skip: this.skipInactive, expandMacros };
  }
  private async discover() {
    const seen = new Map<string, vscode.Uri>(); let searchResults = 0;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const scope = this.scope(folder), exclude = `{${scope.exclude.join(',')}}`;
      for (const include of scope.include.length ? scope.include : ['**/*.{c,h}']) {
        const found = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, include), exclude, scope.include.length ? undefined : maxFiles + 1 - seen.size);
        searchResults += found.length;
        for (const uri of found) { if (this.eligible(uri)) seen.set(uri.toString(), uri); if (seen.size > maxFiles) break; }
        if (seen.size > maxFiles) break;
      }
      if (seen.size > maxFiles) break;
    }
    this.fileLimitReached = seen.size > maxFiles;
    return { uris: [...seen.values()].slice(0, maxFiles), searchResults };
  }
  private initCache() {
    return this.request<{ state: 'missing' | 'ready' | 'invalid' }>({ type: 'cache-init', directory: path.join(this.storagePath!, 'analysis-cache'), key: this.analysisKey }).promise;
  }
  private async restoreCache() {
    this.indexing = true;
    this.indexDiagnostics.cache = { state: 'checking', restored: 0, saved: 0 };
    this.status = 'Checking saved index…';
    const epoch = this.epoch;
    try {
      const initialized = await this.initCache();
      if (this.disposed || epoch !== this.epoch) return;
      this.indexDiagnostics.cache.state = initialized.state === 'ready' ? 'checking' : initialized.state;
      if (initialized.state === 'missing') { this.indexing = false; await this.reindex('startup'); return; }
      if (initialized.state === 'invalid') { this.cacheBlocked = true; this.derivedRevision = this.revision; this.status = 'Saved index is incompatible or damaged. Run Rebuild Index.'; return; }
      const { uris } = await this.discover();
      for (const uri of uris) {
        if (this.disposed || epoch !== this.epoch) return;
        const key = uri.toString(), version = this.versions.get(key) ?? 0;
        try {
          const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
          if (this.disposed || epoch !== this.epoch) return;
          if (version !== (this.versions.get(key) ?? 0)) { if (!this.deleted.has(key)) await this.enqueue(uri); continue; }
          const options = this.options(uri);
          const request = this.request<{ hit: boolean; invalid?: boolean; file?: FileAnalysis; stamp?: number }>({ type: 'cache-restore', uri: key, text, ...options });
          const result = await request.promise;
          if (this.disposed || epoch !== this.epoch) return;
          if (result.invalid) { this.cacheBlocked = true; this.derivedRevision = this.revision; this.index.clear(); this.indexDiagnostics.cache.state = 'invalid'; this.status = 'Saved index is damaged. Run Rebuild Index.'; return; }
          if (version !== (this.versions.get(key) ?? 0)) { this.rawVersions.delete(key); if (!this.deleted.has(key)) await this.enqueue(uri); continue; }
          if (result.hit && result.file && result.stamp !== undefined) {
            this.rawVersions.set(key, request.id); this.appliedDerived.set(key, result.stamp); this.rawOptions.set(key, JSON.stringify(options));
            this.reservedFiles.add(key); this.index.update(result.file); this.revision++;
            this.indexDiagnostics.cache.restored++;
          } else await this.enqueue(uri);
        } catch (error) { this.failures.set(key, String(error)); }
      }
      const { valid } = await this.request<{ valid: boolean }>({ type: 'cache-validate', versions: this.workerVersions(), analyzeCallbacks: this.analyzeCallbacks }).promise;
      if (this.disposed || epoch !== this.epoch) return;
      if (valid && !this.jobs.size && !this.timers.size && !this.failures.size) this.derivedRevision = this.revision;
      this.savedRevision = valid ? this.revision : -1;
      this.indexing = false;
      for (const document of vscode.workspace.textDocuments) if (!document.isClosed && document.isDirty && this.eligible(document.uri)) await this.enqueue(document.uri);
      await this.derive();
      this.indexDiagnostics.cache.state = valid ? 'restored' : 'updated';
      this.status = this.completedStatus();
      await this.saveCache();
    } catch { this.cacheBlocked = true; this.derivedRevision = this.revision; this.indexDiagnostics.cache.state = 'error'; this.status = 'Saved index could not be loaded. Run Rebuild Index.'; }
    finally { if (epoch === this.epoch) this.indexing = false; this.changed.fire(); this.settled.fire(); }
  }
  private workerVersions() { return [...this.rawVersions].map(([uri, id]) => [uri, id, this.appliedDerived.get(uri) ?? -id]); }
  private async saveCache() {
    if (this.saving) return this.saving;
    if (!this.storagePath || !this.stable || this.savedRevision === this.revision || this.failures.size || this.fileLimitReached) return;
    if (this.hasDirtySources) { if (this.indexDiagnostics.cache) this.indexDiagnostics.cache.state = 'deferred'; return; }
    const revision = this.revision;
    this.saving = (async () => {
      try {
        const { saved } = await this.request<{ saved: boolean }>({ type: 'cache-save', versions: this.workerVersions() }).promise;
        if (saved && revision === this.revision) { this.savedRevision = revision; this.indexDiagnostics.cache = { state: 'updated', restored: this.indexDiagnostics.cache?.restored ?? 0, saved: this.index.files.size }; }
      } catch { if (this.indexDiagnostics.cache) this.indexDiagnostics.cache.state = 'error'; }
      finally { this.saving = undefined; this.diagnosticsChanged.fire(); }
    })();
    return this.saving;
  }
  private reconcile() {
    const epoch = ++this.epoch;
    this.indexing = true; this.scopes.clear(); this.cacheBlocked = false;
    this.reconciling = (async () => {
      try {
        for (const key of this.rawVersions.keys()) if (!this.eligible(vscode.Uri.parse(key))) this.remove(vscode.Uri.parse(key));
        if (this.storagePath) await this.initCache();
        const { uris } = await this.discover();
        if (this.disposed || epoch !== this.epoch) return;
        const active = new Set(uris.map(uri => uri.toString()));
        for (const key of this.rawVersions.keys()) if (!active.has(key)) this.remove(vscode.Uri.parse(key));
        for (const key of this.failures.keys()) if (key !== 'derived' && key !== 'worker' && !active.has(key)) this.failures.delete(key);
        this.revision++;
        for (const uri of uris) { if (this.disposed || epoch !== this.epoch) return; this.deleted.delete(uri.toString()); await this.enqueue(uri); }
        this.indexing = false; await this.derive();
      } catch (error) { if (epoch === this.epoch) { this.cacheBlocked = true; this.derivedRevision = this.revision; this.status = `Index error: ${String(error)}. Run Rebuild Index.`; } }
      finally { if (epoch === this.epoch) { this.indexing = false; this.reconciling = undefined; this.changed.fire(); } }
    })();
    return this.reconciling;
  }
  private scope(folder: vscode.WorkspaceFolder) {
    const key = folder.uri.toString();
    let value = this.scopes.get(key);
    if (!value) {
      const config = vscode.workspace.getConfiguration('dynsight', folder.uri);
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
    this.deleted.add(key);
    this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
    clearTimeout(this.timers.get(key)); this.timers.delete(key);
    this.index.remove(key); this.rawVersions.delete(key); this.rawOptions.delete(key); this.appliedDerived.delete(key); this.revision++;
    this.reservedFiles.delete(key);
    this.worker.postMessage({ type: 'remove', uri: key });
    this.failures.delete(key); this.changed.fire();
    if (!this.indexing) void this.derive();
  }
  private schedule(uri: vscode.Uri, kind: SourceEvent) {
    if (this.disposed || !this.eligible(uri)) return;
    this.indexDiagnostics.lastSourceEvent = { at: Date.now(), kind };
    this.sourceChanged.fire(kind);
    if (this.cacheBlocked) return;
    const key = uri.toString();
    this.deleted.delete(key);
    // Invalidate in-flight results immediately, even during the debounce period.
    this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => { this.timers.delete(key); void this.enqueue(uri); }, 100));
  }
  private enqueue(uri: vscode.Uri) {
    if (this.disposed || this.cacheBlocked || !this.eligible(uri)) return Promise.resolve();
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
      // Closing an unchanged editor or receiving a duplicate watcher event must
      // preserve the existing raw input and its derived callback results.
      const options = this.options(uri);
      if (this.rawVersions.has(key) && this.index.files.get(key)?.text === text && this.rawOptions.get(key) === JSON.stringify(options)) return;
      if (text.length > 2_000_000) throw new Error('File exceeds the 2,000,000 character analysis limit');
      // Once dispatched, the Worker may hold this input even if its response is
      // superseded. Do not reuse the old host text until a new result is accepted.
      this.rawVersions.delete(key);
      this.indexDiagnostics.sourceParses++;
      const request = this.request<FileAnalysis>({ uri: key, text, ...options });
      const result = await request.promise;
      if (this.disposed || epoch !== this.epoch || version !== this.versions.get(key)) return;
      this.rawVersions.set(key, request.id); this.appliedDerived.delete(key); this.revision++;
      this.rawOptions.set(key, JSON.stringify(options));
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
    if (this.fileLimitReached) return 'Partial index: 10,000 file limit reached';
    if (this.failures.size) return `Partial index: ${this.failures.size} file(s) failed. See Analysis notices.`;
    if ([...this.index.files.values()].some(file => file.issues.some(issue => /^(Macro|Callback) .*(limit|budget)/i.test(issue))))
      return 'Partial index: analysis limits reached. See Analysis notices.';
    return 'Index ready';
  }
  private derive(): Promise<void> {
    if (this.deriving) return this.deriving;
    if (this.disposed || this.cacheBlocked || this.workerError || this.indexing || this.jobs.size || this.timers.size) return Promise.resolve();
    if (this.derivedRevision === this.revision) return this.saveCache().then(() => this.settled.fire());
    this.deriving = (async () => {
      while (!this.disposed && !this.indexing && !this.jobs.size && !this.timers.size && this.derivedRevision !== this.revision) {
        const revision = this.revision;
        this.indexDiagnostics.relationPasses++;
        const versions = this.workerVersions();
        const result = await this.request<{ stale: boolean; files: FileAnalysis[]; versions: [string, number][] }>({ type: 'derive', versions, analyzeCallbacks: this.analyzeCallbacks }).promise;
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
    }).finally(async () => { this.deriving = undefined; await this.saveCache(); this.settled.fire(); });
    return this.deriving;
  }
  async reindex(reason: RebuildReason = 'command', settings?: string[]) {
    this.sourceChanged.fire('configuration');
    const record: RebuildRecord = { number: ++this.indexDiagnostics.rebuildCount, at: Date.now(), reason, settings, outcome: 'running' };
    this.indexDiagnostics.rebuilds.push(record);
    if (this.indexDiagnostics.rebuilds.length > 5) this.indexDiagnostics.rebuilds.shift();
    const epoch = ++this.epoch;
    let failed = false;
    try { await this.rebuild(epoch, record); }
    catch (error) { failed = true; throw error; }
    finally {
      record.finishedAt = Date.now();
      record.outcome = epoch !== this.epoch || this.disposed ? 'superseded'
        : failed || this.workerError || /^(Index error|Analysis unavailable|Analysis stopped)/.test(this.status) ? 'failed'
        : this.status.startsWith('Partial index') ? 'partial' : 'completed';
      if (!this.disposed) this.diagnosticsChanged.fire();
    }
  }
  private async rebuild(epoch: number, record: RebuildRecord) {
    this.indexing = true;
    this.cacheBlocked = false; this.savedRevision = -1;
    await this.saving;
    if (this.disposed || epoch !== this.epoch) return;
    if (this.workerError || this.status.includes('memory budget')) {
      await this.deriving;
      if (this.disposed || epoch !== this.epoch) return;
      for (const request of this.requests.values()) request.reject(new Error('Analysis restarted'));
      this.requests.clear();
      const previous = this.worker; this.startWorker(); await previous.terminate();
      if (this.disposed || epoch !== this.epoch) return;
    }
    this.rawVersions.clear(); this.rawOptions.clear(); this.appliedDerived.clear(); this.revision++;
    this.deleted.clear();
    this.reservedFiles.clear(); this.fileLimitReached = false;
    this.worker.postMessage({ type: 'reset' });
    this.scopes.clear();
    if (this.storagePath) await this.initCache();
    if (this.disposed || epoch !== this.epoch) return;
    this.index.clear(); this.failures.clear();
    this.status = 'Indexing C sources…'; this.changed.fire();
    const counts: NonNullable<RebuildRecord['files']> = { searchResults: 0, selected: 0, discoveryComplete: false };
    record.files = counts;
    const uris: vscode.Uri[] = [];
    try {
      const seen = new Set<string>();
      for (const folder of vscode.workspace.workspaceFolders ?? []) {
        const scope = this.scope(folder), exclude = `{${scope.exclude.join(',')}}`;
        // Preserve each pattern: wrapping braces/commas in another brace group changes its meaning.
        for (const include of scope.include.length ? scope.include : ['**/*.{c,h}']) {
          const found = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, include), exclude, scope.include.length ? undefined : maxFiles + 1 - uris.length);
          if (this.disposed || epoch !== this.epoch) return;
          counts.searchResults += found.length;
          for (const uri of found) {
            const key = uri.toString();
            if (!seen.has(key) && this.eligible(uri)) { seen.add(key); uris.push(uri); }
            if (uris.length > maxFiles) break;
          }
          if (uris.length > maxFiles) break;
        }
        if (uris.length > maxFiles) break;
      }
      counts.discoveryComplete = uris.length <= maxFiles;
      counts.selected = Math.min(uris.length, maxFiles);
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
    } finally {
      // A superseded run must not count files from its replacement.
      if (!this.disposed && epoch === this.epoch) {
        const selected = uris.slice(0, maxFiles);
        counts.selected = selected.length;
        counts.indexed = selected.filter(uri => this.index.files.has(uri.toString())).length;
        counts.failed = selected.filter(uri => !this.index.files.has(uri.toString()) && this.failures.has(uri.toString())).length;
        counts.missing = counts.selected - counts.indexed - counts.failed;
      }
    }
  }
  async whenIdle() {
    while (this.jobs.size || this.timers.size || this.indexing || this.deriving || this.saving || this.reconciling || this.derivedRevision !== this.revision) {
      await Promise.all([...this.jobs]);
      await this.reconciling; await this.saving;
      await this.derive();
      if (this.disposed || this.cacheBlocked || this.workerError || this.failures.has('derived')) break;
      if (this.jobs.size || this.timers.size || this.indexing) await new Promise(r => setTimeout(r, 30));
    }
  }
  dispose() {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const request of this.requests.values()) request.reject(new Error('Analysis disposed'));
    this.requests.clear();
    void this.worker.terminate();
    this.disposables.forEach(d => d.dispose()); this.changed.dispose(); this.diagnosticsChanged.dispose(); this.sourceChanged.dispose(); this.settled.dispose();
  }
}
