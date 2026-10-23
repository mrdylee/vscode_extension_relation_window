# Numeric dependency roots and readiness diagnostics

Continue the approved analysis investigation inline. The user confirmed that only
the report was uploaded; section 9.5's implementation is absent here. Preserve
the existing analysis.md review and implement only the reproduced defects.

Use the existing backward scalar-dependency graph. Branch/loop conditions must
still be visited for assignments and calls, but their numeric truth values do
not seed dependencies because execution joins both possible paths. Array indices
seed dependencies unless every possible element type is proven numeric data.
Reads still return dependencies so actual callback consumers can demand them.
Unknown types, pointer/callback elements and ambiguous declarations remain
conservative. Inspect all relevant type alternatives, including member/nested
array accesses; never infer type from names.

Raising limits leaves the false dependency roots intact. Replacing the full
summary engine would exceed this repair. The narrow root correction preserves
the existing 32 alternatives, 256 slots/regions, 64 contexts, function work guard,
memory guard, file limit and side-effect evaluation.

Expose the live failed-source count and a specific source-failure wait reason.
Keep freshness (`detailedCurrent`) separate from completeness: diagnostics label
fresh limited or failed-input results `current (partial)`, and basic navigation
blocked by source failures `blocked`. Preparing work retains its existing label.
Show a clear wait message rather than silently returning no reason.

Use real C/Worker regressions and the existing browser harness. Bump analysis
cache compatibility to 9 only with the semantic fix. No new settings, dependency,
release version or private-target completion claim is part of this change.
