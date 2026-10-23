# Callback region computation reuse

2026-10-23. Approved scope: reduce repeated region lookup/path/invalidation work while preserving callback candidates and existing protection limits. Continue in the current checkout and preserve the pre-existing audit documents.

The current synthetic case repeats an opaque mutation, precise callback assignment and call on the same nested array field. Increasing repetitions from 8 to 80 increases path parsing from 389 to 3845 calls although the same six path suffixes occur. All 8/80 candidates are currently complete. The earlier public profile also identifies `regionPath`, `matchingRegions`, and `invalidate` as substantial costs.

Use a bounded cache of immutable parsed storage paths for one `inferPointerCalls` invocation. Clear it at 4096 entries; eviction only repeats parsing and never removes analysis facts. Skip matching an empty region collection and reinserting an already registered root. For invalidation, preserve symbolic `$arg:` resolution and its dependency recording; concrete non-byte roots need no symbolic resolution. Byte-range writes keep the existing containing-array resolution, including concrete array-element destinations.

Alternatives: caching read/invalidation results risks stale writes, parameter dependencies and heap changes; removing containment checks requires a larger correctness proof. Neither is part of this change. Do not change candidate unions, wildcard semantics, write stamps, context accounting, cancellation checks, analysis work units or the 256/64 limits. The path cache cannot survive a source revision. Existing disk results remain semantically compatible; keep cache compatibility version 9.

Verification: add a failing operation-count regression before changing production code, preserve full candidates/locations/conditions/incomplete flags in old/new Worker comparisons, test wildcard mutations and later overwrites, retain real-limit/independent-object tests, run unit/Worker/cache/memory/UI checks, and compare a completed synthetic benchmark. A timed-out public input may locate remaining costs but cannot establish full-output equivalence or original-firmware completion.
