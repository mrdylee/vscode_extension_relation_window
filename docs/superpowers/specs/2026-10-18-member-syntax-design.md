# Build-free member syntax coverage

Approved direction: improve the existing analyzer only (option 1). Baseline:
`cc582f2`, v0.1.31, on `feature/c-analysis-navigation`.

## Behavior

- Bind members through explicit casts and declared function/callback return
  types, preserving declaration scope, typedefs, pointer/array layers and source
  locations. A cast supplies its written type, not proof of runtime object type.
- Promote fields of actual C anonymous struct/union members. Named nested
  fields remain accessible only through their names. Preserve conditional
  alternatives and the identity of each underlying field declaration.
- Bind field designators in variable and compound-literal initializers to the
  receiving type, including nested designators and array elements. Show them as
  writes at the original field token; function-local initializers belong to the
  containing function and global initializers to the initialized variable.
- Unsupported member receiver/initializer expressions produce English Analysis
  notices rather than being silently discarded. Unavailable type definitions
  remain unresolved; never guess from a field name.

## Implementation

Extend the compact declared-type/expression facts in `model.ts` and
`type-info.ts`. Evaluate these facts in `MemberResolver`; do not invoke another
parser, compiler or runtime engine. Keep anonymous aggregate ownership separate
from ordinary named fields so existing callback layouts do not change.

Keep work bounded by the existing 32-step/64-candidate traversal limits. Reuse
the current file buckets, header visibility and invalidation on edits/deletions.
Existing graphs, exact call sites, R/W filters, icons and the 300-node display
budget remain in use.

No scalar alias/write propagation, memcpy interpretation, pointer arithmetic,
Clang integration or runtime tracing is part of this change. Type binding does
not establish object identity or prove execution. Macro-generated types and
complex positional initializer continuations may remain unsupported with notices.

## Acceptance

Real parser/index tests must first reproduce missing cast/return/anonymous/
initializer links, then verify exact source positions and R/W filters. Negative
cases must keep unrelated types, unknown receivers and mismatched operators
separate. Check conditional candidates, local scopes, header edits/deletion and
callback regressions. Verify native Extension Host navigation and the FreeRTOS
corpus; compare representative indexing/query timings without asserting a
cross-platform performance guarantee. Review locally before any publication.

The development version becomes v0.1.32. Preserve checkpoint tags, update bundled
Help/README/changelog, and prepare a local VSIX. Publication requires a separate
user request.
