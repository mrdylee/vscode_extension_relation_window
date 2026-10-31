# Dynsight Markdown preview preference

Status: user approved the supported-API approach on 2026-11-01.

## Concrete proposal

One native Settings dropdown, `Dynsight > Markdown Preview`:

- `Disabled (default)`: Dynsight does not invoke built-in Markdown preview. Help remains readable as a read-only plain-text virtual document with a `.txt` name, so opening Help does not itself activate the Markdown language service. No changes to global language associations.
- `Markdown Preview Enhanced`: explicit opt-in. Help uses the selected installed/enabled extension's own preview command and the bundled localized guide URI. If unavailable, offer its native extension page to install or enable it; never fall back to the built-in preview.

The setting description includes a `Manage built-in Markdown…` link. This opens a search restricted to `vscode.markdown-language-features` and explains `Disable (Workspace)` followed by Restart Extensions if shown. The label must not claim the extension is disabled by the dropdown. Markdown Language Basics remains untouched.

VS Code's supported `workbench.extensions.search` command accepts a query. Its documented installation API is available, but there is no supported per-extension enable/disable API. The 2024 API request #201672 is closed as not planned; the local current workbench bundle also has no `workbench.extensions.action.disableWorkspace` command. Do not modify private VS Code state databases or installed bundles.

## Approaches considered

1. Recommended: one preview setting plus the native disable/enable/install page. Supported across extension hosts; the user performs the actual one-time disable in VS Code.
2. Automatic disable via private enablement storage/internal APIs: would meet the literal automatic default but couples Dynsight to VS Code internals and can desynchronize settings. Not proposed for implementation.

## Verification

- Default Help uses a read-only plaintext guide and never invokes `markdown.showPreview` or another extension installation.
- Korean/English guide commands keep their language selection and preserve Relation state.
- Enhanced selection uses the exact chosen provider; missing/disabled provider and cancellation never invoke the built-in preview.
- Native Settings exposes one enumerated preference and correctly targeted management links.
- Actual isolated VS Code host verifies default Help does not activate the built-in Markdown extension, plus the real installed Enhanced command on a small fixture.
- Current user workspace, extension enablement, and AI settings stay unchanged during implementation tests.

## Limits

This preference controls Dynsight's guide rendering. It cannot silently turn off the built-in language extension. General Markdown editing and preview shortcuts remain owned by VS Code/the chosen Markdown extension. No claim that Enhanced has passed large-workspace memory validation.
