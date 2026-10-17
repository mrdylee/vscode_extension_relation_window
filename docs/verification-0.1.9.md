# 0.1.9 verification — 2026-10-17

- Added automatic GitHub stable-release checks and the manual Check for Updates command. No installation happens before explicit confirmation; reload is a separate choice.
- Unit suite: 33 passing tests. Update tests cover numeric version comparison, prerelease/draft exclusion, repository/asset matching, daily interval, manual override, rejection, explicit approval, no-release/current-version results, overlapping checks, network/install failures, bounded responses, size and SHA-256 verification.
- Type checking passed. Browser UI regression and actual VS Code Extension Host integration passed. Test-mode activation was checked not to call the release API; the manual command is registered.
- Packaged and installed 0.1.9 successfully. The user window displayed v0.1.9 and Index ready with 655 files; the real manual update command fetched GitHub and displayed the expected no-published-release notification. Full simulated version upgrades use mocked installation to avoid replacing the user's extension with test bytes; no newer production release exists yet.
- The configured repository was observed empty and public. Initial source upload excludes downloaded test sources, dependencies, binaries, screenshots and local test results.

Sources used for the integration contracts:
- https://docs.github.com/en/rest/releases/releases#get-the-latest-release
- https://github.com/microsoft/vscode-docs/blob/main/api/references/commands.md
