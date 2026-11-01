import * as vscode from 'vscode';

const enhancedId = 'shd101wyy.markdown-preview-enhanced';
const guideFiles: Record<string, string> = { '/USER_GUIDE.txt': 'USER_GUIDE.md', '/USER_GUIDE.ko.txt': 'USER_GUIDE.ko.md' };

export function registerMarkdownPreview(context: vscode.ExtensionContext) {
  const useEnhanced = () => vscode.workspace.getConfiguration('dynsight').get<string>('markdownPreview', 'disabled') === 'enhanced';
  const manageEnhanced = () => vscode.commands.executeCommand('workbench.extensions.search', `@id:${enhancedId}`);
  const offerEnhanced = async () => {
    const choice = await vscode.window.showInformationMessage(
      'Dynsight: Install or enable Markdown Preview Enhanced in this window to use its preview.', 'Open Extension');
    if (choice === 'Open Extension') await manageEnhanced();
  };
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('dynsight-guide', {
      async provideTextDocumentContent(uri) {
        const filename = guideFiles[uri.path];
        if (!filename) throw new Error('Unknown Dynsight guide');
        return Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, filename))).toString('utf8');
      }
    }),
    vscode.commands.registerCommand('dynsight.manageMarkdownPreviewEnhanced', manageEnhanced),
    vscode.commands.registerCommand('dynsight.manageBuiltinMarkdown', async () => {
      await vscode.commands.executeCommand('workbench.extensions.search', '@builtin @id:vscode.markdown-language-features');
      void vscode.window.showInformationMessage(
        'Dynsight: On Markdown Language Features, choose Manage → Disable (Workspace), then Restart Extensions if shown. Keep Markdown Language Basics enabled. The Dynsight preview setting does not disable extensions.');
    }),
    vscode.workspace.onDidChangeConfiguration(async event => {
      if (!event.affectsConfiguration('dynsight.markdownPreview') || !useEnhanced() || vscode.extensions.getExtension(enhancedId)) return;
      try { await offerEnhanced(); }
      catch { void vscode.window.showWarningMessage('Dynsight: Could not open the Enhanced extension page. Find Markdown Preview Enhanced in Extensions to install or enable it.'); }
    })
  );

  return async (language: string) => {
    const filename = /^ko(?:-|$)/i.test(language) ? 'USER_GUIDE.ko.md' : 'USER_GUIDE.md';
    const openText = async () => {
      // A .md editor would activate onLanguage:markdown even without a preview.
      const uri = vscode.Uri.from({ scheme: 'dynsight-guide', path: '/' + filename.replace(/\.md$/, '.txt') });
      return vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: true });
    };
    if (!useEnhanced()) return openText();
    const extension = vscode.extensions.getExtension(enhancedId);
    if (!extension) {
      const editor = await openText();
      await offerEnhanced();
      return editor;
    }
    try {
      await extension.activate();
      if (!useEnhanced()) return openText();
      // Enhanced also reads activeTextEditor; focus the matching guide, never a C source file.
      const editor = await openText();
      if (!useEnhanced()) return editor;
      return await vscode.commands.executeCommand('markdown-preview-enhanced.openPreview', vscode.Uri.joinPath(context.extensionUri, filename));
    } catch {
      void vscode.window.showWarningMessage('Dynsight: Markdown Preview Enhanced could not open the guide. Showing read-only text instead.');
      return openText();
    }
  };
}
