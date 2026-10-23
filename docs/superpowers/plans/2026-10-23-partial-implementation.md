# Partial recovery and Copilot eligibility implementation

Execute inline on the current branch, preserving the existing analysis fixes and unrelated review files. User approved proceeding and additionally reported a visible `priv_non_safety_callbacks->cb_preprocess` site with Copilot 0/0.

- [x] Reproduce disabled-local callback eligibility and empty AI scope reporting at the service boundary. Keep explicit AI include/exclude and empty detailed-scope authorization intact.
- [x] Unify visible paths into general Include / Exclude and Smart Analysis Include / Exclude. Smart Analysis has Macro (expansion + local callback propagation, confirmed by the user) and Copilot switches. New shared include explicitly replaces legacy paths; until saved, retain legacy restrictions without silently widening AI scope. Verify exclusions, empty scopes, independent switches and multi-root settings.
- [x] Skip subsequent include environments and reparses after an explicit hard project budget is exhausted. Default project accounting continues across batches so macro work does not permanently prevent independent callbacks; retain cumulative function and memory limits and honest stop/partial results. These are accounting batches, not persisted checkpoints or a new event-loop scheduler.
- [x] Reproduce shared 32-by-9 object inflation in permanent tests. Separate symbolic function effects from caller supplies, preserve actual 257-object limits, unknown-call effects and alias safety.
- [x] Share equivalent conditional program structure while retaining per-variant choices, positions and local identities. Retain correlated numeric-index regression.
- [x] Run targeted red/green tests at each step, then full typecheck/unit/Worker/memory/UI/native checks and focused cold/warm performance comparisons. Require complete results for precise small fixtures; report remaining public-corpus limits separately. No publication is requested.

## Verified outcome

- Four visible path lists; Macro and Copilot switches independent. Macro includes local callback propagation. Hidden old scopes retain per-level precedence, including empty AI restrictions; new shared Include explicitly replaces legacy paths. Folder selection saves exactly the named paths, including when all displayed folders are selected.
- 587 unit tests, 61 Worker tests, 5 memory tests, typecheck and build pass. Browser/scoped UI, native Extension Host, index performance and the large workspace test pass.
- Native FreeRTOS basic scope: 656 files, complete=true, 7.62 seconds. Protected 1024MiB Worker full scope: 656 files, 6.57 seconds parsing + 37.81 seconds derivation, 1254 inferred references, memory-limited partial result. This verifies bounded retention, not full-corpus completion.
- Precise three-file fixtures retain six required candidate sites and complete=true across cold, warm, disk restore and one-file save. Cold detail 34ms, warm detail 1ms, disk restore 117ms (single local measurements).
- Regression probes disable only sharing or the hard-budget boundary in temporary bundles; each corresponding test fails, then passes against the actual sources.
- Partial remains possible from real macro alternatives, loops, mutation/region/context bounds and memory guards. The original private firmware and WSL runtime were not available for validation. No commit, release or installation was performed in this implementation phase.
