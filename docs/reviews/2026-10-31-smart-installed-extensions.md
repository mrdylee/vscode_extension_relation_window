# Installed AI extensions: verification

The later model-ID correction supersedes the optional Claude/Codex model-selection UI described below. Current preview 0.1.87 removes that input/settings entirely; see `2026-10-31-no-model-id.md` for its verification and artifact.

The user corrected the previous CLI setup: Smart Analysis should reuse installed VS Code extensions. When Copilot, Claude Code and Codex are all installed, exactly one selected provider must handle Dynsight requests. This supersedes the October 30 preview and instructions.

## Result

- Provider defaults to Auto. A single installed provider is selected automatically; multiple providers prompt once and save one workspace choice. `Dynsight: Select AI Extension` changes it. Explicit existing selections remain valid.
- Extension enumeration reads metadata without activating all AI extensions. Copilot uses the VS Code Language Model API. Claude Code/Codex resolve the selected extension's compatible bundled engine automatically, with existing authentication and bounded stdin/response handling. There is no global CLI search, npm shim discovery or executable-path setting.
- This reuses the installed extension's engine, rather than sending messages into an open chat panel. The inspected Codex extension does not export an analysis request/response API or register a Language Model provider. Bundled paths are checked at runtime; incompatible/missing engines point to updating/reinstalling the selected extension. No credential files are read by Dynsight.
- A provider change cancels the old request and waits for its task to settle before the new provider starts. Failed or missing selected providers never fall back. Cancelling selection sends no requests. Scope, evidence validation, caches, manual overrides and single-request scheduling remain shared.
- Removed path configuration and separate CLI/login setup from README and both offline manuals. Model selection remains optional for Claude Code/Codex.

## Verification

- Initial regressions failed on bundled-path routing and Auto selection. Final **803/803 unit tests passed**, including all-three-installed execution for each provider, saved one-time selection, single-installed auto choice, cancellation, missing/failing selected providers, no fallback and maximum one active CLI request during switching.
- Bundled-engine resolution fixtures cover macOS arm64, Linux x64/arm64 and Windows x64 layouts. Foreign-platform and absent engines are rejected. Metadata enumeration never activates the other extensions.
- Typecheck, both browser UI suites and the isolated actual macOS VS Code Extension Host passed. Native checks include Auto default, generic command registration, absence of executable-path settings and running a child-process protocol fixture through Electron's Node mode.
- Live synthetic request used the **actual installed `openai.chatgpt` 26.51021.22027 bundled Codex engine**, version **0.164.0-alpha.11.1**, at `bin/macos-aarch64/codex`. With PATH restricted to `/usr/bin:/bin`, it returned valid `not-found` JSON. This does not depend on the separately installed global Codex CLI. No project source was sent in this smoke test.
- Claude Code is not installed in this local VS Code profile; its live account integration is **not verified**. Its discovery layouts and bounded protocol are covered by fixtures. Actual Windows/WSL/SSH native execution and remote authentication are **not verified**; a compatible engine must be accessible in the active extension host.
- README and both guides document Select AI Extension, contain no path/login-command setup, and their nine JSON examples parse. `git diff --check` passed. Unrelated memory-monitor and WSL investigation files were preserved.
- New local preview: `artifacts/dynsight-ai-extensions-preview.vsix`, **18 entries**, **755893 bytes**, SHA-256 `6572052950864d4842467c2dde089cfd26a1358ea9a9b12c4c67a8449d70e7bd`. Manifest, manuals, extension/worker runtime and webview JS/CSS match the final build byte-for-byte. The manifest contains Auto and no executable-path settings. It retains version 0.1.86 as a local preview; no push, release or active extension installation was performed.

Logs: `/tmp/dynsight-installed-unit-final.log`, `/tmp/dynsight-installed-typecheck.log`, `/tmp/dynsight-installed-ui.log`, `/tmp/dynsight-installed-native.log`, `/tmp/dynsight-installed-live.log`, `/tmp/dynsight-installed-package.log`.

Interface evidence: the installed Codex manifest and activation module were inspected directly. [Official Codex authentication documentation](https://learn.chatgpt.com/docs/auth#login-caching) describes shared CLI/IDE cached login; [official Claude Code VS Code documentation](https://code.claude.com/docs/en/vs-code) describes extension sign-in; [VS Code Language Model API documentation](https://code.visualstudio.com/api/extension-guides/ai/language-model) defines the Copilot request interface. Bundled-engine path compatibility is an implementation dependency, not a claimed public extension API contract.
