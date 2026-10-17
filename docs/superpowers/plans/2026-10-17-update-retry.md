# Update Retry Fix

Observed: the live GitHub latest-release response correctly selects v0.1.21 for v0.1.20 and its VSIX passes size/hash validation. Existing code saves updates.lastCheck before requesting/parsing the response, so failures silently suppress automatic checks for 24 hours. The timer also runs only once per day from activation, potentially delaying a due check after restart.

Scope: record successful discovery only and poll hourly while retaining the daily successful-check throttle. Keep manual bypass, confirmation, installation and development/test suppression unchanged. The user's WSL state is unknown; do not claim that its failure was reproduced.

Verification: failing regressions for offline recovery and invalid metadata; typecheck and unit suite; isolated real VS Code install command; Extension Host suite; package and release workflow. Document the cadence and immediate manual-check route.
