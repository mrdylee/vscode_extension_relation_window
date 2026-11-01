# Post-release OOM validation and additional review: 0.1.93

Validated runtime source: `046924788a26ef8dd54d9253847a67475b3fd210`
(tag `v0.1.93`); review checkout: `1061d78`. The user requested that completed
work and its verification records be consolidated into `main`.

## OOM regression checks

Released 0.1.91, 0.1.92 and 0.1.93 Worker bundles were exercised sequentially
on the same 147 actual RBMS source files, freshly parsed and hash-checked.
No OOM, Worker error or source parsing failure occurred in these measurements.

| Version / workload | Cycles | Actual Worker heap limit MiB | Sampled Worker heap peak MiB | Process RSS peak MiB | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| 0.1.91 / rebuild | 1 | 4144 | 673.5 | 1129.3 | Existing analysis limits |
| 0.1.92 / rebuild | 3 | 4144 | 661.0–738.0 | 1232.4 | Full 147-file analysis |
| 0.1.93 / rebuild | 3 | 4144 | 661.7–729.5 | 1222.3 | Full 147-file analysis |
| 0.1.93 / continuous edits | 5 | 4144 | 698.5–766.6 | 1147.2 | Full 147-file analysis |
| 0.1.93 / low-heap RBMS | 1 | 304 | 188.0 | 627.6 | Memory protection warning; recovered |
| 0.1.93 / conditional-guard stress | 1 | 176 | 107.5 | 314.9 | Protection warnings; recovered |

Normal 0.1.93 cycles retained 1,677 functions and 358 inferred references with
no analysis-limit notices. Each included 3,354 callers/callees queries and
32 bidirectional graphs at depth four. Continuous edits changed only input
buffers, without resetting the Worker between cycles or modifying disk sources.
Worker heap retained after GC stayed at 99.3–99.6 MiB, and fell to 16.5 MiB
after the final reset. No accumulation was observed within these five cycles.

The normal Worker soft protection threshold was 2,486.4 MiB, 60% of its actual
V8 heap limit. Lower-heap tests returned partial-analysis warnings and accepted
a fresh source request after reset. The soft threshold is checked periodically
and is not an absolute RSS ceiling. Six GC/release tests and the existing
bounded-memory Worker test also passed.

The controlled 0.1.92/0.1.93 rebuild ranges overlap; no clear memory increase
was observed for the conditional-guard patch. 0.1.91 stops some analysis early,
so its result completeness differs. Peaks were sampled during processing;
forced GC was used only at retention checkpoints. RSS covers the entire Node
harness process, while Worker and main-isolate heaps were measured separately.
The harness uses the real RelationIndex, not the entire VS Code Extension Host.

## Additional code review

Reviewed the recent `c0318a8..0469247` changes and related guard, budget, cache
and build-fallback contracts. No additional actionable defect was substantiated.
Fresh checks at the reviewed source passed typecheck, 870 unit tests and
96 Worker/cache/workspace tests. A focused 116-test selection is a subset of
the unit suite.

A separate 160-case differential matrix covered eight header postludes,
four initial guard states and five between-include mutations. Clang evaluated
all four concrete A/B assignments per case; the analyzer retained every target
in their union. Twenty-two cases also retained conservative extra candidates.
This checks for omissions in these fixtures, not exact compiler equivalence.

Local evidence is ignored under `artifacts/oom-regression-0.1.93/` and
`artifacts/review-0.1.93-additional/`. Private firmware sources and diagnostic
fixtures are not published with this receipt. Source hashes were unchanged.

## Main consolidation and limits

The named feature branches were already contained in `main`. A detached old
release worktree at `3b08a99` retained four historical 0.1.76 release commits
not present in main's ancestry. Their history and missing release/review
records are consolidated while keeping the current 0.1.93 package manifests
and current changelog. No runtime code, release tag or published asset changes.

Active user-window reload into 0.1.93, cache-19 rebuild and Build_RBMS.bat
restoration remain a separate pending task after the recorded Mac lock.
Unsupported Diab options, compiler defaults, generators and final build
membership remain unverified. No BAT, compiler, generator or AI request was
executed. These checks do not establish resolution of the previous WSL/shared
Extension Host or Ctrl+T OOM, or of every long-duration/UI behavior.
