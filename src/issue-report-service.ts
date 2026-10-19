import * as vscode from 'vscode';
import type { WorkspaceIndex } from './workspace';
import type { RelationView } from './view';
import { createIssueReport, ISSUE_URL } from './issue-report';

export function registerIssueReporting(context: vscode.ExtensionContext, workspace: WorkspaceIndex, view: RelationView) {
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
      const content = createIssueReport({ now: Date.now(), version: context.extension.packageJSON.version,
        vscodeVersion: vscode.version, platform: process.platform, arch: process.arch, remoteName: vscode.env.remoteName,
        diagnostics: workspace.diagnostics, scopes,
        state: { ...view.state, status: workspace.status, fileCount: workspace.index.files.size,
          issues: [...workspace.failures.values(), ...[...workspace.index.files.values()].flatMap(file => file.issues)] } });
      const document = await vscode.workspace.openTextDocument({ language: 'markdown', content });
      await vscode.window.showTextDocument(document, { preview: false });
      void Promise.resolve(vscode.window.showInformationMessage('Review the report draft and add reproduction steps. GitHub issues are public. Paste the copied report and submit it yourself.',
        'Copy report', 'Copy & Open GitHub')).then(async action => {
        if (!action) return;
        if (document.isClosed) { await failed(); return; }
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
