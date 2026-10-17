# Verification — 0.1.22

Verified on 2026-10-17.

- Live GitHub API: v0.1.21 was selected as newer than v0.1.20 and correctly rejected as newer than itself. Its downloaded VSIX matched the published byte count and SHA-256 digest.
- A separate VS Code profile and extension directory successfully installed the v0.1.21 VSIX through the same `workbench.extensions.installExtension` command/URI used by the updater. The resulting installed manifest was checked. This was macOS, not WSL.
- Two new regressions failed before the fix: network failure and invalid release metadata both incorrectly advanced the daily timestamp. Both pass after moving timestamp persistence after successful discovery/validation.
- Type checking and all 39 unit tests passed; the existing real Extension Host integration suite passed, including suppression of automatic checks in test mode.
- Hourly scheduling now invokes the existing daily-throttled checker. Successful checks retain the daily interval; failures leave the previous successful-check time unchanged.
- Packaged version 0.1.22 with the updated offline guide. `git diff --check` passed.

The user's installed version, automatic-update setting and WSL network state were not available, so the specific reported symptom is not attributed conclusively to the reproduced retry bug. Manual checking bypasses the daily throttle in existing versions too.
