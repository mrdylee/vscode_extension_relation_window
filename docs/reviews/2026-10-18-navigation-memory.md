# Navigation memory investigation and review-work, pending 0.1.37

Symptom: the user reports that following Callees worked temporarily, then Relation
became blank and stopped responding. They suspect memory. Their current WSL error
text has been requested; it has not yet been supplied. The exact private-workspace
failure is therefore not established as the defect reproduced below.

## Reproduced root cause

`RelationIndex.callees()` copied all candidate IDs for every candidate and every
call site. For N possible same-name definitions and M uses, this stores O(N²M)
candidate-ID entries. `graph()` limits nodes to 300 only after the full relation
list is materialized, and forwards candidate arrays to the webview. The webview
does not use this resolver-only metadata, but JSON serialization repeats it.
This can exhaust the extension host or view memory during navigation independently
of the analysis Worker's existing heap budget checks.

Controlled reproduction uses 800 board-specific same-name definitions and 25 call
sites. A Node child limited to a 128-MB heap terminates with the actual fatal
JavaScript heap out-of-memory error before the fix. A smaller 100-definition,
20-call graph serializes to 7,405,187 bytes.

## Fix and review

- Compute and share candidate IDs and ambiguity once per call in Callees.
- Keep complete candidate IDs in `relations()` for resolver consumers. At the
  displayed GraphNode boundary, remove only the unused candidate-ID field with
  an explicit type. Actual sites, function-argument/expanded/inferred evidence,
  ambiguity, source locations, graph depth, sorting and the node limit stay intact.
- Reviewed Callers, References, variables, combined mode and pin/preview/open
  consumers: all navigate using existing site/symbol IDs and locations; none
  reads graph-site candidate lists. No unrelated cache/recovery changes, heap
  increase, site truncation or speculative automatic retry was added.
- No external reviewer/subagent was used. The fix covers a reproduced navigation
  allocation defect; it must not be reported as proof that every WSL stop is fixed.

## Verification

- New semantic regression failed before the fix and passed after it: 150 possible
  definitions retain all 20 original sites and ambiguity, resolver candidate lists
  remain complete, and the displayed serialized graph stays below 2 MB.
- Fresh typecheck, all 185 unit tests, four real Worker tests and index performance
  checks passed. Existing browser UI and native Extension Host integration passed,
  including call-site previews, variable filters, callback arguments and recovery.
- The original 800/25 child reproduction completes under the same 128-MB heap.
  The 299-child truncated graph serializes to 2,196,739 bytes, with sampled heap
  about 14 MB. The 100/20 payload is 595,187 bytes instead of 7,405,187 bytes.
- Repeated 100 bidirectional/Callees graph builds under 128 MB complete. After
  explicit collection every ten iterations, sampled heap remains approximately
  12.7 MB rather than growing with navigation history. These are synthetic Node
  measurements, not WSL process or total VS Code memory measurements.
- The extracted v0.1.37 VSIX passed a real native VS Code navigation smoke:
  101 source files, 100 same-name implementations, 20 uses per candidate and
  40 alternating function selections. Each graph rendered the expected nodes;
  hovering a candidate retained all 20 original locations. Sampled Extension Host
  heap varied about 38–50 MB without monotonic growth (RSS about 219–243 MB).
- Final local VSIX: 517123 bytes, SHA-256
  `53dbe795035e80438805d8bb7001107ab8ef5e78f382151e263d7a7f844d3d9b`.
  Both runtime bundles, version label and offline Help match the tested package.

Ignored evidence: `test-results/navigation-memory-*` and the probe under
`output/playwright/navigation-memory-probe.ts`. Await the user's actual Analysis
notice/status to distinguish Worker failure, extension-host/view failure and
other causes in their workspace. No publication is claimed by this review.
