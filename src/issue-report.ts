import type { AnalysisPhase, Diagnostics, MemorySample, RebuildRecord } from './diagnostics';
import type { ViewState } from './view-state';

export const ISSUE_URL = 'https://github.com/mrdylee/vscode_extension_relation_window/issues/new?' + new URLSearchParams({
  title: '[Bug] ', body: 'Paste the reviewed summary or attach the saved Dynsight report here. Describe the problem and reproduction steps. Review screenshots and code before posting: this issue is public.'
}).toString();
export interface IssueReportInput {
  now: number; version: string; vscodeVersion: string; platform: string; arch: string; remoteName?: string;
  state: ViewState; diagnostics: Diagnostics;
  scopes: { include: number; exclude: number; macroMode: 'all' | 'selected' | 'none'; macroPatterns: number }[];
}
const phases: (AnalysisPhase | 'idle')[] = ['sources', 'macros', 'callbacks', 'transfer', 'idle'];
const choice = (value: string, allowed: readonly string[]) => allowed.includes(value) ? value : 'other';
const number = (value: number | undefined) => value !== undefined && Number.isFinite(value) && value >= 0 ? value : null;
export function reportFileCounts(files: RebuildRecord['files']) {
  return files ? { searchResults: number(files.searchResults), selected: number(files.selected),
    discoveryComplete: files.discoveryComplete === true, indexed: number(files.indexed),
    failed: number(files.failed), missing: number(files.missing) } : null;
}
const version = (value: string) => /^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(value) && value.length < 60 ? value : 'unknown';
function noticeKind(text: string) {
  if (/ERR_WORKER_OUT_OF_MEMORY|heap out of memory/i.test(text)) return 'worker-out-of-memory';
  if (/memory budget/i.test(text)) return 'memory-budget';
  if (/incomplete or unsupported C syntax/i.test(text)) return 'syntax';
  if (/Macro .*limit/i.test(text)) return 'macro-limit';
  if (/Callback .*(limit|budget)/i.test(text)) return 'callback-limit';
  if (/2,000,000 character/i.test(text)) return 'file-size-limit';
  return 'other';
}
export function statusKind(status: string) {
  if (status.includes('memory budget')) return 'partial-memory-budget';
  if (status === 'Index ready') return 'ready';
  if (status.startsWith('Indexing C sources')) return 'indexing';
  if (status.startsWith('Resolving calls')) return 'resolving';
  if (status.startsWith('Partial index')) return 'partial';
  if (/^(Analysis stopped|Analysis unavailable|Index error)/.test(status)) return 'failed';
  return 'preparing-or-unavailable';
}

