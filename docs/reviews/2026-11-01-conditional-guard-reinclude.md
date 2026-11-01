# Conditional include-guard re-entry correction (0.1.93)

Accepted review: a conditional `#undef CFG_H` after a guarded header prefix left CFG_H in the full macro timeline's known-defined set. A subsequent include skipped the prefix, silently dropping `first` while reporting only `second` with incomplete=false. A conditional guard definition before first inclusion similarly lost the skipped-prefix path.

## Correction and review

Reuse the existing uncertain-guard handling in both binding and full macro expansion. The three semantic edits collect guard names for both modes, apply the existing optional guard branch in both modes, and invalidate known definedness after conditional guard mutations in both modes. Unconditional define/undef still clears uncertainty; redefining an already active guard does not add false uncertainty. The guarded-prefix shortcut, suffix processing, branch/event/callback/work/memory bounds, source scopes and AI settings are preserved.

Advance analysis cache compatibility from 18 to 19 to reject saved target sets with these omissions. No second preprocessor or new public configuration is introduced.

Maintained red tests exposed both missing-target cases before production edits; two original controls already passed. New regressions also cover known guard/reset controls, warm result identity, edits to RESET=1/0/unknown and Worker disk-cache restoration followed by a header edit. The extracted VSIX Worker independently reports first/second for unknown RESET, first for 1 and second for 0, with no issues.

Local self-review checked guard definedness transitions, prefix versus suffix branches, scoped facts, cache invalidation and preservation of the actual RBMS limit repair. The accepted P1 is corrected. No additional critical/important findings were substantiated in this diff.

## Actual RBMS acceptance

Extracted 0.1.93 package, native VS Code, same actual folder/settings/scope:

| Stage | Source / index / view files | Status | Macro/callback limit notices | AI requests |
| --- | --- | --- | --- | --- |
| Fresh no-build analysis |147/147/147|Index ready|0|0|
| Select root Build_RBMS.bat |147/147/147|Index ready|0|0|
| Full rebuild with BAT selected |147/147/147|Index ready|0|0|

Cold and rebuild runs complete 1,677/1,677 functions. Initial settled snapshot 13.724 s; all three stages complete in 31.240 s cumulative. Worker sampled peak heap 722,356,228 bytes remains below its guard. Macro replay stays at 261,250 operations / 1,832 program variants with no limit issues; the expensive measured function still has 16 variants. Project settings hashes are unchanged.

One early native attempt timed out before derivation at 25 source parses. An independent fresh macro replay showed no cost/limit increase, and retrying the unchanged implementation plus final packaged verification completed normally. The cause of that initial environment-level stall was not established.

The 122 ordinary syntax/source notices and unverified Diab build membership remain visible. BAT scripts, generators, compilers and AI were not executed. No hardware or WSL OOM claim is made.

## Gates

Typecheck, 870 unit tests, 96 Worker/cache/workspace tests, six memory tests, index performance, both browser UI suites, native source/package integration and the large-workspace harness passed. The full analysis-performance harness also passed; delivery evidence is recorded with the release receipt.

Ignored local evidence: `artifacts/conditional-guard-reinclude/` and `artifacts/release-0.1.93/`. The actual firmware source is not included in this repository.
