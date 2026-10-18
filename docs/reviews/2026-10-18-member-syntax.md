# review-work — build-free member syntax (v0.1.32)

Local review against baseline `cc582f2` and the approved option-1 member syntax
specification/plan. No review agent or external service was used. Existing
production installation and feature branch retained.

## Findings fixed

- **P2 — intermediate designators claimed whole-field writes.** A path such as
  `.items[0].state = 1` initially marked `items` as written. Reproduced with a
  failing test. Keep intermediate field tokens selectable but classify only a
  terminal field designator as a write; preserve sizeof/alignof exclusions.
- **P2 — positional nesting ignored anonymous fields.** Initial field indexing
  omitted the anonymous aggregate from the containing layout's initializer
  order. Reproduced with a failing anonymous-union/next-field example. Merge
  anonymous and ordinary fields in source order for this type-only operation;
  keep callback storage layouts unchanged.
- **P2 — uncertain positional layout guessed a receiving field.** Conditional
  fields and scalar brace elision can change what an ordinal initializes.
  Reproduced conditional-layout and scalar-continuation failures. Leave uncertain
  layouts unresolved; reject unsupported syntactic continuation with an English
  Analysis notice. Union positional initialization uses only the first member.

## Scope and review checks

- Casts use their explicit lexical type, including abstract declarator layers.
  Declared returns remove the function/callback layer while keeping remaining
  pointers/arrays and the typedef's declaration context. They do not analyze the
  runtime object or infer a callback's actual executable target.
- Only actual anonymous struct/union fields promote members. Named nested fields
  stay explicit; original field IDs remain separate from globals/other types.
  Anonymous ownership is indexed separately and invalidated on update/remove/reset.
- Initializer paths retain original field-token positions and function/variable
  ownership. Nested field/array designators and compound literals reuse the same
  type resolver. Terminal writes retain existing R/W filters and Context links.
- Unknown receivers/types are never resolved by spelling alone. Keep bounded
  traversal/candidates, conditional alternatives and existing graph behavior.
- No scalar alias/write propagation, memcpy model, pointer arithmetic engine,
  compiler backend or runtime tracing was introduced.

## Verification

- Missing-feature regressions failed first: **10 failures** before production
  changes. The three review findings were separately reproduced before fixes.
- **173 unit tests** passed, including **41 member tests**. Typecheck, build and
  whitespace checks passed. Header edits/deletion and anonymous index reset are
  covered; existing macro, callback and function-argument cases remain green.
- Built Worker acknowledgement/replay/invalidation test passed.
- Native VS Code Extension Host passed, including cast/returned/anonymous/
  initialized member selections, qualified names, exact Context locations and
  editor opening. Existing tracking, layout, argument and update checks passed.
- Existing browser suite passed; no webview layout, icon or hover behavior changed.
- FreeRTOS **655 files**, **31,669 ms** to readiness, completed without opening
  source documents during indexing. Existing actual-site, member, variable and
  caller/callee checks passed. Tested automatic tracking observations: 106–164 ms.
  Existing callback loop/mutation/time-budget notices remain; this is not complete
  inference of all runtime targets. Windows/WSL runtime was not tested here.

## Controlled local comparison

Same Node process, old sources exported from `cc582f2`, alternating baseline/new
order, 41 files / 400 functions, ten rounds with three warmup rounds excluded.
Indexing includes parsing and index insertion; query timing excludes UI rendering.

| Workload | Baseline indexing | New indexing | Change | Baseline/new reference sites | Baseline/new query |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ordinary member uses | 29.620 ms | 29.964 ms | +1.2% | 400 / 400 | 0.394 / 0.391 ms |
| Cast, returned and initialized members | 67.923 ms | 75.638 ms | +11.4% | 400 / 1,600 | 0.383 / 1.274 ms |

These synthetic medians are local observations, not a universal slowdown claim.
The second workload deliberately exposes four times as many source uses. Its
additional query work does not invoke a compiler or a new runtime pointer pass.
Raw comparison: `/tmp/c-rel-member-syntax-comparison.json` (not packaged).

## Local delivery

Final package: `artifacts/c-relation-explorer-0.1.32.vsix`, 510,463 bytes.
SHA-256: `a5542b2ff6359c97a5cfc4f82c92ca41a784b7d6f53d9d1eea8236bf7a323c13`.
Extracted manifest reports v0.1.32, bundled Help includes the new coverage, and
all four production JS/CSS bundles match the verified workspace byte-for-byte.
The native Extension Host suite passed from the extracted VSIX, including the
new member syntax checks. Detailed results: `test-results/package-0.1.32.json`
and `test-results/extension.json` (ignored local evidence).

Rollback checkpoint: `checkpoint/before-member-syntax-20261018` -> `cc582f2`.
Reviewed checkpoint: `checkpoint/member-syntax-reviewed-20261018` identifies
the implementation commit containing this review. No actionable finding remains
in the reviewed scope; documented static-analysis limits remain. No push or
GitHub release publication was requested or performed.
