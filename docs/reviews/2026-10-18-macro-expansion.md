# review-work — macro expansion feature

Reviewed locally against the v0.1.27 baseline and the approved derived-calls
specification before starting the callback feature. No review subagent or
external review service was used. This feature is committed separately; version
metadata remains at 0.1.27 until both requested features are ready for release.

## Findings fixed during review

- **P1, lost derived updates after an ignored response:** Worker results were
  initially treated as sent before the main thread accepted them. Replace this
  with caller-owned applied stamps. An end-to-end Worker test discards a result,
  retries, acknowledges it and verifies a header deletion restores raw calls.
- **P2, macro visibility/order:** Undefines, later definitions and definitions in
  unrelated translation units could still resolve as macros. Preserve active
  macro IDs at source references and filter ordinary resolution in derived files.
  Macro definitions inside a function have preprocessing translation-unit scope.
- **P2, rescan suppression:** A self-wrapping macro must be able to call the real
  same-named function. Completed generated identifiers are no longer expanded or
  resolved as macros a second time. Recursive unresolved names remain explicit
  expanded leaves; malformed/limited expansions retain macro availability.
- **P2, source selection and duplicate sites:** Replacing calls could either
  duplicate an effective direct call in References or discard the original
  conditional macro reference. Retain source macro references independently of
  effective calls and test both References counts and ambiguous source selection.
- **P2, spliced strings:** Line-based directive masking mistook a hash inside a
  spliced string for a directive. Mask actual Tree-sitter directive ranges and
  inactive ranges while preserving original positions.
- **Performance:** Full FreeRTOS derivation initially exceeded 60 seconds.
  Profiling found repeated header environment rebuilding and quadratic choice
  deduplication. Reuse file environments, use keyed choices, cache dependency
  results, collect only calls during reparsing and share invocation-sized previews.
  Include guards avoid exponential absent/present alternatives.

## Verification

- 95 unit tests passed, including 20 macro-specific tests. Original reproducers
  failed before fixes; recursion/expansion limits are explicitly tested.
- Typecheck and git diff whitespace checks passed.
- Built Worker protocol test passed, including discarded responses and stale raw
  versions. Added the Worker check to the three-OS release workflow.
- Browser checks passed; inspected output/playwright/macro-calls.png. Existing
  compact icons and 500 ms hover remain, with tinted expansion text/definition
  chains, original invocation preview and expandable target functions.
- VS Code integration passed: conditional macro selection, expansion navigation,
  outgoing target expansion, header edit and deletion invalidation.
- FreeRTOS passed: 655 files in 22,082 ms, 14,560 possible expanded-call records;
  tracking 107–153 ms. These records include conditional alternatives, not runtime
  execution counts. Existing caller/variable/member checks passed.
- Large workspace passed: 12,551 source files, 2,501 indexed after exclusions,
  50,000 calls, initial analysis 3,916 ms, selection during indexing 83 ms.
- Incremental benchmark passed: 12,500 files / 125,010 references, total update
  about 17.7 ms, single edit about 0.022 ms. Timings are local observations.

## Decision and boundaries

No remaining actionable finding in this feature review. Proceed to function
pointer/callback analysis, then review that feature separately before delivery.

This is build-free, bounded expansion of function-body invocations using indexed
literal includes, definitions and undefines. Unknown build conditions and header
paths retain possible alternatives. It is not a complete compiler preprocessor:
macro-computed include paths, build-option evaluation and consumer-specific
specialization of header inline bodies are not fully resolved. Expansion is
bounded to 32 alternatives, 32 levels, 40,000 tokens and 80,000 work steps per
function; limits and parse failures are reported in Analysis notices. The UI
shows possible static call relationships, not proof of execution at runtime.
