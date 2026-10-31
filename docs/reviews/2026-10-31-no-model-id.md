# Remove remaining Smart model ID prompts

The user reported that the installed-extension preview still asked for an ID. Inspection confirmed the remaining cause: the generic Select AI Model command retained a `showInputBox` branch for Claude Code/Codex, and both providers still exposed optional model ID settings. This was an incomplete implementation of the requested simple workflow.

## Change

- Removed the Claude/Codex text-input branch and their model settings. They always use the bundled engine's default model. Old manually entered model IDs are ignored, including when present in existing workspace configuration.
- Both generic and legacy model commands now show a nonblocking default-model explanation for Claude/Codex. They cannot open an ID input. Copilot retains the available-model list.
- Updated the README, both offline guides and the current design. Existing one-provider-only selection, cancellation, no-fallback and provider-specific cache behavior remain covered.
- Versioned this local preview **0.1.87** in the manifest, lockfile and package output, distinguishing it from the prior same-version 0.1.86 previews. Added a local-preview changelog entry. No publication, push or active user extension installation.

## Evidence

- Before the fix, both Claude and Codex command regressions failed with input count **1** instead of **0**. Legacy typed-ID regressions also failed. After the fix, both current/legacy commands remain at zero inputs, CLI provider selections receive an empty model value, old model settings do not trigger requests, and Copilot's model-list selection still works.
- Final unit tests: **805/805 passed**. Typecheck, both browser UI suites and actual isolated macOS Extension Host passed on **0.1.87**. Native manifest checks confirm both path settings and both model ID settings are absent.
- Final VSIX: `artifacts/dynsight-0.1.87.vsix`, **18 entries**, **755845 bytes**, SHA-256 `22e4e7298f1c4ef22524ff425e7f766a0e6078164da6a152782ab604e8cc8d3e`.
- Packaged manifest, extension/worker runtime, webview JS/CSS and offline manuals match the final source/build byte-for-byte. The obsolete input prompt is absent from the built runtime. Packaged README contains the corrected no-ID instructions; VSCE's expected relative-link rewriting accounts for its difference from the source README. Package and lockfile agree on 0.1.87. `git diff --check` passed.
- The earlier real installed-Codex engine smoke check still establishes default-model transport viability; no new live account request was needed for removing a local UI branch. Live Claude account and Windows/WSL/SSH verification remain unavailable as recorded in the installed-extension report.

Logs: `/tmp/dynsight-no-model-id-before.log`, `/tmp/dynsight-no-model-id-focused.log`, `/tmp/dynsight-no-model-id-unit.log`, `/tmp/dynsight-no-model-id-typecheck.log`, `/tmp/dynsight-no-model-id-ui.log`, `/tmp/dynsight-no-model-id-native.log`, `/tmp/dynsight-no-model-id-package.log`.
