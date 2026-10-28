# Symbol Slots and Expansion Back Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans by default for continuous inline implementation. Use superpowers:subagent-driven-development only when the user explicitly requested subagents or parallel agent work. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save five protected symbol/tree views from Relation and undo successive expansions with Back.

**Architecture:** RelationView retains navigation authority, slot persistence and a bounded expansion stack. A pure saved-record module handles validation and matching against the current RelationIndex. The webview adds compact controls and sends validated node/slot actions; current graph generation and source navigation remain in use.

**Tech Stack:** TypeScript, VS Code workspaceState/webviews, Node test runner with tsx, esbuild and existing Playwright/native Extension Host tests.

**Specification:** [Agreed design](../specs/2026-10-28-symbol-slots-and-expansion-back-design.md).

**Execution status:** Planning only. Every unchecked step is future implementation work. The present review does not request a version change, installation or publication.

## File responsibilities

Existing integration files are `src/view.ts`, `src/view-state.ts`,
`src/extension.ts`, `webview/main.ts` and `webview/styles.css`.
Create `src/relation-slots.ts` for saved data and pure symbol/path matching.
Create `test/relation-slots.test.ts` and `test/relation-navigation.test.ts`.
Extend `test/ui.mjs` and `test/extension.test.ts` for real interaction coverage;
update their fixtures only where new required state fields require it.
Add the two unit files to the explicit `package.json` test list and document the
controls in `USER_GUIDE.md`. Keep `src/relations.ts`, analyzer, Worker, build
selection, dependencies and release metadata unchanged.

## Task 1: Define records and safe current-symbol matching

Files: create `src/relation-slots.ts`, `test/relation-slots.test.ts`;
modify `src/view-state.ts`, `package.json`.

- [ ] Add the following saved contract, importing model types from `src/model.ts`.
  Saved locator metadata is computed from the current indexed file in the host.

```ts
export interface SavedSymbol {
  id: string;
  uri: string;
  name: string;
  kind: 'function' | 'variable';
  start: number;
  definition: boolean;
  storage: SymbolRecord['storage'];
  containerName?: string;
  ownerName?: string;
  sourceUnitUri?: string;
  sourceDigest: string;
}
export interface SlotViewOptions {
  mode: RelationMode;
  depth: number;
  accessFilter: AccessFilter;
  calleeSort: CalleeSort;
  callGraphDirection: 'callers-left' | 'callees-left';
  includeFunctionArguments: boolean;
}
export interface SavedBranch {
  parent: number | null;
  symbol: SavedSymbol;
  direction: 'references' | 'callers' | 'callees';
  levels?: number;
}
export interface SavedSlot {
  target: SavedSymbol;
  options: SlotViewOptions;
  branches: SavedBranch[];
  locked: boolean;
}
export interface SlotSummary {
  slot: number;
  name?: string;
  kind?: 'function' | 'variable';
  locked: boolean;
}
```

- [ ] Define `readSlots(value: unknown): (SavedSlot | null)[]` to return exactly
  five independent entries. Validate enums, depth/level integer ranges and parent
  indices (each parent precedes its child); malformed entries become null without
  shifting the other slot numbers. An absent record yields five nulls. Bound the
  prefix-sharing branch array to 300 entries. Add shared ViewState fields `slots: SlotSummary[]`
  and `canGoBack: boolean` with initial empty/false state.
- [ ] Define `matchSavedSymbol(saved: SavedSymbol, current: SavedSymbol[]):
  SavedSymbol | undefined`. Filter by URI, name, kind, definition, storage,
  container/enclosing-function and source-unit identity. Use matching digest and
  ID/start as an exact fast path. Otherwise accept exactly one semantic match;
  multiple local/shadowed candidates yield undefined.
- [ ] Before implementation, add and run failing tests: five-slot empty/load
  round-trip; malformed slot 2 preserves slots 1/3/5; shifted unique function
  resolves; reused offset with a different name fails; ambiguous same-named locals
  fail; identical static names in different files or including units stay distinct.
  Use concrete SavedSymbol records with different IDs, starts and digests.

```ts
const saved: SavedSymbol = {
  id: 'file:///a.c#10', uri: 'file:///a.c', name: 'run', kind: 'function',
  start: 10, definition: true, storage: 'static', sourceDigest: 'before'
};
const moved = { ...saved, id: 'file:///a.c#40', start: 40, sourceDigest: 'after' };
assert.deepEqual(matchSavedSymbol(saved, [moved]), moved);
assert.equal(matchSavedSymbol(saved, [moved, { ...moved, id: 'duplicate', start: 70 }]), undefined);
assert.equal(matchSavedSymbol(saved, [{ ...moved, name: 'different' }]), undefined);
```

- [ ] Implement the pure validation/matching functions, register the new tests in
  the npm test list and run `npx tsx --test test/relation-slots.test.ts` and
  `npm run typecheck`. Expected: all new cases pass. Commit only these scoped files.

