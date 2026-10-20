# Callback call-site navigation

User scope: trace the functions called by `cb()` or `ops->callback()`, rather
than a name search or listing callbacks passed as arguments.

Reuse already indexed inferred calls. A dedicated call-site candidate selector
is preferable to automatically choosing a single static candidate (which could
imply certainty) or running more pointer analysis during navigation (which would
increase host latency). Ordinary variable/member resolution stays unchanged.

On an indirect-call selection, show the original call in Context and a
**Callback targets** selector with function names and file/line locations.
Always label results as static candidates, including a single result.
Retain an explicit unknown/partial message when unresolved alternatives exist.
Choosing a function opens its normal Relation graph in the current mode; it can
then be pinned. Existing Pin stops editor tracking as before.

Plan and checks:
1. Add a call-site lookup over the selected file's indexed references. Test
   flow-sensitive assignments, member calls, multiple and unknown targets,
   ordinary variable navigation and unevaluated/direct calls.
2. Connect editor/Context tracking to the candidate selector. Validate stale
   messages, repeat selection, index changes and pin behavior in native VS Code.
3. Validate browser labels/choices, update Help, review the diff, and release
   after local and platform checks.

No inference engine changes, added full-index analysis, symbol-provider takeover
or new background cache. Existing inference limits and partial-index notices apply.
