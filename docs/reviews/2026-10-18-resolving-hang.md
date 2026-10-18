# review-work — stalled call analysis (v0.1.33)

## Symptom and scope

User screenshots show v0.1.32 on WSL. The user confirmed that
`Resolving calls and callbacks…` remains for more than one minute after initial
navigation worked. The private source workspace and WSL process were not
available on this Mac; an exact customer-project root cause is unconfirmed.

## Reproduced root cause

Macro include `timeline()` counted emitted define/undef events and stack depth,
but not header visits. An acyclic graph of repeatedly included headers without
macro events therefore generated exponential work without reaching the event
limit. The callback inference budget starts after this stage and cannot stop it.
The single Worker queues following source analyses behind that work.

Before the fix, a 29-file, depth-27 real Worker fixture kept derive and the next
source request pending at 2,501 ms; its regression failed at the 3-second deadline.
The smaller direct probe grew from 7.5 ms at depth 12 to 792 ms at depth 20.
This establishes a concrete failure mechanism matching the reported stuck stage,
without claiming that the inaccessible user's includes have that exact structure.

## Fix

- Bound header visits to 40,000 per file timeline, independently of the existing
  event/depth limits. Parent traversals stop after this new bound is reached.
- When the visit bound is hit, retain original source-call locations as partial
  candidates and report `Macro include traversal limit reached`. Do not derive
  macro/callback targets from that incomplete environment.
- Preserve dependency caching, stable result identity and automatic recovery
  after relevant header edits. Product changes are confined to project-analysis.ts.

## Review finding fixed

The first fallback also caught the existing event/depth limits. That discarded
too many previously available FreeRTOS expansions (163 call records). Instrumented
macro analysis showed 219 existing event limits at roughly 383 visits and 40,000
events, distinct from the new repeated-visit problem. Restore their earlier
handling and apply the new fallback only to the visit limit. A failing regression
now protects existing depth-limited expansion behavior. Strengthen the native
FreeRTOS check from merely nonzero to over 10,000 expanded call records.

## Verification

- Two missing-bound unit regressions and the real Worker liveness test failed
  before the production fix. **177 unit tests**, typecheck/build and whitespace
  checks passed after the review correction.
- Both Worker tests pass: queued-source liveness and existing acknowledgement,
  replay, dependency edits/deletion and cache identity.
- Equivalent standalone queued-source probe now completes in **31 ms**. The full
  Worker liveness regression including startup completed in about **54 ms**.
  Timings are local observations, not WSL performance guarantees.
- Native Extension Host passed: pathological includes emit a partial notice,
  Relation still selects the source function, header repair removes the notice,
  and later source edits update its outgoing calls. Existing navigation, member,
  callback, function-argument and layout checks remain green.
- Full FreeRTOS: **655 files**, **33,289 ms** to readiness, **15,326 expanded call
  records**, tracking observations **111–156 ms**. Existing callback loop/mutation/
  10-second budget notices remain. Original actual-site, variable/member filters
  and caller/callee checks passed; expanded-call coverage is retained.
- Extracted v0.1.33 VSIX passed the native Extension Host suite, including the
  new bounded-include scenario. Production JS/CSS bundles match the tested build;
  manifest and bundled Help report 0.1.33.

## Local package and status

`artifacts/c-relation-explorer-0.1.33.vsix`, 511,145 bytes.
SHA-256: `fabfcff59fbe03d60d96b4e8574da0572424dfcaecbca7a0be8e6c16a67327f8`.
Detailed ignored evidence: `test-results/package-0.1.33.json`, `extension.json`,
`freertos.json`; red/green reproduction logs are in /tmp/c-rel-resolving-*.

Rollback: `checkpoint/before-resolving-hang-20261018` (v0.1.32 working source).
Reviewed checkpoint: `checkpoint/resolving-hang-reviewed-20261018`.

Status: **DONE_WITH_CONCERNS**. The reproduced queue-blocking defect is fixed
and locally verified. Exact confirmation on the user's WSL source workspace is
still required; this fix does not establish a whole-project wall-clock deadline
or eliminate all possible analysis delays. Continue the already authorized
publication workflow with hosted Windows/macOS/Linux verification before release.

## Publication verification

- GitHub Actions **39099286995** completed successfully: Windows, macOS, Ubuntu
  and release jobs all passed. The public latest release is v0.1.33:
  https://github.com/mrdylee/vscode_extension_relation_window/releases/tag/v0.1.33.
- Release tag resolves to `deb32bcda3c47d99ae6714eb95f9fc946d9c7aea`; published
  2026-10-18 at 05:07:13 UTC. Feature checkpoints and prior version tags remain.
- Downloaded all four public VSIX copies and SHA256SUMS.txt. Each VSIX is 511,145
  bytes, reports 0.1.33, and matches the published checksum. Platform-labelled
  copies are identical universal packages.
- Public VSIX SHA-256:
  `5e27896d26303fba8df697ffc23c841f064130adda753744417ddeaf8774927f`.
  All four production JS/CSS bundles match the locally verified implementation;
  bundled Help includes the traversal-limit behavior.
- The production update selector recognizes the actual latest-release metadata
  from 0.1.32; download size/digest validation accepts the downloaded public VSIX.
  Detailed evidence: `test-results/release-0.1.33/verification.json` (ignored).
- This records publication results, not exact reproduction on the user's private
  WSL project. That confirmation remains the stated verification concern.
