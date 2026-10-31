# Smart Analysis: Copilot, Claude Code and Codex

Historical CLI-setup implementation. Superseded by the user's October 31 correction: discover installed AI extensions and use exactly one selected extension. See the October 31 installed-extension design and verification report.

Implemented locally on `codex/smart-ai-providers`, base `a0d95e9`, following the user's confirmed choice of CLI login accounts. No release, version bump, push or active extension installation. Existing WSL investigation files were preserved.

## Behavior

- Smart Analysis: AI enables the selected Provider: GitHub Copilot, Claude Code CLI or Codex CLI. Explicit new enable values override old Copilot switches; unset values retain legacy behavior. Copilot's existing model API, command IDs and cache paths remain compatible.
- Generic AI commands share the existing scope, sequential callback controller, evidence validation, manual overrides and stop/resume behavior. CLI model IDs and machine executable paths have separate settings. Provider/model changes cancel requests and separate caches by provider, executable, CLI version and model.
- Source stays in bounded stdin, rather than command arguments. Each request uses a temporary directory that is removed afterward. Shell interpolation is disabled. The adapter limits output/time, terminates process groups on POSIX and uses process-tree termination on Windows. Windows npm installations resolve their JavaScript entry points instead of invoking command scripts through a shell.
- Claude uses JSON print output with built-in tools/MCP/hooks/session persistence disabled. Codex uses JSONL exec output, read-only execution and isolated execution configuration. Dynsight does not read credentials; CLI authentication remains with the CLI. Shared results say AI candidate; progress identifies the actual provider and displays actionable failures.
- Updated the README and both offline manuals. All six newly added public settings are documented; six JSON examples parse and use registered setting keys.

## Verification

- Provider-routing tests first failed because Claude/Codex were never called. Added real child-process fixtures for Claude JSON and Codex JSONL, stdin/argument separation, cancellation, timeout, missing CLI, old CLI, response errors and output limits.
- A browser regression first showed Copilot text instead of the selected Claude provider/error; both browser suites pass with provider-aware progress and generic result labels.
- Self-review found old CLI model candidates retained after model selection. A regression reproduced this before clearing old hints when the CLI model selection is saved; it passes afterward.
- Final `npm test`: **789/789 passed**. `npm run typecheck`: passed. Both `npm run test:ui` suites passed. Final `npm run test:extension`: actual isolated macOS VS Code host passed, including all generic command/default registrations and a real CLI fixture launched through Electron's Node execution mode. The original host assertion for the now-hidden Copilot switch was updated to check the new AI default.
- Live synthetic requests using the final adapter: Codex **0.166.0** returned valid `not-found` JSON through its CLI login. Installed Claude Code **1.0.127** rejects required flags; the final adapter reports an explicit update instruction. A live modern Claude account request is **not verified**. No project source was used for live smoke requests.
- Windows and WSL/SSH native execution and process-tree termination are not exercised on this Mac. Current CLI versions are required; no automatic provider/model fallback occurs.
- `git diff --check`: passed. Local preview package contains **18 entries**, **755546 bytes**, SHA-256 `638f0d776f1bd10e3273f5a51f2a4466652a6c2c818f680d17149f9e3a928689`. Packaged manifest, both manuals, extension/worker runtime and webview JS/CSS match the final source/build byte-for-byte. It retains version **0.1.86** and is a local preview, not a published release.

Package: `artifacts/dynsight-smart-ai-preview.vsix`.

Logs: `/tmp/dynsight-ai-unit-final.log`, `/tmp/dynsight-ai-typecheck.log`, `/tmp/dynsight-ai-ui.log`, `/tmp/dynsight-ai-native-final.log`, `/tmp/dynsight-ai-live-final.log`, `/tmp/dynsight-ai-package.log`.

CLI contracts were checked against the [official Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference), [official Codex non-interactive documentation](https://learn.chatgpt.com/docs/non-interactive-mode) and [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference), plus installed CLI help. These establish the requested CLI interfaces; fixture tests and the live Codex check are the execution evidence above.
