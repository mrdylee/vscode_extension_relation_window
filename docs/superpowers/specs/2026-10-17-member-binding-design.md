# Typed C member navigation

## Scope and baseline

Continue feature/c-analysis-navigation from v0.1.25 (85b9df5); preserve main and
existing release tags. Deliver the type/member stage, retaining build-free use.

Choose declared-type binding over name-only matching (false cross-type links)
or compiler integration (build configuration overhead). No new panel or icons.

## Behavior

- Collect struct/union fields and declared variable/parameter/typedef types.
- Resolve `object.field`, `pointer->field`, nested fields, parentheses,
  dereference/address expressions and array indexing through declared types.
- Support named aggregates, anonymous aggregates named by typedef or a field,
  typedef aliases/pointer aliases, bit fields and forward-completed tags.
- Keep tag and ordinary-name namespaces separate; local types/variables shadow
  outer bindings. A member never becomes a global variable of the same name.
- Discover types in the same file and included headers (including transitive
  includes). If an include path has several possible matches, retain candidates.
- Selecting a field declaration or use resolves its own aggregate's member.
  Display a compact qualified label such as Motor.state, using the variable
  icon and existing R/W/RW/address filters, actual-site preview and caller depth.
- Do not infer runtime callback targets. Calling a struct's function-pointer
  member remains an indirect Callees leaf; the member itself can be inspected.
- Unknown receiver types, casts, function-return receivers, anonymous-member
  promotion, designated initializers and macro-generated types are unsupported
  in this increment. Never fall back to global name matching for such fields.
- Member access means access to the named field itself; writes through a pointer
  field or into an array field's elements are not attributed as field assignment.

## Architecture

Use optional serialized type/member metadata on existing records, preserving the
worker protocol. A type-info module extracts declarator layers and expression
paths; a member-resolver module binds them using index callbacks. Keep only
per-file/per-owner indexes; invalidate include reachability on file changes and
resolve against current type records on demand. Bound recursive type/expression
resolution and deduplicate candidates to handle malformed code and cycles.

## Validation

Fixtures must separate Motor.state, Sensor.state and a global state; verify all
access filters, typedef chains, local shadowing, nested/array/pointer expressions,
header traversal, conditional duplicates, edits/deletes and unknown receivers.
Test integration in a VS Code host, browser visuals, FreeRTOS and synthetic large
workspace performance. Keep existing Callees and incoming-reference checks.
Package v0.1.26, update Help/README/release notes; publication follows the user's
existing release workflow only after checks pass.