## Task 2: Implement slot capture, persistence and recall in the host

Files: `src/relation-slots.ts`, `src/view.ts`, `src/extension.ts`;
create `test/relation-navigation.test.ts`.

- [ ] Build a small VM harness following `test/panel-layout.test.ts`: bundle the
  actual RelationView with vscode external, use a real RelationIndex, and stub
  EventEmitter, editor opening, configuration and workspaceState. Record writes,
  source opens and published states. Seed functions A, B, C, D with direct calls
  A -> B -> C -> D, an independent A -> Side branch, and a variable use. Add a
  deferred/rejectable workspaceState.update to test ordering and persistence failure.
- [ ] Add failing host tests using the actual message contract. Seed a graph,
  select A, right-click-target B through `saveSlot`, and verify slot 0 names B.
  Recall after selecting a different file and assert root B, locked/follow-paused
  state, saved view options, source URI and Context. Repeat save/recall for a
  variable, a Both-mode root with expansions on each side, and a non-root subtree.

```ts
await view.handleMessage({ type: 'saveSlot', slot: 0, key: bNode.key });
assert.equal(view.state.slots[0].name, 'B');
await view.handleMessage({ type: 'lockSlot', slot: 0, locked: true });
await view.handleMessage({ type: 'saveSlot', slot: 0, key: aNode.key });
await view.handleMessage({ type: 'clearSlot', slot: 0 });
assert.equal(view.state.slots[0].name, 'B');
await view.handleMessage({ type: 'recallSlot', slot: 0 });
assert.equal(view.state.graph?.root.name, 'B');
assert.equal(view.state.locked, true);
```

- [ ] Append an optional workspaceState/Memento argument to RelationView's
  existing constructor; pass `context.workspaceState` as the fourth argument
  from extension activation. Read `relationSlots-v1` through readSlots. Preserve
  current constructor callers and session-only behavior when storage is absent.
- [ ] Implement capture against `this.nodes.get(key)` and `this.index.symbol()`.
  Only resolved function/variable symbols are valid. Build locators using indexed
  source SHA-256, enclosing function extent and header source-unit URI. Walk the
  clicked node's visible subtree; save semantic path prefixes once in parent-first
  order, attaching levels only where an explicit override applies. For a root also
  walk graph.callers. For a descendant, rebase the saved
  root level using the existing inherited-level calculation in selectNode.
- [ ] Restore branch paths parent-first: match each path's next symbol/direction
  in the current generated graph, apply that node's override, and use the existing
  graph method for subsequent reachable levels. Keep intermediate graphs private
  and publish only the final view. Skip missing/ambiguous paths with a partial
  restore message; retain current graph bounds and recursion handling.
- [ ] Serialize save/lock/clear operations. Recheck lock and slot range inside
  the queued mutation, clone records, await persistence, then replace/publish.
  Catch failures without poisoning later queued actions. Recall waits for prior
  slot writes; opening sequences must finish in request order so rapid recalls
  leave the editor and tree on the last requested slot.
- [ ] Implement messages saveSlot, recallSlot, lockSlot and clearSlot, accepting
  integer slots 0..4, a string current node key and boolean lock values. Use
  workspace.indexFor(target.uri) and saved including-source context for recall.
  Resolve before changing the view; an unavailable root leaves the view intact.
  Apply saved options in memory, pin the resolved root, restore branches, refresh,
  preview/open its current location and post revealRoot with the resolved root ID.
- [ ] Verify direct-host lock bypass attempts, invalid indices/types, stale keys,
  failed writes, rapid mutations/recalls, reload, edits above a definition,
  duplicate locals, missing symbols, changed branches and missing header context.
  Run `npx tsx --test test/relation-slots.test.ts test/relation-navigation.test.ts test/panel-layout.test.ts`
  and `npm run typecheck`; commit the host integration.

## Task 3: Add reverse expansion history

Files: `src/view.ts`, `src/view-state.ts`, `test/relation-navigation.test.ts`.

- [ ] Add a failing host regression that saves graph structure/selection before
  expanding B, then C. Send back twice and assert equality with each preceding
  graph and selection; root, pin state, slot summaries and source-open log remain
  unchanged. Start with the independent Side branch already expanded. Resolve
  bNode from the initial graph and cNode from the current graph after expanding B.

```ts
const initial = JSON.stringify(view.state.graph);
await view.handleMessage({ type: 'selectNode', key: bNode.key });
const afterB = JSON.stringify(view.state.graph);
await view.handleMessage({ type: 'selectNode', key: cNode.key });
assert.equal(view.state.canGoBack, true);
await view.handleMessage({ type: 'back' });
assert.equal(JSON.stringify(view.state.graph), afterB);
await view.handleMessage({ type: 'back' });
assert.equal(JSON.stringify(view.state.graph), initial);
assert.equal(view.state.canGoBack, false);
```

