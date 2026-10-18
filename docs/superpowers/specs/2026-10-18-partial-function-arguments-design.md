# Function arguments with incomplete macro environments

Restore the approved optional function-argument view when the v0.1.33 header
visit bound prevents full preprocessing. This is a correction to the existing
feature, not a new setting or inference mode. The user reports the option is on
and the WSL index is ready; the exact private-project cause is still unconfirmed.
The same omission is reproduced locally when the visit bound is reached.

Follow-up evidence changes the primary diagnosis: the user has no traversal
limit notice, but does have ERR_WORKER_OUT_OF_MEMORY and a misleading Index ready
status with 1,818 files. The traversal fix remains a verified related omission;
it is not the established cause of this WSL failure.

Keep the traversal bound and do not resume pointer propagation from incomplete
preprocessor flow. Retain that file's original flow in a separate Worker-only
`argumentPrograms` field consumed only by the literal/address argument collector.
This is preferable to feeding raw programs back into pointer inference, which
could fabricate executor targets. Waiting for full preprocessing cannot restore
arguments after the deliberate partial fallback.

Resolve direct names against the current project index on every derived revision,
using the existing local-shadow, conditional, unevaluated-expression and source
location handling. Inherit the source call's incomplete flag and reasons. The
existing cyan dotted argument connector and candidate icon/popup distinguish
these source observations from confirmed calls. Do not infer aliases, member
values or function-pointer executions from the fallback flow.

Strip the extra flow before Worker responses. Preserve cache identity, dependency
edits/deletion, Settings projection, both graph directions and exact Context
locations. Keep defaults and layout unchanged. The additional Worker memory
protection below addresses the subsequently confirmed fatal error.

## Worker memory failure

Read V8 heap usage against the Worker heap limit. At 60% usage, reserve headroom
for indexes, literal argument collection, serialization and the next source edit.
Yield explicit partial results from macro environment construction, expansion
and callback propagation. Do not increase the heap limit or automatically exclude
user source folders. A source parse requested while already under pressure is
rejected with an actionable per-file memory-budget notice. A single exceptional
allocation can still exceed available headroom; this is a best-effort safeguard,
not a mathematical bound on all Node/WASM or system-memory allocations.

Macro fallback retains raw calls and argument-only flow with incomplete markers.
Limited cache entries retry when pressure clears. Callback propagation can stop
without discarding directly collected arguments. Memory-limited workspaces show
Partial index; fatal errors show Analysis stopped, never Index ready. Rebuild
after a budget stop or fatal Worker failure creates a fresh Worker to release
the old analysis state. Do not auto-retry the same oversized scope indefinitely.

A real 128-MB-heap Worker with 21 files and repeated conditional macros failed
with the user's exact error before protection. Verify this same fixture completes
with partial arguments and processes a later source. Native error-event injection
checks failed-status preservation and explicit rebuild recovery; this tests host
handling, not the private project's exact allocation hotspot.

Verify the screenshot's six-argument call under repeated includes, candidate
markers, unchanged default-off behavior, no inferred alias/executor edges,
header repair, target deletion, Worker acknowledgement and native navigation.
