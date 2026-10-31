# Smart Analysis AI providers

Superseded by the user's correction and [installed-extension design](2026-10-31-smart-installed-extensions-design.md): separate CLI setup is not the desired interface.

User confirmed Claude Code and Codex CLI login accounts. Add `smartAnalysis.ai` and a `smartAnalysis.provider` choice (Copilot, Claude Code, Codex). Keep the existing Copilot enable flag as a fallback when the new flag is unset, keep Copilot model selection, and keep existing command IDs as aliases for the selected provider.

Reuse callback context construction, evidence validation, sequential scheduling, scope, manual confirmations and stop/resume behavior. Add generic AI commands. Claude and Codex model IDs and executable paths are separate settings; executable paths are machine settings. Use CLI defaults when a model is blank. Never switch providers after a failure.

Run each CLI in a fresh temporary directory, feed bounded source context through stdin, disable tools/MCP/hooks where supported, and use read-only execution for Codex. Do not load project settings. Require current CLI flags; report an actionable error for old/missing CLIs or login failure. No API key storage, credential extraction, workspace editing, release or installation.

Separate cache identities by provider, executable, CLI version and selected model. Provider/model changes cancel the old request and clear displayed old hints. Keep Copilot cache paths compatible. Show the actual provider in progress and use AI candidate labels in shared results.

Verify real child-process protocol handling, argument boundaries, output limits, process termination, missing CLI and nonzero exits; service tests cover routing, trust, cache separation, changing provider and old Copilot behavior. Existing UI tests cover generic result labels and provider progress. Live account requests may be unavailable; distinguish fixture verification from account verification.