- [ ] Keep a private array of snapshots containing copied expanded overrides,
  selection and selectedNodeKey; retain the latest 100. Snapshot before selection
  mutation. Record only when the resulting visible node-key tree changes after
  selectNode, expand or an accepted expandSpecial. Compare visible keys on both
  sides, including graph.callers; do not count new metadata or a leaf's expanded
  flag as a visible expansion. Rejected/no-op/cancelled actions push nothing.
- [ ] Handle back by popping and restoring a snapshot, updating canGoBack and
  refreshing the current graph. Preserve root, follow state and editor. Let
  existing preview fallback handle an unavailable prior selection. A new
  expansion pushes from the restored state; there is no forward stack.
- [ ] Reset history on a new root/callback, recall, mode/depth/filter/sort/direction/
  arguments change, changed index file objects or explicit collapse. Compare the
  same indexed-file identity information used by graphSnapshot, independently
  of expanded overrides. Diagnostics-only updates retain history.
- [ ] Add regressions for both directions, repeated no-op clicks, preview-only
  changes, empty Back, cancelled Levels, explicit collapse, options/root/index
  changes, diagnostic refresh, slot recall/save/lock and the 100-entry bound.
  Run `npx tsx --test test/relation-navigation.test.ts test/panel-layout.test.ts`
  and `npm run typecheck`. Commit verified expansion history.

## Task 4: Expose slots, tooltips and Back in Relation

Files: `webview/main.ts`, `webview/styles.css`, `test/ui.mjs`;
update `test/create-ui-fixture.ts` only if additional graph fixtures are necessary.

- [ ] Add failing browser checks for five numbered slots directly after Following
  Selection; hovering populated slot 1 exposes its function name through title;
  variables expose their variable name. Verify each slot has a separate lock
  control and that clicking it sends only lockSlot, never recallSlot.
- [ ] Add a slot group and Back button with accessible names and existing theme
  colors. Render summaries without replacing graph DOM. Empty slots cannot recall.
  Keep the group together when the existing flex toolbar wraps.
- [ ] Extend the node's existing context menu with five Save to slot choices.
  Bind the exact context-menu anchor key, show occupied names and disable locked
  replacement. A populated slot menu has Clear slot, disabled while locked.
  Send the documented host messages and reuse current keyboard menu handling.
- [ ] Add Back with label `← Back`, accessible name Back and tooltip Undo last
  expansion. Bind disabled to canGoBack. Preserve node-click behavior and existing
  popup Collapse/arrow-key actions. Back receives no new keyboard shortcut.
- [ ] Handle revealRoot only when its ID matches the current rootKey. Reuse
  Go to pin's hide-popup, finish-drag, reset-pan and root-card scroll behavior;
  this also covers reloading the same slot without a root ID change.
- [ ] Browser checks must assert correct messages for save/recall/lock/clear/back,
  context-menu target fidelity, same-slot root reveal, unchanged pan on Back,
  disabled locked actions, keyboard access and narrow layout. Check both graph
  orientations, dark/light themes and separate Context. Run `npm run test:ui`
  and `npm run typecheck`; commit the controls and browser coverage.

## Task 5: Verify integrated behavior and document it

Files: `test/extension.test.ts`, `USER_GUIDE.md`.

- [ ] Add a native Extension Host flow using temporary indexed C files: save
  from Relation B, navigate elsewhere, recall B, check the actual active editor
  URI/selection and Context, then expand B/C and Back twice. Verify workspaceState
  round-trip and locks with a new RelationView over the same stored records.
- [ ] Document right-click registration, five slots, hover names, explicit locks,
  persisted tree options, current-code restoration and Back's reverse expansion
  behavior. Explain that Following Selection resumes tracking after recall.
- [ ] Run `npm run typecheck`, `npm test`, `npm run test:ui` and
  `npm run test:extension`. These are the required gates for view/persistence
  changes. No new parser/Worker/cache/performance subsystem is introduced; broaden
  testing only if failures or implementation changes affect those boundaries.
- [ ] Inspect the final diff and `git diff --check`. Confirm root changes clear
  history, locks are enforced in the host, slots persist before success is shown,
  and saved IDs cannot silently resolve to a different symbol. Record completed
  outputs and remaining platform limitations, then commit the verified feature.
  Leave release/version/install/publication work for an explicit delivery request.

## Plan self-review

Requirements map to Tasks 1-2 for saved data, stable identity and persistence;
Task 3 for reverse expansion Back; Task 4 for placement, exact right-click target,
hover, locks and visible controls; Task 5 for native integration and Help.
Existing analysis generation is reused. The non-root rebase assumption and
current-code/partial-restoration behavior are explicit in the linked specification.
All steps remain unchecked until implementation and its checks actually run.
