# Persistent indexing and Copilot callback candidates

Approved by the user on 2026-10-21. Checkpoint: `checkpoint/pre-persistent-copilot-cache-20261021`.

1. Repair wildcard dependency invalidation and same-array region lookup.
   Verify declaration-order regression, callback soundness and identical-input performance.
2. Store versioned per-file raw analysis and derived results in workspace storage.
   Validate file contents and inventory on startup; unchanged restart performs zero parses,
   zero relation passes and zero Copilot requests. Initial creation builds locally; invalid
   caches require explicit Rebuild. Save atomically after a stable saved-source generation.
3. Reconcile changed files and analysis settings without clearing unchanged raw analyses.
   Retain dependency correctness across headers, callback registrations, additions and deletes.
   Dirty editor analysis remains temporary; only saved content may enter persistent generations.
4. Add optional Copilot callback assistance via VS Code's Language Model API.
   Require explicit user enable/access; collect bounded relevant context, validate response
   references, label AI candidates separately, cache source/model/prompt dependencies, cancel
   stale work. Navigation never requests AI. Normal Rebuild preserves valid AI results.
5. Show cache and AI activity in Diagnostics and sanitized issue reports. Document settings,
   cache recovery and request limits. Verify real Worker restart/edit tests and mocked LM
   failure/cancellation/cache behavior, then independently review and fix findings.
6. Package/install-test and publish the VSIX with CI on Windows/macOS/Linux; verify public assets.

The private WSL firmware and the user's live Copilot entitlement cannot be exercised here.
Tests must distinguish local parser work, relation propagation, AI calls and installed behavior.

Implementation and local review complete: steps 1–5. Model selection was added
in Settings at the user's request; selecting a model only restores its cache.
Static callback mode-off cleanup skips callback-only initializer expansion while
retaining shared facts needed by existing navigation. Packaged native and browser
checks pass. Step 6 publication and public download verification remain pending.
