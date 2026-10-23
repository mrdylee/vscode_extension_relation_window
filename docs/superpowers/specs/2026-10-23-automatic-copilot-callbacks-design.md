# Setting-driven Copilot callback analysis

This amendment supersedes the manual-only Copilot policy in the October 22 design, following the user's October 23 request. Existing working-tree changes must be preserved.

When `dynsight.copilotCallbacks` is enabled, automatically analyze unresolved callbacks after the saved index is available, on startup, enable, source settlement, rebuild, and relevant model/scope changes. Reuse `CopilotCallbackController.analyzeUnresolved(..., {reason: 'enabled', automatic: true})`; a second automation setting or new queue is unnecessary. Requests remain sequential and continue past the internal five-request yield boundary.

Keep the current Detailed Analysis Folders and Copilot Include/Exclude intersection. Empty AI Include allows no requests. Reuse valid model-specific cache. Select the configured model without another callback picker; if no model is configured, ask for a model once. Missing models, denied access, timeout, and request failures pause automatic requests without retries or model fallback.

`Stop analysis` cancels the active request, preserves completed results, and pauses automation for this session. Source or index notifications alone do not undo the stop. Toggling the Copilot setting, changing its model/scope, or explicitly running Analyze Callbacks with Copilot resumes automation. Per-node AI actions still analyze only the selected call and do not resume the background queue.

Active User confirmed call sites are excluded from the automatic queue; manual confirmations and AI recheck comparison remain separate. Source/model/scope changes reject stale results. After an interrupted old run finishes, the latest eligible snapshot must still be scheduled.

Remove the footer Choose callback button and its unused webview message. Keep progress and Stop analysis on the existing single footer row. Update current settings/help descriptions to describe automatic behavior; historical release notes remain historical.

Verify setting-driven startup/enable, cache reuse, more than five sites, scope restrictions, saved-index waiting, stop persistence, error backoff, source/model changes during a request, and manual confirmation preservation with the service harness. Verify chooser absence and stop behavior in Chromium, including the existing single-row footer regression.
