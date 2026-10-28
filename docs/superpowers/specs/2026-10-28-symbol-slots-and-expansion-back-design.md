# Saved symbol slots and expansion Back

Date: 2026-10-28

Status: Implemented and locally verified, including Backspace keyboard navigation.

## User decisions

- Provide five slots immediately to the right of Following Selection.
- Register by pointing at a symbol in the Relation window and right-clicking.
  The clicked symbol is the target even when another node is selected.
- Save the symbol, expanded tree state and view options.
- Clicking a populated slot returns to its saved symbol and view.
- Each slot has a lock that prevents overwrite and deletion, while allowing recall.
- Hovering over a slot shows the saved function name; variable slots show the
  variable name.
- Use the Backspace key to undo expansions in reverse order: expand B, expand C,
  Backspace undoes C, and another Backspace undoes B. This is expansion history.

## Existing integration points

- `src/view.ts`: RelationView owns root, expanded overrides, selection, tracking,
  preview, validated node actions and graph refresh.
- `src/view-state.ts`: shared host/webview view state and node capabilities.
- `webview/main.ts`: Following Selection, Go to pin, node context menu, expansion
  controls, shared Context rendering and graph positioning.
- `src/extension.ts`: constructs the view; pass workspaceState here.
- `src/relations.ts`: existing graph generation and symbol lookup.
- `src/build-service.ts`: an existing workspaceState persistence pattern.

## Chosen approach

Store small view records and rebuild relations from the current index on recall.
The two approaches considered were symbol-only bookmarks and saved symbol/tree
view state. The user selected the latter. A serialized old analysis graph would
retain stale relations and source coordinates, so it is outside this design.

Keep slots and expansion Back within RelationView's existing navigation flow.
A small pure `src/relation-slots.ts` module will define saved records and symbol/
branch matching. Keep the short, session-only Back stack in RelationView.
There is no new analysis pass or Worker protocol.

## Slots and registration

The toolbar order is Following Selection, the five-slot group, then the
existing Go to pin and remaining controls. Keep all five slots grouped when the
toolbar wraps. A populated slot shows its number and a separate lock button;
the symbol name appears in its tooltip and accessible name. Empty slots show
their number, are unavailable for recall and have no active lock control.

Right-click a resolved function or variable node to offer Save to slot 1 through
Save to slot 5 in the existing Relation menu. Include each occupied slot's name
in its menu label. Disable replacement of locked slots. Validate the slot number,
current node key and current lock again in the host.

Registration does not change the current root, follow mode, selection or canvas
position. Replacing an unlocked slot is an explicit save action. A slot's own
context menu offers Clear slot, disabled while locked. Unlocking is explicit;
loading a slot does not unlock it. Slot data changes only on save, clear or lock.

Assumption for non-root registration: the clicked symbol becomes the root on
recall. Saving the current root captures its complete visible expansion state.
Saving a descendant rebases compatible visible descendant expansions to that
symbol and retains the same view options. In Both mode, the recalled root can
also show its opposite direction, calculated by the existing graph generator.

## Saved data and recall

Use versioned workspaceState key `relationSlots-v1` containing exactly five
optional slot records. Store no graph objects, source text, Context previews or
Back history. Save these view options: mode, depth, accessFilter, calleeSort,
callGraphDirection and includeFunctionArguments. Layout and analysis settings
continue to come from current configuration.

A target locator contains its URI, name, kind, definition/storage status,
container or enclosing function where applicable, ID/start as a fast-path hint,
and a source digest. A contextual header target also identifies its including
source unit. Store branch overrides as semantic paths of symbol locators with
caller/callee direction, rather than depending only on old offset-based node keys.
Share path prefixes using parent indices in a parent-first array, keeping saved
path data linear in the current 300-node graph bound. Include the effective root
expansion level when rebasing a descendant.

Recall resolves using workspace.indexFor(saved URI), independently of the active
editor. Accept an old ID only when source digest and identity match. After an
edit, require a unique semantic match in the saved file, scope and source context.
Resolve header contexts against the current selected build's source units.
Missing or ambiguous targets leave the current view and slot intact, and report
that the saved symbol is unavailable. Do not guess a different same-named symbol.

