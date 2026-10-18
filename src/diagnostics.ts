export type AnalysisPhase = 'sources' | 'macros' | 'callbacks' | 'transfer';
export interface MemorySample { at: number; heapUsed: number; heapLimit: number; external: number }
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
}
