import * as vscode from 'vscode';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CHECK_INTERVAL, downloadRelease, fetchLatestRelease, Release, UpdateChecker } from './updates';

async function installRelease(release: Release) {
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Installing C Relations v${release.version}` }, async () => {
    const bytes = await downloadRelease(release);
    const directory = await mkdtemp(path.join(tmpdir(), 'c-relation-update-'));
    try {
      const filename = path.join(directory, `c-relation-explorer-${release.version}.vsix`);
      await writeFile(filename, bytes);
      await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(filename));
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  const choice = await vscode.window.showInformationMessage(`C Relations v${release.version} installed. Reload the window to apply the update.`, 'Reload Window', 'Later');
  if (choice === 'Reload Window') await vscode.commands.executeCommand('workbench.action.reloadWindow');
}
export function registerUpdates(context: vscode.ExtensionContext) {
  const checker = new UpdateChecker({
    currentVersion: context.extension.packageJSON.version,
    now: Date.now, lastCheck: () => context.globalState.get<number>('updates.lastCheck', 0),
    saveCheck: async time => { await context.globalState.update('updates.lastCheck', time); },
    latest: fetchLatestRelease,
    confirm: async release => {
      const choice = await vscode.window.showInformationMessage(`C Relations update: v${context.extension.packageJSON.version} → v${release.version}`, {
        modal: true, detail: `${release.notes.slice(0, 4000) || 'No release notes available.'}\n\nRelease: ${release.url}\n\nSelect Update to download and install the extension.`
      }, 'Update', 'Later');
      return choice === 'Update';
    },
    install: installRelease,
    inform: async (message, error) => {
      if (error) await vscode.window.showErrorMessage(`C Relations: ${message}`);
      else await vscode.window.showInformationMessage(`C Relations: ${message}`);
    }
  });
  const automatic = () => {
    if (context.extensionMode === vscode.ExtensionMode.Production && vscode.workspace.getConfiguration('cRelation').get('automaticUpdates', true)) void checker.check();
  };
  const timer = setInterval(automatic, CHECK_INTERVAL);
  context.subscriptions.push(vscode.commands.registerCommand('cRelation.checkForUpdates', () => checker.check(true)),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('cRelation.automaticUpdates')) automatic(); }),
    { dispose: () => clearInterval(timer) });
  automatic();
}
