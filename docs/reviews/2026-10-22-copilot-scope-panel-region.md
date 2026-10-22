# AI path scope, Combined placement and region-limit investigation

## Requested behavior

The user chose ordinary JSON/Settings arrays instead of a new scope dialog.
General Include paths seed `copilotInclude`; new general paths are copied, and
removing a copied path from AI Include remains effective after restart or adding
other paths. Removing a general Include path also removes its AI copy. Empty AI
Include permits zero AI requests. Per-folder settings are supported.

Only callback invocation files are scoped. Supporting targets and evidence may
come from other locally indexed files. Excluded sites are omitted from AI hints
and pending counts, and their cache remains available when the scope is widened.
Scope edits abort active work and restore eligible cache without making new
requests. Static analysis continues to use the separate general Include/Exclude.

Combined placement adds native panel alignments that keep either sidebar full
height, plus explicit Center. Keeping the physical left sidebar uses VS Code's
Right alignment; keeping the right sidebar uses Left. Rapid changes are queued
and checked so an older alignment cannot override the last choice. Terminal and
other bottom-panel views share VS Code's alignment.

## Region-limit finding

`Callback region limit: 256 reachable objects` originates in local static flow
analysis in `src/pointer-targets.ts`. It bounds ordered invalidation regions,
reachable-object traversal and exported function-region summaries. A region is
an abstract storage location, including fields, pointees and parameter/global
storage propagated through calls. This is separate from the number of callback
functions, AI requests and model tokens.

The propagation stage evaluates functions and joins their parameter/return/
mutation summaries. Missing function bodies or unresolved callees make pointed-to
storage potentially mutable, so passing many callback storage addresses to such
calls can fill the region budget. Effects from called helpers also accumulate in
the caller's summary. Limits retain conservative uncertainty instead of claiming
a unique resolved target.

Reproduction: a synthetic `heavy()` function calling an undefined `opaque(void*)`
with 256 distinct callback storage addresses yields no region warning. At 257,
it reports `stage=propagation`, `operation=ordered-region`, `retained=256`, first
omitted `cb256`; the caller can also report a region limit while importing those
effects. Existing safety tests also cover function-region and traversal limits.

`WorkspaceIndex.completedStatus()` maps this notice to `Partial index`. The AI
Analyze command waits for `workspace.whenIdle()`; it does not directly rebuild
the source index. Thus the local limit can be observed as the command waits for
local completion. The exact user's triggering function is not known without
their complete Analysis notices entry (file/line, function, operation and omitted
storage). No analysis limits or inference semantics were changed for this task.

## Validation

- Typecheck and production build passed.
- All 437 unit tests passed, including copying/preserving JSON path selections,
  multi-root settings, zero requests for an empty scope, cache reuse and active
  request cancellation; native panel command mapping and rapid changes.
- Node 22 Worker cache/workspace suite: 39 tests passed. The existing region and
  callback safety tests passed as part of the unit suite; a 256/257-object
  reproduction produced the notice described above.
- Chromium UI checks passed, including scoped progress and all Combined modes
  retaining both Context and Relation panes. Native Extension Host assertions for
  the new alignments were added but not run in this environment, which has no
  VS Code/Xvfb installation. Physical workbench placement remains for release CI.
- No version tag, release or remote deployment was created.
