export type AnalysisPhase = 'sources' | 'macros' | 'callbacks' | 'transfer';
export interface MemorySample { at: number; heapUsed: number; heapLimit: number; external: number }
export type RebuildReason = 'startup' | 'configuration' | 'workspace-folders' | 'command' | 'toolbar';
export type SourceEvent = 'editor-change' | 'editor-save' | 'editor-close' | 'file-create' | 'file-change' | 'file-delete';
export interface RebuildRecord {
  number: number; at: number; reason: RebuildReason; settings?: string[]; finishedAt?: number;
  outcome: 'running' | 'completed' | 'partial' | 'failed' | 'superseded';
  files?: {
    searchResults: number; selected: number; discoveryComplete: boolean;
    indexed?: number; failed?: number; missing?: number;
  };
}
export interface IndexDiagnostics {
  sessionStartedAt: number; rebuildCount: number; sourceParses: number; relationPasses: number;
  rebuilds: RebuildRecord[]; lastSourceEvent?: { at: number; kind: SourceEvent };
  cache?: { state: 'disabled' | 'checking' | 'restored' | 'updated' | 'missing' | 'invalid' | 'deferred' | 'error'; restored: number; saved: number };
}
export interface WorkerDiagnostics {
  run: string;
  phase: AnalysisPhase | 'idle';
  sample: MemorySample;
  peakHeap: number;
  phases: Partial<Record<AnalysisPhase, { before: MemorySample; after?: MemorySample }>>;
  firstLimit?: { phase: AnalysisPhase | 'idle'; sample: MemorySample };
  counts: { files: number; sourceChars: number; references: number; programs: number; macroFiles: number };
}
export interface Diagnostics {
  environment: string;
  host: MemorySample;
  worker?: WorkerDiagnostics;
  workerError?: string;
  index?: IndexDiagnostics;
  copilot?: { state: string; total?: number; completed?: number; requests: number; cacheHits: number; remaining: number; failures: number; candidates: number; notFound: number; contextLimited: number };
}
