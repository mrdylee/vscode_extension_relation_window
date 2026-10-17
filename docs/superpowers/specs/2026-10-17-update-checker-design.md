# GitHub update checker

Add an update check to the existing VSIX-distributed extension. Use the public repository mrdylee/vscode_extension_relation_window as the fixed source. Marketplace distribution is a future alternative; checking arbitrary commits would expose users to unfinished work, so only published stable GitHub Releases with a matching VSIX are eligible.

On production activation and periodically while active, check at most once per 24 hours. A manual `C Relations: Check for Updates` command bypasses the interval. Offer a setting to disable automatic checks. Do not contact GitHub in extension development/test mode unless the manual command is invoked.

Compare numeric stable versions; ignore drafts/prereleases, older versions, and assets not named for this extension and release version. Show the current/new version and release notes as plain text in a confirmation dialog. Only an explicit Update choice downloads and installs the VSIX through VS Code. Later/dismissal performs no installation. Offer Reload Window after success; never reload without acceptance. Checks do not upload source files or code.

GitHub absence of a release is a normal no-release result. Automatic offline/rate-limit failures are quiet; manual checks explain the failure and allow retry. Repeated overlapping checks are suppressed. Network calls have timeouts, asset downloads are bounded, and a supplied SHA-256 digest is verified before installation. The trusted source is the named repository; this is version/release-note checking, not automated code security auditing.

A first commit includes source, tests, docs and package lock. Exclude dependencies, binaries, local screenshots/results and downloaded FreeRTOS sources. The remote repository was observed empty. Push main without force. No release is published solely as a side effect of the initial commit; document how to publish matching VSIX releases for future delivery.