After successful resolution, apply the saved view options in memory, set the
resolved symbol as the pinned root, clear any callback/candidate selection, map
compatible saved branch paths to current node keys, and refresh once for the
completed state. Use the existing current-node preview/source navigation to show
the symbol in Context and the editor, and reveal its root card in Relation.
Pinning prevents editor selection events from immediately replacing the recalled
tree. Following Selection remains the way to resume editor tracking.

Saved options do not write configuration. Later settings changes continue to
apply through the existing preference handler. Missing or changed branches can
be skipped with a brief partial-restoration message; the root and other matched
branches remain usable. Preserve the current graph's node and recursion bounds.

Serialize slot mutations, await workspaceState.update before publishing the new
slot state, and preserve the last saved state on write failure. Reloads retain
saved slots and locks. With no workspace storage, keep session-only slots.

## Expansion Back

Use plain Backspace while the Relation graph or its details popup has focus.
Show the shortcut in the footer. There is no Back toolbar button. Empty history
is a no-op. Leave input, textarea, select and editable text deletion untouched;
modified Backspace shortcuts and events in Context or the editor retain their
normal behavior. When undo removes a focused node, return focus to the graph so
successive Backspace presses continue to undo earlier expansions.

Before a successful user expansion, copy expanded overrides and current node/
Context selection. Retain that snapshot only if the visible tree changed. Cover
node-click expansion, the existing Expand action and Levels action. Selection,
preview, repeated clicks that reveal nothing new, cancelled Levels and rejected
messages do not create entries. Bound the stack to the latest 100 entries.

Back pops one snapshot, restores its expansion overrides and valid selection,
and regenerates the graph from the current index. It does not open editor tabs,
change the root, change follow/pin state, update a slot or reset canvas pan.
When the old selection is unavailable, preview the current root. Unrelated
branches retain the expansion state they had before that expansion.

Each stack belongs to one root, graph-option set and index file revision. Clear
it on root/callback changes, slot recall, graph-affecting option changes or a
changed index file set/content. Diagnostics-only refreshes retain it. Also clear
it after an explicit Collapse action, avoiding a Back action that would reopen
manually collapsed branches. A new expansion after Back creates a new history
from the restored state. Back history is session-only and is not saved in slots.

## Host/webview contract

Add state fields for five slot summaries and canGoBack. The host retains saved
locators and branch details; the webview receives only display/availability data.
Add messages saveSlot with slot, node key and expected symbolId, recallSlot with
slot, lockSlot with slot and boolean locked, clearSlot with slot, and back. Use one documented
zero-based slot index on the wire; display numbers 1 through 5.
After a successful recall state is published, send a revealRoot message carrying
the current root ID. The webview validates that ID and reveals the root even
when recalling the same slot produces an otherwise identical graph.

Validate all mutations in the host. A disabled menu/button is a usability hint,
not the authority for lock protection or valid symbol identity. Lock-only state
updates must preserve graph DOM, focus, pan and expanded branches.

## Acceptance checks

1. Save five different functions/variables from their actual right-clicked nodes;
   selecting a different node first does not alter the save target.
2. Hover shows each saved symbol name. Recall restores mode, depth, filters and
   compatible expansions, and opens the current source/Context location.
3. Save a descendant and verify its recalled root and rebased expansion; verify
   both directions when saving a root in Both mode.
4. Locked slots permit recall and reject overwrite/clear in both UI and host.
   Unlock, replace and clear work. Rapid saves and reload retain the final state;
   failed persistence does not falsely report a successful change.
5. Source line movement can preserve an unambiguous symbol. Deleted, shadowed,
   ambiguous and unavailable header-context targets never jump to another symbol.
6. Expand B, then C, then press Backspace twice. Restore each exact earlier tree,
   including unrelated branches, selection, pin state and canvas position.
7. Empty history makes Backspace a no-op. No-op clicks and preview/diagnostics
   updates do not consume history. Root/options/index changes and explicit collapse clear it.
8. Verify combined/separate Context, both graph orientations, narrow toolbar,
   keyboard access, themes and existing double-click source opening.

Local implementation was requested after brainstorming. Version changes,
packaging, installation and publication are separate delivery work.
