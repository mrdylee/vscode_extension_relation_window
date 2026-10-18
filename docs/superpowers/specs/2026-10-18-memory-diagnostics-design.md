# Photographable memory diagnostics

The user needs a photograph that distinguishes Worker heap pressure, optional
analysis growth and a stopped Worker. Keep English UI and the existing analysis
limits and results. Do not bundle a cache or inference rewrite into this change.

Use a compact Diagnostics overlay in the Relation view, rather than an unbounded
text log or a separate VS Code output window. Open it manually from the footer;
open once automatically for a new memory-limit incident or Worker failure. Keep
the close/refresh controls mounted while measurements update. Preserve the last
Worker snapshot on failure and explicitly label it as a past measurement.

Show extension/version/environment, index status/count, selected symbol/mode,
Worker JS heap used/limit/60% guard, sampled peak and external memory, the first
budget detection in this rebuild, source text characters and raw analysis counts,
and before/after heap values for sources, macros, callbacks and result transfer.
Show extension-host heap separately; never call process RSS Worker memory or add
these numbers into a system RAM estimate. Stage differences include GC and cache
effects; a checkpoint is not allocation attribution or a guaranteed peak.

Worker measurements travel as small bounded messages at phase boundaries and at
most every 500 ms during existing pressure checks. No source contents, full paths,
per-reference logs or growing history. Diagnostics-only updates must not rebuild
or resend the graph. Refresh requests one Worker snapshot and measures the host;
if the Worker is busy, retain and timestamp the last sample until it responds.

Verify real Worker phase order, measured limits and preserved first-budget data;
verify host failure retention, no graph recomputation, screenshot layout and
automatic-open dismissal behavior. Deliver a versioned VSIX and bundled Help.
