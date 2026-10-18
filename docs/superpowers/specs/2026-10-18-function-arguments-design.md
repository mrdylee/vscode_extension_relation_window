# Optional function argument relationships

Approved direction: include function arguments in existing Callers, Callees and
Callers & Callees when Settings > Include Function Arguments is enabled. Default
off. No additional window or relation mode.

For `origin(){ svc(ctx, target); }`, show `origin -> svc` as a call and
`origin -> target` as **Function argument #2 via svc**. Selecting the latter
previews the original argument location. Enter/double-click opens that location.
The target can expand normally. Passing a function does not prove registration,
invocation, asynchronous execution or execution order.

Retain existing 16x16 function icons and solid/dashed icon-border semantics.
Argument-only branches have a cyan dotted connector. Mixed call/argument groups
keep a solid connector, with each location identified in the popup. Labels live
in details/accessibility text, not extra lines in compact graph cards. Preserve
depth, sorting, orientation, Context layout and the combined 300-node budget.

Collect literal/address arguments from parsed flow facts without forcing the
existing expensive pointer pass. Reuse values from pointer analysis when that
pass already runs. Store argument observations separately from ordinary
references, preserving variable selection, R/W filters and References behavior.
Do not reconstruct relationships from truncated textual evidence. Conditional
and macro source locations remain attached to each argument record.

Function-value aliases, fields, table entries and returned values are candidates
only when existing inference resolves them. Do not force that pass solely to
discover arguments. `svc(ctx, target())` passes a result, not the function target.
Passing an object containing callback fields does not itself create a relation
to those callbacks. Unknown/scalar arguments produce no fabricated callback leaf.

Settings toggles graph projection without parsing or reindexing. Argument record
identity and fingerprints participate in Worker results and incremental file
replacement, so target/initializer edits and deletions remove stale links.

Verification: direct/address/opaque receivers; synchronous and queued executors;
aliases and independent origins; return expressions; conditional/macro/sizeof
cases; mixed grouping; default-off/References/RW preservation; unchanged derived
identity and dependency edits; Worker acknowledgement; Settings and source
navigation; dark/light connector rendering; full FreeRTOS and performance.

Baseline experiment and limitations are recorded in the local artifact
`output/argument-benchmark/report.md`. macOS timings are not WSL guarantees.
