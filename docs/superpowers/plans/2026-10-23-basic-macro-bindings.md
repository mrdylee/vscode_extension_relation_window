# Third comment implementation

Preserve the dirty checkout. Implement inline without publication.

- [x] Add red tests for one included definition, include/redefinition order, conditional ambiguity and absent definitions; retain source sites and definition References.
- [x] Bind basic references from bounded directive metadata without body expansion or flow reparsing. Reuse results safely and publish before detailed analysis; verify off/Stop/header edits.
- [x] Group ambiguous macro definitions per binding set and expose definition locations in the existing popup/navigation path. Do not merge different bindings by name.
- [x] Run targeted red/green, full unit/typecheck/Worker/UI/native and a basic FreeRTOS performance check. Compare precision and basic readiness; document remaining uncertainty and limits.

## Verification and limits

- Reproduced the reported raw/basic duplicate: the same main.c@37 reference appeared under both a.h and b.h. After binding, basic has one a.h macro node; actual expansion into a condition continues to remove the Callees leaf.
- 600 unit, 62 Worker and 6 memory cases pass, including use order, undef, guard changes, missing headers, ambiguous include summaries, repeated-include reuse, warm cache/header edits, source retention after cancellation and current popup navigation locations.
- Browser UI and native Extension Host pass. Large workspace: 12551 source files, 2501 indexed, 50000 call sites, 2891ms. FreeRTOS basic: 656 files, complete=true, 10623ms in the latest native run. Earlier native run: 10087ms; binding alone: 1970ms. This adds metadata cost to the prior 7617ms basic baseline.
- Small full-analysis fixtures remain complete with the same six required candidates across cold/warm/disk/save runs. No full-corpus detailed-completion or private firmware/WSL claim is made.
- An initial implementation exceeded the 60-second basic limit; it was replaced with conservative definition-ID unions and cached ambiguous-header summaries. Full macro expansion retains its existing correlated worlds.
- Conditional basic bindings can overapproximate possible definitions. Missing/opaque headers and bounded scans remain visibly uncertain; a list of candidates is not compiler-confirmed preprocessing. Only same-kind macro candidates with the same binding set share a node; different kinds or bindings remain distinct.
- Analysis cache version 8 invalidates pre-binding results. Existing changes were retained. No commit or publication was requested.
