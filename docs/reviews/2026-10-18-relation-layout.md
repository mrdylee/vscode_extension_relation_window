# review-work: Relation layout and navigation

Scope: v0.1.28 to the optional source sorter, both-direction graph projection,
background pan, and shared Combined/Separate Context surfaces for v0.1.29.
Reviewed locally against the approved design; no review subagent was requested.

## Graph projection

- Name order and Combined remain defaults. Source order uses original call offsets,
  not target-definition positions or inferred-target names. Derived calls and
  repeated direct calls interleave correctly and popup sites follow source order.
- Left/right branches have distinct keys and direction-specific traversal. A cycle
  stops its path. Both directions share the existing 300-node display limit.
  Variable access relationships retain incoming traversal in both mode.
- Tests cover first-call grouping, nested depth, inferred/macro calls, independent
  expansions/collapse, recursion and a deliberately oversized both-direction graph.

## Controller and split view

- Both native webviews share one WorkspaceIndex and validated preview/navigation
  controller. The separate surface receives preview data rather than the full graph.
- Only include/exclude/skip changes rebuild the analysis index. Sorting/layout
  choices update workspace configuration and graph/view state without reindexing.
- Native Context view registration is conditional on Separate; existing editor/view
  docking is left to VS Code. Late disposal of an older view cannot clear a newer
  instance. Ready handshakes republish the latest preview.
- Extension Host tests verify configuration persistence, native Context resolution,
  shared index identity, invalid-setting rejection, code navigation and restoration.

## Interaction findings and fixes

1. Expanding a left caller subtree changes the graph width and could move the root
   horizontally. Preserve the root's screen position when rebuilding the same dual
   graph, while new roots/mode changes reset the viewport. Browser regression added.
2. A visual checkmark contributed to menu-item accessible names. Give radio items
   explicit labels so checked and unchecked choices retain stable names.
3. Native view resolution and browser/extension message delivery are asynchronous.
   Tests now wait for provider resolution/message completion before asserting focus.
   No arbitrary production delay was added.
4. Context readiness previously republished the full Relation payload, and preference
   writes could refresh twice through their configuration event and message handler.
   Send only the preview on Context readiness and skip the redundant refresh when
   the configuration listener has already applied the preference.

Background drag starts outside nodes, uses a 6px threshold and sends no extension
messages. Pointer cancellation/lost capture clears dragging state. Popup delay,
keyboard expansion, immediate double-click, Context text selection and syntax colors
are covered by existing plus extended browser checks. Escape and Shift+F10 work for
the menu. A reset action recovers an offscreen graph.

## Performance evidence and limits

Live Mac Extension Host, full 655-file FreeRTOS corpus: initial index 32,274ms,
zero C editor documents opened during indexing. Median graph projection times over
five samples for prvUnlockQueue/vTaskSuspendAll/xTaskResumeAll:

| Depth | Callers | Callees | Both |
| --- | --- | --- | --- |
| 1 | 0.16–0.38ms | 0.02–0.08ms | 0.18–0.43ms |
| 3 | 0.22–2.10ms | 0.17–0.85ms | 0.67–1.55ms |

Deep results can have different node counts due to truncation; these are not equal-
work benchmarks or end-to-end UI/WSL latency claims. Callback inference in this
all-platform corpus still reports its pre-existing bounds. This change does not
claim to resolve every callback. Final verification and packaging are recorded below.

## Final verification

- TypeScript typecheck and all 138 unit tests pass.
- Browser UI suite passes with sorting/menu keyboard access, pan without extension
  messages, mirrored deeper callers, stable center, separate preview/navigation and
  Combined restoration; existing hover, icons, tint and double-click checks pass.
- Native macOS Extension Host suite passes, including the actual separate WebviewView.
- The packaged 0.1.29 VSIX was extracted and the same Extension Host suite passed
  against its runtime. Manifest, bundled offline guide and runtime byte equality
  were checked. No production installation was changed.
- Worker protocol test and 12,500-file incremental index benchmark pass.
- Large workspace: 12,551 candidates, 2,501 included files, 50,000 calls, 4,493ms
  index time and 101ms tracked selection. Full FreeRTOS verification also passes.
- No Windows/WSL end-to-end run was performed locally. The existing release workflow
  will run Windows/macOS/Ubuntu checks when a release is explicitly published.
- Local VSIX: artifacts/c-relation-explorer-0.1.29.vsix; SHA-256
  5827b2060f976067662eb7f21521f88a50d8726fa6fd482b4f0e32897a29c050.

No remaining blocking findings from this local review. Remote publication is outside
this local implementation step; keep the feature branch and checkpoint tag.
