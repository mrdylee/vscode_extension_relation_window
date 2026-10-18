# review-work — optional function arguments (v0.1.31)

Local review of the implementation against the approved function-arguments spec
and plan. Source baseline: `fedd083`; approved plan commit: `3e27bb0`.
The review was performed locally; no review agent or external review service
was used. Existing feature branch and production extension installation retained.

## Findings fixed

- **P2 — conditional expressions looked certain:** `svc(flag ? target : other)`
  initially emitted both function arguments without a candidate marker. Added a
  failing real-analyzer regression, propagated conditional-value uncertainty,
  and verified candidate markers in both incoming and outgoing projections.
- **P2 — conditional local shadows lost uncertainty:** a local `target` declared
  only under `#if BOARD` could make the possible outer function appear certain.
  Added a failing regression. Preserve `globalFallback` and the complete binding
  candidate set when creating direct arguments; details retain the reason.
- Conservatively merge conditional/macro variants, partial-result reasons and
  bounded evidence. Directly written function names retain their independent
  evidence even when the general pointer pass is partial.
- Keep the disabled/empty incoming-query path on its existing reference array;
  avoid a new array copy for ordinary variable/reference/caller queries.

## Scope and review checks

- Function argument data is separate from ordinary references and actual calls.
  Original variable selection and R/W filters do not acquire derived targets.
- The owner is the containing function, including declaration initializers.
  Typed callbacks in fields/tables reuse existing known values. Passing a struct
  that contains callbacks does not fabricate edges to its fields.
- Function arguments, actual inline/queued executors and unknown receiver bodies
  retain distinct meanings. Calling a function and passing its return value does
  not create an argument edge to that called function.
- Per-round observations replay with function-cache results. File fingerprints
  include arguments, and Worker acknowledgement, edits and dependency deletion
  remove stale targets. Equivalent literal-only files retain derived identity.
- Default-off Settings projection does not reindex. Mixed call/argument groups
  keep their call kind and solid connectors; argument-only branches are dotted.
  Icons remain compact, and candidate borders keep their separate meaning.
- Incoming and outgoing selection preview the original argument. Enter opens it;
  expansion, source sorting, reversed sides and the shared 300-node budget remain.

## Verification

- Typecheck and whitespace checks passed. **158 unit tests** passed, including
  **20 function-argument cases**. Missing-feature tests failed first; both review
  findings were separately reproduced before their fixes.
- Built Worker test passed, including argument dependency edits/deletion,
  discarded-response replay, acknowledged identity and flow facts staying in Worker.
- Browser suite passed: exact argument preview/open, one-line node height,
  accessible labels, receiver/index details, solid mixed groups, dotted branches,
  preserved candidate icons, light/dark themes and reversed incoming placement.
  Inspected `output/playwright/function-arguments.png` and the light/reversed view.
- Extracted final VSIX passed the native VS Code Extension Host suite, including
  default-off/enable/disable, index reuse, incoming/outgoing source navigation and
  target expansion. Packaged bundles match the current build byte-for-byte.
- Extracted final VSIX passed full FreeRTOS: **655 files**, **30654 ms**
  to index readiness and **915 function-argument records in this
  run**. Enabled/disabled graph queries retained the 300-node budget. Maximum
  median enabled query among tested roots/modes/depths: **1.642 ms**.
- Large workspace passed: 12551 source candidates, 2501
  scoped files, 50000 calls; 4189 ms indexing and
  82 ms selection in the existing responsiveness scenario.
- Offline Help, README, changelog, default-off configuration, version and WASM
  assets are present in the packaged artifact.

## Delivery

Local package: `artifacts/c-relation-explorer-0.1.31.vsix`
Size: 507826 bytes.
SHA-256: `771001523714a32044b8ccdb6a5eda4e4c8c061e39750c220cb35be6b2e8a577`.

Rollback checkpoint: `checkpoint/before-function-arguments-20261018` -> `fedd083`.
Reviewed feature checkpoint: `checkpoint/function-arguments-reviewed-20261018`
will identify the local implementation commit containing this review.
No push, GitHub release or replacement of the user's installed extension was
requested or performed.

## Remaining limitations

No remaining actionable finding in the reviewed scope. These are static source
relationships, not proof of runtime execution. Existing FreeRTOS callback loop,
mutation and 10-second time-budget notices still apply; inferred candidate sets
are partial and may depend on analysis order/budget. Argument aliases are included
only where existing pointer analysis runs and resolves values; direct names and
addresses keep their light path. No new compiler/build configuration is required.

Runtime/browser validation was on macOS. Windows and WSL runtime validation was
not performed for this version. Native indexing elapsed time includes its test
host conditions and is not a controlled before/after slowdown percentage. The
previous temporary performance experiment is not presented as a final-version
cross-platform guarantee.
