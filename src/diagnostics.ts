import type { CacheIncompatibility } from './analysis-cache';
import type { CallbackProgress } from './model';

export type AnalysisPhase = 'sources' | 'macros' | 'callbacks' | 'transfer';
export const copilotWaitMessages = {
  'unsaved-sources': 'Save all modified C/H files in the analysis scope to continue.',
  'indexing': 'Waiting for local indexing to finish.',
  'source-update': 'Waiting for source changes to finish indexing.',
  'relations': 'Waiting for local relation analysis to finish.',
  'cache-rebuild-required': 'Saved index is unavailable. Run Rebuild index.',
  'worker-unavailable': 'Analysis Worker stopped. Run Rebuild index.',
  'analysis-failed': 'Local relation analysis failed. Check Analysis notices, then Rebuild index.',
  'source-failed': 'Some source files failed to index. Check Analysis notices, fix or exclude those files, then Rebuild index.',
  'analysis-paused': 'Local analysis is paused. Resume local analysis to continue.',
  'closed': 'Workspace analysis has closed.'
} as const;
export type CopilotWaitReason = keyof typeof copilotWaitMessages;
export function copilotWaitMessage(reason?: CopilotWaitReason) {
  return reason ? copilotWaitMessages[reason] : 'Waiting for the saved source index to become ready.';
}
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
  basicReady?: boolean; detailedCurrent?: boolean;
  failedSources?: number; basicWaitReason?: CopilotWaitReason;
  callbackAnalysis?: { paused: boolean; running: boolean; limited?: boolean; progress?: CallbackProgress };
  sessionStartedAt: number; rebuildCount: number; sourceParses: number; relationPasses: number;
  rebuilds: RebuildRecord[]; lastSourceEvent?: { at: number; kind: SourceEvent };
  cache?: { state: 'disabled' | 'checking' | 'restored' | 'updated' | 'missing' | 'incompatible' | 'invalid' | 'deferred' | 'error';
    reason?: CacheIncompatibility; version?: number; savedVersion?: number; restored: number; saved: number };
}
export interface WorkerDiagnostics {
  run: string;
  phase: AnalysisPhase | 'idle';
  sample: MemorySample;
  peakHeap: number;
  phases: Partial<Record<AnalysisPhase, { before: MemorySample; after?: MemorySample }>>;
  firstLimit?: { phase: AnalysisPhase | 'idle'; sample: MemorySample };
  counts: { files: number; sourceChars: number; references: number; programs: number; macroFiles: number };
  callbacks?: CallbackProgress;
}
export interface Diagnostics {
  environment: string;
  host: MemorySample;
  worker?: WorkerDiagnostics;
  workerError?: string;
  index?: IndexDiagnostics;
  copilot?: { state: string; manualReview?: number; manualInactive?: number; automatic?: boolean; waitReason?: CopilotWaitReason; total?: number; completed?: number; requests: number; cacheHits: number; remaining: number; failures: number; candidates: number; notFound: number; contextLimited: number; excluded?: number };
}
