# Actual RBMS partial-index completion review (0.1.92)

## Requirement and baseline

Resolve `Partial index: analysis limits reached` on the actual RBMS workspace with its existing 147-file scope and `Build_RBMS.bat`. The user authorized fixing, verification and deployment. Public 0.1.91 was insufficient: fresh native verification retained 147 source files but reached analysis limits; selecting the BAT incorrectly changed the active view to zero files and reported ready.

The real workspace was tested directly using isolated native VS Code profiles. Firmware, BAT scripts, compilers and generators were never executed. General/Smart Analysis scopes and project settings were preserved; AI request counts remained zero.

## Changes and review

- The real product configuration header has a guarded prefix followed by more directives. Recognize the prefix and skip it on repeat inclusion, while processing the suffix. Apply guard-condition removal only inside the prefix. The latter restriction was found during local review and verified with a separate failing regression before correction.
- Macro work fell from 384,879 to 261,250 operations; one expensive function's macro variants fell from 25 to 16. Warm replay stopped exhausting its function allowance. Native cold verification then exposed shared phase accounting: 31,590 macro operations left only 68,410 callback operations for another function. Each phase now has a separate cumulative 100,000-operation function allowance; shared project usage and progressive batching remain unchanged.
- Fully retained RBMS summaries need up to 686 effects. Whole-workspace propagation now explicitly uses a finite 1,024-slot/region allowance. The underlying bounded analyzer retains its 256 default for focused callers. The storage allowance participates in propagation-cache compatibility. Tests verify a 700-slot table completes, tighter limits invalidate cached results, and 1,025 slots still produce conservative omissions. Target/alias, function, project-convergence, loop, memory and cancellation protections remain.
- An incomplete build with no usable contextual facts retains the full detailed source index. A verified complete empty build still has an empty projection. This fixes coverage/status rather than suppressing warnings.
- Analysis cache version 18 invalidates older parsing/derivation semantics. No firmware or unrelated product refactoring is included.

## Actual packaged extension acceptance

Extracted 0.1.92 VSIX, native installed VS Code executable, actual RBMS folder:

| Check | Source / active / view files | Status | Macro/callback limit notices | AI requests |
| --- | --- | --- | --- | --- |
| Fresh profile, no build | 147 / 147 / 147 | Index ready | 0 | 0 |
| Select root Build_RBMS.bat | 147 / 147 / 147 | Index ready | 0 | 0 |
| Full rebuild with BAT selected | 147 / 147 / 147 | Index ready | 0 | 0 |

All 1,677 functions complete on cold analysis and full rebuild. The packaged run used about 13.8 seconds to reach the initial settled snapshot; cumulative time through selection and a full rebuild was about 36.9 seconds. Sampled Worker peak heap was 503,945,064 bytes, well below its guard. Project settings hashes were unchanged.

122 ordinary syntax/unsupported-source notices remain visible. This is not a claim that all call targets are statically proven. Diab option semantics and pre-build generators remain unverified, so BAT build membership is still unknown and source fallback is used. No build-specific compiler/hardware validation or WSL OOM resolution is claimed.

Local raw evidence is ignored under `artifacts/partial-index-147/`: prior native baseline, source/package snapshots, failing regressions, storage profiling, tests and native logs. No private RBMS source content is published in this repository.

## Validation

- TypeScript typecheck; 863 unit tests; 95 Worker/cache/workspace tests; six memory tests.
- Index and analysis performance harnesses; both browser UI suites.
- Native source, packaged extension and large-workspace checks. The native limit fixture was advanced beyond the new 1,024 bound so it continues to verify partial-status reporting and recovery.
- Full diff reviewed against the plan, bounded-state semantics and cache compatibility. No outstanding critical/important findings after the suffix-condition correction.

Publication and active-installation evidence is recorded separately after delivery.
