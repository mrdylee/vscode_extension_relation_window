import * as vscode from 'vscode';
import type { WorkspaceIndex } from './workspace';
import type { RelationView } from './view';
import path from 'node:path';
import os from 'node:os';
import { DiagnosticHistory, collectHostLogs } from './diagnostic-history';
import { createIssueReport, statusKind, ISSUE_URL } from './issue-report';

export function registerIssueReporting(context: vscode.ExtensionContext, workspace: WorkspaceIndex, view: RelationView) {
  const history = new DiagnosticHistory(context.storageUri?.scheme === 'file' ? path.join(context.storageUri.fsPath, 'diagnostics') : undefined);
  const record = (event: string) => {
    const data = workspace.diagnostics, worker = data.worker, index = data.index, rebuild = index?.rebuilds.at(-1);
    const mib = (value: number | undefined) => value === undefined ? undefined : Math.round(value / 104857.6) / 10;
    history.record({ at: new Date().toISOString(), event, pid: process.pid, version: context.extension.packageJSON.version,
      status: statusKind(workspace.status), view: { mode: view.state.mode, depth: view.state.depth, pinned: view.state.locked },
      host: { heapMiB: mib(data.host.heapUsed), limitMiB: mib(data.host.heapLimit), processRssMiB: mib(process.memoryUsage.rss()) },
      worker: worker ? { sampledAt: worker.sample.at, phase: worker.phase, run: worker.run,
        heapMiB: mib(worker.sample.heapUsed), limitMiB: mib(worker.sample.heapLimit), peakMiB: mib(worker.peakHeap),
        externalMiB: mib(worker.sample.external), firstLimitPhase: worker.firstLimit?.phase } : undefined,
      index: index ? { sessionStartedAt: index.sessionStartedAt, rebuildCount: index.rebuildCount,
        sourceParses: index.sourceParses, relationPasses: index.relationPasses,
        lastRebuild: rebuild ? { number: rebuild.number, at: rebuild.at, finishedAt: rebuild.finishedAt,
          reason: rebuild.reason, outcome: rebuild.outcome,
          settings: rebuild.settings?.filter(key => ['skipInactive', 'include', 'exclude', 'macroExpansionFolders'].includes(key)) } : undefined,
        lastSourceEvent: index.lastSourceEvent ? { at: index.lastSourceEvent.at, kind: index.lastSourceEvent.kind } : undefined } : undefined });
  };
  let lastTransition = '';
  const transition = () => {
    const data = workspace.diagnostics;
    const key = [statusKind(workspace.status), data.worker?.phase, !!data.workerError,
      data.index?.rebuildCount, data.index?.rebuilds.at(-1)?.outcome].join(':');
    if (key !== lastTransition) { lastTransition = key; record('analysis-state'); }
  };
  record('activation');
  const timer = setInterval(() => record('sample'), 10_000); timer.unref();
  context.subscriptions.push(workspace.changed.event(transition), workspace.diagnosticsChanged.event(transition),
    view.activity.event(action => record(action)), { dispose() { clearInterval(timer); record('deactivate'); } });
  let active: Promise<vscode.TextDocument | undefined> | undefined;
  const failed = () => vscode.window.showErrorMessage('Could not complete the issue-report action. Keep the draft, copy it manually, and open the Issues link in Help.');
  const openReport = (): Promise<vscode.TextDocument | undefined> => {
    if (active) {
      const previous = active;
      return previous.then(async document => {
        if (!document || document.isClosed) { if (active === previous) active = undefined; return openReport(); }
        await vscode.window.showTextDocument(document, { preview: false }); return document;
      });
    }
    const task = (async () => {
      const scopes = (vscode.workspace.workspaceFolders ?? []).map(folder => {
        const config = vscode.workspace.getConfiguration('dynsight', folder.uri);
        const macros = config.get<string[]>('macroExpansionFolders', ['**']);
        return { include: config.get<string[]>('include', []).length, exclude: config.get<string[]>('exclude', []).length,
          macroMode: !macros.length ? 'none' as const : macros.includes('**') ? 'all' as const : 'selected' as const, macroPatterns: macros.length };
      });
      record('report-request');
      let content = createIssueReport({ now: Date.now(), version: context.extension.packageJSON.version,
        vscodeVersion: vscode.version, platform: process.platform, arch: process.arch, remoteName: vscode.env.remoteName,
        diagnostics: workspace.diagnostics, scopes,
        state: { ...view.state, status: workspace.status, fileCount: workspace.index.files.size,
          issues: [...workspace.failures.values(), ...[...workspace.index.files.values()].flatMap(file => file.issues)] } });
      const roots = [os.homedir(), ...(vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath)];
      const evidence = await Promise.allSettled([history.read(), collectHostLogs(context.logUri?.scheme === 'file' ? context.logUri.fsPath : undefined, roots)]);
      content += '\n## Previous runs and recent activity\n\n' + (evidence[0].status === 'fulfilled' ? evidence[0].value : 'Diagnostic history unavailable.') +
        '\n\n## Host log excerpts — review before sharing\n\n' + (evidence[1].status === 'fulfilled' ? evidence[1].value : 'Host logs unavailable.');
      const document = await vscode.workspace.openTextDocument({ language: 'markdown', content });
      await vscode.window.showTextDocument(document, { preview: false });
      void Promise.resolve(vscode.window.showInformationMessage('Review the report and host excerpts for private details. Save the file to share it, or copy the report. Nothing is uploaded automatically.',
        'Save report', 'Copy report', 'Copy & Open GitHub')).then(async action => {
        if (!action) return;
        if (document.isClosed) { await failed(); return; }
        if (action === 'Save report') {
          const destination = await vscode.window.showSaveDialog({ title: 'Save Dynsight diagnostic report',
            filters: { 'Markdown report': ['md'] }, saveLabel: 'Save report' });
          if (destination) {
            if (document.isClosed) { await failed(); return; }
            await vscode.workspace.fs.writeFile(destination, Buffer.from(document.getText(), 'utf8'));
            await vscode.window.showInformationMessage('Diagnostic report saved. Review before sharing.');
          }
          return;
        }
        await vscode.env.clipboard.writeText(document.getText());
        if (action === 'Copy & Open GitHub') {
          if (!await vscode.env.openExternal(vscode.Uri.parse(ISSUE_URL))) await failed();
        } else await vscode.window.showInformationMessage('Issue report copied.');
      }).catch(failed).finally(() => { if (active === task) active = undefined; });
      return document;
    })().catch(async () => { if (active === task) active = undefined; await failed(); return undefined; });
    active = task; return task;
  };
  context.subscriptions.push(vscode.commands.registerCommand('dynsight.reportIssue', openReport));
}
