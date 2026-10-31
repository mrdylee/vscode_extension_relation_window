# Smart AI review corrections for 0.1.89

The user authorized correcting both reproduced 0.1.88 review findings and continuing delivery. Scope is the AI service lifecycle, Copilot selection restoration, their regressions and patch-release metadata. The single AI setting, two native pickers, installed-extension engines and exclusive-provider behavior remain.

## Corrections

1. **Manual callback analysis blocked configuration changes.** `starting` stayed true through the entire per-callback request, and `configureAi` returned before cancelling it. Manual analysis now registers its complete preparation/discovery/request task in the existing `running` promise. Configuration owns a separate flag for its whole operation, cancels the previous request and waits for that task to settle before showing the pickers. Manual/automatic analysis cannot overlap setup. A revision check after source preparation prevents an invalidated task from starting a late request. If AI is disabled or the service disposed while setup waits, no late picker opens.
2. **Copilot model version updates rejected an available selection.** Saved `modelVersion` was used as a hard selection constraint. Selection now resolves the same model ID against current models; the actual returned version still invalidates the controller and selects a separate cache. New selections no longer store the unused version pin, and older records containing it remain readable without re-selection. Missing IDs still pause with `model-unavailable`; another model/provider is never selected automatically.

## Regression evidence

- Before the fix, the first four targeted tests had three expected failures: an active manual request was not cancelled, manual model discovery still proceeded to an old-provider request, and the same Copilot ID at version 2 was rejected against a saved version 1. The existing setup-exclusion behavior passed.
- Six maintained cases now cover active manual cancellation and maximum one provider request; handoff during model discovery; handoff before source preparation completes; disabling AI while setup waits; rejection of analysis during setup; and same-ID version/cache refresh, legacy pinned records, restart cache reuse and missing-ID no-fallback.
- An additional waiting/off regression first reproduced two late pickers after AI was disabled; an enabled-state/disposal check before opening setup corrected it. All **59 service tests** now pass.
- Fresh typecheck, **822 unit tests**, **94 Worker/cache/workspace tests**, **six memory tests**, performance checks and both browser UI suites passed. Native large-workspace validation passed with **2501 indexed files / 50000 calls**.
- Actual isolated macOS VS Code passed the full native suite and two real QuickPicks using the installed Codex engine: default and live-catalog model selection, checkbox enable/cancel in User and Workspace scopes, and zero inference requests with an empty scope. External-provider request cancellation and Copilot version changes use controlled fixtures; this is separate from live account verification.

Local package: **18 entries**, **757837 bytes**, SHA-256 `b21b87611b67d066d82280702009811aa2f20f1eaea873474ed4f265bfeb6338`. Manifest/runtime/offline manuals match the validated build; README differs only through expected vsce repository/issue-link rewriting. The extracted VSIX, without node_modules, also passed the full native suite and actual two-step Codex model workflow with both cancellation scopes. Publication is recorded separately after verification.

Review traced task ownership, cancellation before and after model discovery, setup serialization, stale-result checks and actual-version cache identity. No remaining blocker was found in this change's reviewed scope. Analysis cache compatibility remains 16. Live Claude account integration and real WSL/SSH account/model catalogs remain unverified; no new claim is made for them.

Evidence: `/tmp/dynsight-89-{red,preparation-red,focused,typecheck,unit,memory,performance,native,ui,worker,large,package}.log` and `artifacts/release-0.1.89/`.