export function createIssueReport(input: IssueReportInput): string {
  const { state, diagnostics, scopes, now } = input;
  const memory = (sample: MemorySample) => ({
    sampleAgeSeconds: number(Math.max(0, Math.round((now - sample.at) / 1000))),
    heapUsedMiB: number(Math.round(sample.heapUsed / 104857.6) / 10),
    heapLimitMiB: number(Math.round(sample.heapLimit / 104857.6) / 10),
    externalMiB: number(Math.round(sample.external / 104857.6) / 10)
  });
  const notices: Record<string, number> = {};
  for (const issue of state.issues) { const kind = noticeKind(issue); notices[kind] = (notices[kind] ?? 0) + 1; }
  const worker = diagnostics.worker;
  const index = diagnostics.index;
  const age = (at: number) => number(Math.max(0, Math.round((now - at) / 1000)));
  // Explicitly project fields: state and diagnostics contain source identifiers and raw errors.
  const summary = {
    reportSchema: 1, capturedAt: new Date(now).toISOString(),
    extensionVersion: version(input.version), vscodeVersion: version(input.vscodeVersion),
    platform: choice(input.platform, ['win32', 'darwin', 'linux']), arch: choice(input.arch, ['x64', 'arm64', 'ia32', 'arm']),
    remote: choice(input.remoteName ?? 'local', ['local', 'wsl', 'ssh-remote', 'dev-container', 'attached-container', 'codespaces']),
    status: statusKind(state.status), indexedFiles: number(state.fileCount),
    view: {
      mode: choice(state.mode, ['references', 'callers', 'callees', 'both']), depth: number(state.depth),
      pinned: !!state.locked, skipInactive: !!state.skipInactive, includeFunctionArguments: !!state.includeFunctionArguments,
      accessFilter: choice(state.accessFilter, ['all', 'read', 'write', 'readwrite', 'address']),
      calleeSort: choice(state.calleeSort, ['name', 'source']),
      contextLayout: choice(state.contextLayout, ['combined', 'combined-full-width', 'separate']),
      callGraphDirection: choice(state.callGraphDirection, ['callers-left', 'callees-left'])
    },
    scope: { workspaceFolders: scopes.length, includePatternCount: scopes.reduce((n, s) => n + s.include, 0),
      excludePatternCount: scopes.reduce((n, s) => n + s.exclude, 0), macroPatternCount: scopes.reduce((n, s) => n + s.macroPatterns, 0),
      macroFolderModes: Object.fromEntries(['all', 'selected', 'none'].map(mode => [mode, scopes.filter(s => s.macroMode === mode).length])) },
    noticeCount: state.issues.length, notices,
    workerError: diagnostics.workerError ? noticeKind(diagnostics.workerError) : 'none',
    index: index ? {
      sessionAgeSeconds: age(index.sessionStartedAt), rebuildCount: number(index.rebuildCount),
      sourceParses: number(index.sourceParses), relationPasses: number(index.relationPasses),
      lastSourceEvent: index.lastSourceEvent ? { ageSeconds: age(index.lastSourceEvent.at),
        kind: choice(index.lastSourceEvent.kind, ['editor-change', 'editor-close', 'file-create', 'file-change', 'file-delete']) } : null,
      rebuilds: index.rebuilds.slice(-5).map(record => ({ number: number(record.number), ageSeconds: age(record.at),
        reason: choice(record.reason, ['startup', 'configuration', 'workspace-folders', 'command', 'toolbar']),
        settings: (record.settings ?? []).filter(key => ['skipInactive', 'include', 'exclude', 'macroExpansionFolders'].includes(key)),
        outcome: choice(record.outcome, ['running', 'completed', 'partial', 'failed', 'superseded']),
        files: reportFileCounts(record.files),
        durationMs: record.finishedAt === undefined ? null : number(record.finishedAt - record.at) }))
    } : 'unavailable',
    worker: worker ? {
      phase: choice(worker.phase, phases), ...memory(worker.sample), sampledPeakMiB: number(Math.round(worker.peakHeap / 104857.6) / 10),
      guardPercent: 60,
      counts: { files: number(worker.counts.files), sourceChars: number(worker.counts.sourceChars), references: number(worker.counts.references),
        programs: number(worker.counts.programs), macroFiles: number(worker.counts.macroFiles) },
      checkpoints: Object.fromEntries(phases.filter(p => p !== 'idle').flatMap(p => {
        const checkpoint = worker.phases[p as AnalysisPhase];
        return checkpoint ? [[p, { before: memory(checkpoint.before), after: checkpoint.after ? memory(checkpoint.after) : null }]] : [];
      })),
      firstLimit: worker.firstLimit ? { phase: choice(worker.firstLimit.phase, phases), ...memory(worker.firstLimit.sample) } : null
    } : 'unavailable',
    sharedExtensionHost: memory(diagnostics.host)
  };
  return `# Dynsight problem report

This GitHub issue will be public. Review this draft and any attachments before submitting.
The diagnostic snapshot omits source, symbols, paths, raw errors and Include/Exclude patterns.
Host log excerpts, when appended, may contain private metadata: review before sharing.

## Problem
Describe what stopped working and when it started.

## Reproduction steps
1.
2.
3.

## Expected / actual behavior
Expected:
Actual:
Does Rebuild Index or Reload Window help? Capture this report before trying them.

## Screenshot or minimal C example (optional)
Remove confidential code, names and paths before adding attachments.

## Diagnostic snapshot
Latest available measurements; a busy or stopped Worker may have an older sample.
MiB values describe JS heap and separate external memory, not total system RAM.
The extension host is shared with other extensions. Counts do not prove analysis completeness.

\`\`\`json
${JSON.stringify(summary, null, 2)}
\`\`\`
`;
}
