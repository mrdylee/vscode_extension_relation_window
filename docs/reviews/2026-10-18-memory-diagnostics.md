# Memory diagnostics review-work

Scope: the user's request for a photographable memory log. No cache lifecycle,
analysis accuracy, memory threshold or indexing scope changes. Version 0.1.38.

## Review

- Worker reports V8 heap used/limit and external memory. Host heap is measured in
  the host and labelled shared. Neither is presented as system RAM or Worker RSS.
- Keep four phase rows, one current sample, one sampled peak and one first-budget
  incident. Counters are incrementally replaced/removed, not recomputed over the
  project at every pressure check. Diagnostic payloads remain below 10 KB in the
  real low-heap test and do not carry source/reference arrays.
- Samples travel at phase boundaries and at most twice per second during existing
  memory checks. A separate event sends only diagnostics to the webview, preserving
  graph identity. Refresh uses the existing Worker queue, so busy snapshots are
  explicitly timestamped rather than claimed to be live.
- Preserve the first incident after GC and the final received snapshot on Worker
  termination. Preserve error codes. Rebuild resets the diagnostic session; Help
  instructs the user to take the photo before rebuilding/reloading.
- Escape/Close dismiss the modal; repeated samples of the same incident do not
  reopen it. Controls are not recreated on metric updates. English labels,
  highlighted guard/incident, and 900x500 fit were visually checked.
- Review caught a test synchronization race: the previous spontaneous sample
  could arrive before the reset sample. The test now waits for the new run ID.
  Screenshot validation also caught five pixels of overflow; spacing was reduced
  without reducing the main 13px text or 16px memory figures.

No remaining blocking findings in the changed code. User WSL memory consumption
and its underlying allocation cause remain unmeasured; this feature gathers that
evidence and does not claim to fix the reported memory exhaustion.

## Validation

- RED: existing Worker produced no measurements; native host lacked diagnostics;
  browser lacked the Diagnostics button. Captured before implementation.
- TypeScript check and all 185 unit tests passed.
- Four real Worker tests passed, including actual 128 MB heap pressure, preserved
  first incident, bounded payload, reset, editing counters and continued parsing.
- Native VS Code host integration passed: measurements, diagnostic-only refresh
  preserving graph, injected fatal Worker error retaining data/code, recovery.
- Browser checks passed: manual/automatic open, dismiss once, refresh, stable focus,
  Worker-stopped state, photo fit and existing navigation/layout regressions.
- Existing incremental index performance checks passed (12,500-file fixture).
- Packaged VSIX runtime files and offline guide byte-match the tested files.

Ignored evidence: `test-results/memory-diagnostics-*.log` and
`output/playwright/memory-diagnostics.png`. The browser screenshot uses explicit
synthetic numbers to test the partial-memory layout, not the user's WSL readings.

Package: `artifacts/c-relation-explorer-0.1.38.vsix`, 521454 bytes.
SHA-256: `db6d8e1760f2b72e3d3d0495d51549ce7f02c9e7c0b1b95056980e8ecf74cdb8`.
Prepared locally; no GitHub release published by this change.
