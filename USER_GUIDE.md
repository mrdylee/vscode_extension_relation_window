# Dynsight — User Guide

**Language: English | [한국어 사용 설명서](USER_GUIDE.ko.md)**

> **New to Dynsight?** Follow [Quick start](#quick-start), then [Settings step by step](#settings-step-by-step). This manual is bundled with the extension and works offline.
>
> Open it anytime with **Help · 사용법** beside **Settings** in Relation. VS Code's display language selects the initial guide; use the language link above to switch.

## Find what you need

| I want to… | Go to… |
| --- | --- |
| See my first call tree | [Quick start](#quick-start) |
| Configure Settings without writing JSON | [Settings step by step](#settings-step-by-step) |
| Understand each setting and its default | [Settings at a glance](#settings-at-a-glance) |
| Analyze only a few folders | [Choose which files to analyze](#choose-which-files-to-analyze) |
| Follow macros and callbacks | [Smart Analysis](#smart-analysis) |
| Use optional AI suggestions | [Optional AI callback candidates](#optional-ai-callback-candidates) |
| Save trees in slots, pin a symbol or undo a branch change | [Settings and moving Context](#settings-and-moving-context-v0130) |
| Understand an icon | [Symbol icons and badges](#symbol-icons-and-badges) |
| Fix missing results or slow analysis | [Troubleshooting checklist](#troubleshooting-checklist) |
| Select a Make build configuration | [Existing Make build configurations](#existing-make-build-configurations) |
| Update Dynsight | [WSL and updates](#wsl-and-updates) |

## Quick start

1. In VS Code, select **File → Open Folder…** and open the folder containing your C/H files. A compiler or build is not required.
2. Open the Command Palette: **Ctrl+Shift+P** on Windows/Linux, **Cmd+Shift+P** on macOS.
3. Run **Dynsight: Open Relation and Context**.
4. Wait for indexing to finish, then click a function name in a `.c` or `.h` editor.
5. Read the **Relation** tree and the code in **Context**. Click a tree node to preview it; double-click or press **Enter** to open its location in the main editor.

**First useful example:** Select `main`, choose **Callees · Called functions**, and start with **1 level**. You can expand an individual branch later by clicking it.

## Settings step by step

### Open the settings screen

1. Click **Settings** in the Relation toolbar, beside **Help · 사용법**. Alternatively, run **Dynsight: Open Settings** from the Command Palette.
2. Use the **Workspace** tab to configure this project. **User** settings apply across projects; folder tabs in a multi-folder workspace configure that folder's analysis scope. Automatic Updates is a User setting.
3. Change a dropdown, checkbox or folder list. VS Code saves settings as you edit; a folder selection review saves only when you click **Apply**.
4. Return to your C/H editor and click a symbol. Display settings apply immediately. Scope changes refresh affected analysis; wait for the status to settle before checking results.

> **Can't find a setting?** Search for its exact key, for example `@id:dynsight.include`. Search for `@ext:dylee.dynsight` to show all Dynsight settings again.

### Recipe A — Analyze App and Drivers only

1. Find **Include** (`dynsight.include`) and click **Select folders…**.
2. Choose **Add folders…**, select your `App` and `Drivers` folders, then return to the review list.
3. Check the list and click **Apply**. Rules such as `App/**` mean “everything under App.” Remove an existing `**` rule if you want to narrow the scope.
4. In **Exclude**, review folders that should be skipped. **Exclude always wins.** Needed shared headers must remain inside the general analysis scope.

**Easiest alternative:** Select folders in Explorer, right-click → **Dynsight → Add to Analysis Include / Exclude from Analysis**, review, then **Apply**. **Esc** cancels without saving.

### Recipe B — Enable local macro and callback analysis

1. First verify that ordinary function navigation works.
2. Find **Smart Analysis: Include** and click **Select folders…**. Choose a small relevant folder, such as `App/control`, and save it.
3. Leave **Smart Analysis: Macro** checked. It enables local macro expansion and callback propagation together.
4. Leave **Smart Analysis: AI** unchecked if you only want local analysis. Watch the detailed-analysis status as additional relationships appear.

> **Two different Include lists:** General **Include = empty** means all C/H files subject to exclusions and discovery limits. **Smart Analysis: Include = empty** disables the extra analysis in new workspaces. To select all indexed files for Smart Analysis, use `["**"]`. Existing legacy scopes stay effective until the new Smart Analysis Include is explicitly saved.

### Recipe C — Make the screen easier to read

| Desired result | Setting to choose |
| --- | --- |
| Context and Relation together | **Context Layout → Combined** |
| Use the full bottom width | **Context Layout → Combined · Full width** |
| Move Context separately | **Context Layout → Separate**, then drag the **Dynsight Context** header |
| Reverse incoming/outgoing branches | **Call Graph Direction → Callees left / Callers right**, in **Callers & Callees** mode |
| Read called functions in source order | **Callee Sort → source**; this is written order, not execution order |
| Show functions passed as callback arguments | Enable **Include Function Arguments**; a dotted connector means an argument, not a proven call |

Explicit Combined alignment also moves Terminal and other bottom-panel views because they share VS Code's panel alignment.

### Recipe D — Enable optional AI suggestions

1. Choose **Smart Analysis: Include** folders first.
2. Check **Smart Analysis: AI**, then choose an extension in the first list.
3. Choose a model by name, or **Default model**, in the next list. Both choices are saved together. Cancel leaves the newly enabled checkbox off.
4. Eligible unresolved callbacks are analyzed one at a time. **Stop AI Analysis** pauses requests for this session; **Analyze Callbacks with AI** resumes them.

**Source snippets are sent to the selected AI provider/model and account limits apply.** Supporting snippets can come from other indexed files. **AI candidate** is a suggestion. Use **Set manually → choose a function → Apply** to record your choice as **User confirmed**. Neither label proves runtime execution.

## Settings at a glance

Names below match the English Settings screen; exact keys work in any VS Code language.

| Setting / key | Default and purpose |
| --- | --- |
| Context Layout · `dynsight.contextLayout` | **`combined`** — Places Context with Relation or in a separate view. |
| Call Graph Direction · `dynsight.callGraphDirection` | **`callers-left`** — Places incoming/outgoing branches in **Callers & Callees**. |
| Include · `dynsight.include` | **`[]`** — Selects general C/H scope. Empty means all subject to exclusions and limits. |
| Exclude · `dynsight.exclude` | **Built-in list** — Skips test/mock, third-party and build/tool output folders. A saved list replaces the defaults; `[]` disables the configurable defaults. |
| Smart Analysis: Include · `dynsight.smartAnalysis.include` | **`[]`** — Chooses files for extra Macro/AI work inside the general scope. |
| Smart Analysis: Exclude · `dynsight.smartAnalysis.exclude` | **`[]`** — Skips extra analysis in these paths while retaining basic navigation. |
| Smart Analysis: Macro · `dynsight.smartAnalysis.macro` | **On** — Expands macros and propagates local callback targets within Smart Analysis scope. |
| Smart Analysis: AI · `dynsight.smartAnalysis.ai` | **Off** — Requests AI candidates for eligible unresolved callbacks. |
| Skip Inactive · `dynsight.skipInactive` | **On** — Hides provably inactive branches; unknown conditions remain visible. |
| Callee Sort · `dynsight.calleeSort` | **`name`** — Sorts Callees by name or first source location. |
| Include Function Arguments · `dynsight.includeFunctionArguments` | **Off** — Shows functions passed as arguments, with a distinct dotted connector. |
| Automatic Updates · `dynsight.automaticUpdates` | **On** — Checks GitHub for releases; asks before installing. Requires internet. |

For JSON users, open **Preferences: Open Workspace Settings (JSON)** and merge only the keys you need into the existing object. This example uses local analysis only:

```json
{
  "dynsight.include": ["App/**", "Drivers/**"],
  "dynsight.smartAnalysis.include": ["App/control/**"],
  "dynsight.smartAnalysis.exclude": ["App/control/generated/**"],
  "dynsight.smartAnalysis.macro": true,
  "dynsight.smartAnalysis.ai": false
}
```

Replace sample paths with your project's paths. Omitting **Exclude** retains its defaults if you have not overridden it at another settings scope. Always use `/`, including on Windows. Paths are relative to the opened workspace folder.

## Troubleshooting checklist

| Symptom | First steps |
| --- | --- |
| Nothing appears | Open a C/H folder, run **Open Relation and Context**, wait for indexing, click a symbol. |
| Tree stays on another function | Click **Pinned · Follow paused** to resume **Following selection**. |
| A function or shared header is missing | Check general Include/Exclude first. Exclude takes priority; default rules also skip test and `third*` folders. |
| Macros/callbacks are missing | Check Smart Analysis Include and Macro. Extra analysis needs a nonempty scope. Inspect partial-result reasons in Diagnostics. |
| AI does not start | Check its checkbox, model and nonempty scope. Run **Analyze Callbacks with AI** after a pause. |
| Analysis is slow | Start with a smaller Smart Analysis folder and shallower tree depth. **Stop local** pauses local work; **Resume Local Analysis** resumes it. |
| Update asks for Rebuild | Read the reason. A changed analysis version can require a rebuild; the extension version alone does not. Rebuild when the prompt requires it. |
| Need to report a problem | Use **Dynsight: Report Issue**; review the draft and attachments before submitting. |

More detail: [missing or slow results and Diagnostics](#if-results-are-missing-or-slow). Use **Rebuild index** when a full rebuild is needed; display changes do not require it.

---

## Detailed reference

Published as **dylee**, with extension ID **`dylee.dynsight`**.
Settings and commands use the **`dynsight.*`** prefix.

## Upgrade from v0.1.43 or earlier

The previous extension (C Relation Explorer / James Black) has a different ID,
`local-james-black.c-relation-explorer`. After installing the new VSIX and opening
a C file, choose **Remove previous extension and reload**. Dynsight waits while
the previous extension is active, preventing duplicate analysis. If you dismiss
the prompt, uninstall the previous extension in Extensions and run
**Developer: Reload Window**. For WSL, check the WSL extension list in that window.
A disabled previous extension may not be detected; remove that entry manually.

On activation, explicit `cRelation.*` preferences move to `dynsight.*` at the user,
current workspace and current folder scopes. Existing new values win. Old keys
are removed only after the new value is saved or already exists. Other projects
migrate when you open them. Reload after adding a folder with legacy settings to
an already open workspace. Old custom keybinding commands remain compatible.
Panel IDs changed, so you may need to move the panels into place again.
The legacy-named VSIX in Releases is an identical new package for older updaters.

This guide is included with the extension and works offline. You do not need Git or a GitHub account to use Dynsight.

## Start here

Download the Windows (`-windows.vsix`), macOS (`-macos.vsix`) or WSL (`-wsl.vsix`)
file from GitHub Releases and use **Extensions: Install from VSIX…** in VS Code.
All platform filenames contain the same universal JavaScript/WASM package.
Release CI runs unit and Extension Host tests on Windows, macOS and Ubuntu.
WSL remote connectivity and remote automatic installation require user-side verification.

1. Open a folder containing your C source files in VS Code. A build, SDK or compilation database is not required.
2. Run **Dynsight: Open Relation and Context** from the Command Palette.
3. Click a function or variable name in the main editor. Relation shows its relationships; Context shows the selected code.
4. Check the file count and index status at the bottom. Relationships may be incomplete while **Indexing C sources…** is shown.

Use **Settings** in the Dynsight toolbar to configure sorting, Context layout, call graph direction and Include/Exclude together for the current workspace. With no folder open, it opens user settings instead. In a multi-folder workspace, use folder settings for folder-specific Include/Exclude overrides; layout preferences apply to the whole window. **Help** opens this guide again. Both actions are also available in the Command Palette as **Dynsight: Open Settings** and **Dynsight: Open User Guide**.

The index is saved in this workspace's extension storage, including in the remote
WSL environment. On restart Dynsight checks file contents and inventory before
restoring it. An unchanged compatible cache needs no source parsing or relation
analysis. First use creates the index locally. Analysis compatibility has its own
version, separate from the extension's release number. Compatible extension
updates reuse the saved index. A changed analysis version, changed workspace
settings, an older cache format and damaged files have separate Rebuild messages;
only damaged files use the word **damaged**. Pre-versioned caches need one Rebuild
when adopting this format. Diagnostics shows current and saved analysis versions.

Edits, discarded edits and external changes reparse only changed files. Relations
are recomputed for conservatively connected files, including header and callback
registration dependencies. Shared headers and token-pasting macros can connect
many or all files; this is not a promise that every edit costs one file of analysis.
Unsaved edits remain temporary and are not written into the disk generation.
Scope changes reconcile selected files; only **Rebuild index** explicitly clears
all local analysis. Diagnostics shows cache state and parse/relation counters.

## Optional AI callback candidates

Use the single **Smart Analysis: AI** setting. Checking it opens **1/2: choose an installed Copilot / Claude Code / Codex extension**, followed immediately by **2/2: choose its model**. Choose display names from a list; Claude Code/Codex also offer **Default model**. Only the completed pair is saved. Cancelling setup leaves a newly enabled checkbox off. Use **Choose or change AI extension and model…** in the same setting, or **Dynsight: Configure Smart Analysis AI**, to change the pair. **Only the selected provider receives requests; failures never trigger another provider.** Sign in to that extension first. No separate CLI, executable path or typed model ID is needed.

Copilot uses VS Code's Language Model API. Claude Code and Codex use the installed extension's bundled engine and existing login, rather than typing into an existing chat panel. Requests still receive bounded snippets in a temporary folder with the existing validation and cancellation limits. Changing providers cancels the old request and waits for it to end before starting the new one. WSL/SSH requires a compatible extension in that environment. Fix login/update errors in the selected extension and run **Analyze Callbacks with AI** to resume. Existing Copilot settings and command IDs remain compatible.

Enable **Smart Analysis: AI**, choose an extension and model in its guided picker, and explicitly
choose **Smart Analysis: Include** paths. Invocation files must be indexed,
included in the shared Smart Analysis scope and outside its exclusions. Empty
Smart Analysis Include permits no requests. Paths are not copied from general
Include. AI works independently of the **Macro** switch.

When enabled, analysis starts automatically once the saved index is ready. Startup,
saved source changes, Rebuild, and model/scope changes analyze missing eligible
results one at a time, reusing valid cache and continuing past five calls.
Choose a model when prompted if none is configured. Active **User confirmed**
calls are skipped. Open a callback's popup for an individual **Find target with AI**
or **Recheck with AI** request.

**Stop analysis** or **Stop AI Analysis** cancels the active request, retains
completed results, and pauses automatic requests for this session. Index and source
notifications do not resume it. Run **Analyze Callbacks with AI**, toggle the
AI setting, or change its provider/model/scope to resume. Request failures also pause
automation without automatic retries or model fallback. Saved basic navigation
can support analysis after local detailed analysis is stopped or reaches a limit.
Save modified sources first.

Relevant source snippets are sent to your selected AI provider/model. Supporting code
may come from other indexed paths, even when only the invocation file is inside
Smart Analysis Include. Account limits and organization policies apply. Source comments
and strings are analysis data. Dynsight uses bounded snippets, not chat history or
an Agent's whole-project search. Missing context is reported as **More context
needed**; **No target found in provided context** does not prove no target exists.

Hover or focus an **AI candidate** to open its popup:

- **Set manually** searches indexed functions. Select the correct definition by
  name and file path, then **Apply**. The graph and definition navigation use that
  function and show **User confirmed**. This does not edit C source or rename a
  function. **Cancel** leaves the selection unchanged.
- **Recheck with AI** sends a fresh request for this call only, bypassing its AI
  cache. Other callbacks are not reanalyzed.
- A **User confirmed** popup offers both buttons too. AI agreement shows **AI
  agrees**. A different suggestion is shown for comparison; **Use this target**
  is required to replace your choice. Failure or cancellation keeps your choice.
- **Remove manual override** removes only that user selection, restoring a current
  AI result if available or the original unresolved call. It makes no AI request.

User choices are saved separately from AI cache in local workspace extension
storage. Rebuild, restart, model changes and disabling AI do not erase them.
Code changes that invalidate call/target identity require review, rather than
reattaching by line number or name. **User confirmed** records your decision; it
is not a statically proven runtime call. These choices do not feed the local
callback propagation engine. AI and user overlays never enter the Worker cache.

```json
{
  "dynsight.include": ["App/**", "Drivers/**"],
  "dynsight.smartAnalysis.include": ["App/**"],
  "dynsight.smartAnalysis.exclude": ["App/Generated/**"],
  "dynsight.smartAnalysis.macro": true,
  "dynsight.smartAnalysis.ai": true
}
```

## Choose which files to analyze

Only C/H files are analyzed. Patterns are relative to each workspace folder; use `/` even on Windows. For a folder and everything inside it, write `App/**`, not just `App`.

| Include | Exclude | Result |
| --- | --- | --- |
| Empty | Empty | All C/H files, apart from built-in exclusions |
| Set | Empty | C/H files matching any Include pattern |
| Empty | Set | All C/H files except Exclude matches |
| Set | Set | Include matches minus Exclude matches |

**Exclude always wins.** An empty Include list means all C/H files; a nonempty list with no matches means zero files. Overlapping patterns do not duplicate files. Changes reconcile selected files and also apply to file changes and unsaved edits.

In Settings, add each pattern as a separate item. To edit JSON instead, run **Preferences: Open Workspace Settings (JSON)** and merge the following entries into the existing object. Keep your other settings.

Analyze only App and Drivers, but omit generated code and tests:

```json
{
  "dynsight.include": ["App/**", "Drivers/**"],
  "dynsight.exclude": ["**/generated/**", "**/test/**"]
}
```

Analyze the full project except Polyspace and build output:

```json
{
  "dynsight.include": [],
  "dynsight.exclude": ["**/Tools/Polyspace/**", "**/build/**"]
}
```

Other examples: `App/**/*.{c,h}` matches C/H files under App; `**/vendor/**` matches vendor folders at any depth. Paths are case-sensitive in WSL. Windows-hosted analysis ignores path casing.

Use **Select folders…** in the general Include/Exclude setting to avoid typing patterns. Choose **Add folders…**, select one or more folders (including nested folders), review the rules, then **Apply** to save and refresh analysis. Select a rule to remove it. **Esc** cancels without saving. **Analyze all C/H files** clears Include; adding folders to an empty Include restricts analysis to the selected paths. Existing broad globs such as `**` are preserved; remove those rules to narrow the scope. Matching folder exclusion rules appear beneath Include entries. Exclude also offers **Restore default exclusions**. Opening Settings from the picker discards staged changes and lets you edit arbitrary glob patterns directly.

Alternatively, select folders in Explorer and right-click **Dynsight → Add to Analysis Include / Exclude from Analysis**. This opens the same review before saving. Existing rules, including default exclusions, are retained when adding folders. Multi-root workspaces save each root's folder settings. These commands configure general indexing, separately from Smart Analysis Macro/AI scope.

Selecting a workspace root for Include restores all C/H files using the normal discovery limit; selecting the root for Exclude excludes all files. Settings editing opens the selected root's folder settings when folder scope applies. Fixed exclusions are marked as always excluded and cannot be overridden by Include/Exclude settings.

- `node_modules`, `.git` and `.vscode-test` are always excluded.
- Default Exclude covers test folders (`unit_test*`, `unit-test*`, `unittest*`, `test`, `tests`, `mock*`), external code (`third*`) and build/coverage output (`build`, `CMakeFiles`, `cmake-build-*`, `coverage`) at any depth. Each uses a folder-subtree pattern such as `**/test/**`. A saved Exclude list replaces these defaults; save `[]` to disable them.
- Firmware tool defaults also exclude `**/[Pp]oly[Ss]pace*/**`, `**/POLYSPACE*/**`, `**/[Oo]bj/**`, `**/[Oo]bjects/**`, `**/[Ll]istings/**`, `**/BrowseInfo/**`, `**/C-STAT/**`, `**/EWARM/**/List/**` and `**/EWARM/**/Exe/**`. These naming conventions are configurable; remove a rule if a project uses that name for runtime sources.
- Test framework folders use `**/[Uu]nity/**`, `**/[Cc][Mm]ock*/**` and `**/[Cc]pp[Uu][Tt]est/**`, including frameworks outside test directories.
- Debug/Release, generated code, MDK-ARM/EWARM project folders, SDK/HAL/BSP/RTOS and PlatformIO `.pio/libdeps` remain available unless another rule excludes them. `.pio/build` is already covered by `**/build/**`.
- `files.exclude`, `search.exclude` and `C_Cpp.files.exclude` do not configure this extension's analysis scope.
- Definitions and references outside the scope are absent from Relation. Include shared headers and libraries if you need their relationships.
- To restore full scope, empty Include and remove unwanted Exclude entries.

## Smart Analysis

Settings are ordered as **View → Include → Exclude → Smart Analysis Include /
Exclude → Macro / AI → other options**. Only four path lists are shown.
General Include/Exclude select the basic index. The shared Smart Analysis scope
selects extra analysis within that index:

- **Macro** expands macros and propagates local function-pointer and callback
  targets together. It is enabled by default, but requires a nonempty scope.
- **AI** requests AI candidates for unresolved callbacks. It is off by
  default and runs independently of Macro.

Use **Select folders…** or **Dynsight: Select Smart Analysis Folders**. An empty
Include list disables both stages. `['**']` selects every indexed source.
Smart Analysis Exclude takes priority. Cancel leaves the setting unchanged.
Multi-root selection writes the chosen root's setting. Use forward slashes on
all platforms. Unselected files keep basic navigation and explicit registrations;
indexed headers still provide definitions. External function bodies are not
pulled into local propagation automatically.

Saved legacy Macro Expansion Folders, Analyze Callbacks, Detailed Analysis
Folders and Copilot paths remain effective until Smart Analysis Include is
explicitly saved. They are hidden from the Settings UI. The old AI enable settings remain effective until Smart Analysis: AI is explicitly saved. Saving even an empty new
Include replaces those path scopes for that root; Macro and AI switches
remain independent. Legacy picker commands open the new shared selection.
Changing a scope refreshes affected flow
facts; increasing the scope may require parsing the affected files again.

Local work keeps cumulative per-function bounds. Project work continues across
accounting batches instead of spending the entire callback allowance on macros.
Memory guards, manual Stop and structural limits remain active; batches are not
persisted checkpoints and do not promise a maximum elapsed time. Partial results
retain their reasons. **Basic navigation
ready** and **Detailed analysis** are separate states; neither an AI candidate nor
a user choice proves all runtime paths were found.

**Stop local** stays in a fixed action area as function names change. Hover or
focus the shortened function name to view and select its full text. **Copy** copies
the full name captured when the popup opened; it does not change if analysis moves
to another function. Close and reopen to see the current name. Escape closes the
popup, and keyboard Tab reaches Copy.

## Navigate Relation and Context

- **References** shows calls, address references and declarations. **Callers** includes direct, macro-expanded and inferred callback calls. The tree grows toward the code that calls or references the selected symbol.
- **Callees · Called functions** grows in the opposite direction: from the selected function to the functions it calls. Repeated calls share one node; the popup lists each actual call site. Click a child to preview the call site in Context and expand its outgoing calls. Enter or double-click opens that call site in the editor.
- **Callers & Callees** shows the selected function between incoming callers and outgoing callees. The default is callers on the left and callees on the right; Settings can reverse them. The whole graph starts at the left edge, with no automatic root centering. The depth selector applies to both sides; click a branch to expand it independently. Variable selections still use the existing R/W filters. Both sides share a 300-node limit, with roughly half reserved for outgoing calls.
- **Macro-expanded call** shows a call found after token expansion. **Inferred call** shows a possible function-pointer/callback target, with a dashed candidate icon and evidence. **Macro invocation**, **Indirect call** and **Unresolved call** leaves retain unavailable expansions, unknown indirect targets or names missing from the analyzed scope. Declared functions without an indexed body have no outgoing calls to expand.
- Variable selections keep their Read/Write filters and incoming caller tree, even when the remembered function mode is Callees. Returning to a function restores that mode.
- **1 level – 8 levels** controls the initial tree depth. Click a Relation symbol to preview it in Context and expand from that node by the selected depth. The root stays in place; already deeper branches remain open. Repeated clicks do not grow the same node indefinitely.
- **Double-click / Enter** opens the symbol or reference in the main editor.
- **Context code click** moves the main editor to that location. When following selection, Relation also follows the clicked symbol. Drag to select and copy text without navigating.
- **Following selection** means Relation follows symbols selected in the editor or Context. Select a node in Relation, then click this button to pin that symbol as the new root. If no node is selected, the current root is pinned. A small pushpin appears on that root node; hover over **Pinned · Follow paused** to see the pinned symbol's name. Right-click another resolved node and choose **Pin this symbol** to replace the pin, including while already pinned. Click **Pinned · Follow paused** to remove the pin and resume following. Pinning does not stop indexing or manual branch expansion.
- **↩ Pin** appears beside **Pinned · Follow paused**. Click it to open the pinned symbol in the main editor, preview it in Context and reveal its root in Relation. The pin, expanded branches and traversal settings stay in place. The button is disabled if the pinned symbol is unavailable.
- Hover over a node without moving for 500 ms, or press **Space** on a focused node, to see details and individual call/reference locations. Click a location to preview the exact use in Context. **Escape** closes details.
- **→** expands a focused node, **←** collapses it, and **Shift+→** lets you choose an expansion depth. The details popup also offers **Levels…**.
- If multiple definitions match, use **Select definition** to choose the correct file.
- Drag the divider to resize Context and Relation.

## Settings and moving Context (v0.1.30)

Click **Settings** in Relation to open all Dynsight settings in one place. Sorting and layout choices are configured here:

- **Callees sorting → Name order / Source order**: the default is name order. Source order groups each target at its first original call location, including macro-expanded and inferred calls. Repeated calls stay in one node, with popup locations in source order. Tied locations retain discovery order. This is the order written in source, not runtime evaluation order. Callers/References keep name order.
- **Context layout** keeps Context and Relation together in Combined modes. Choose
  **Full width** for the entire bottom; **Left sidebar full height** for the center
  and right bottom area; **Right sidebar full height** for the left and center
  bottom area; or **Center** to preserve both sidebars' height. These use native
  VS Code panel alignment, so Terminal and other bottom-panel views share it.
  Default Combined preserves the current placement; returning to it or Separate
  from an explicit alignment restores Center. Separate opens **Dynsight Context**
  as an independent Explorer view; drag its header to another supported location.
  All modes share the same index, selection, syntax colors and source navigation.
- **Call Graph Direction → Callers left / Callees right**, or **Callees left / Callers right**: applies to Callers & Callees mode. Changing sides preserves expanded branches, selection and the Callees sorting rule. The graph remains left aligned and left-side branches are visible initially; it does not center the selected function or reanalyze sources. Single-direction modes keep their existing orientation.

Right-click inside Relation (or focus a node and press **Shift+F10**) for **Settings…** and **Reset graph position**. Reset returns the whole graph to its initial left-aligned position.

The five numbered slots beside **Following selection** save symbols for later.
Point at a function or variable in Relation, right-click, and choose **Save to
slot 1–5**. Each slot keeps the entire current Relation tree: its root, caller and
callee branches, expansion/collapse states and graph options, plus the symbol
you right-clicked.
Hover over a populated slot to see its symbol name; click it to restore the tree,
show Context and open the symbol's source. For example, saving B inside a tree
rooted at A restores the whole A tree, including other branches, and selects B.
Recall keeps the current **Following selection** or
**Pinned · Follow paused** state.

Use the padlock over each populated slot's number to protect it from replacement or
clearing. Locked slots still open normally. Unlock before replacing a slot, or
right-click the slot and choose **Clear slot**. Slots and locks persist in this
workspace. Relations are rebuilt from current code: unavailable symbols are
reported, and changed branches may be only partly restored.

Press **Backspace** while Relation has focus to undo the most recent expansion or collapse.
Expand B, then C; Backspace restores the
tree before expanding C, and another Backspace restores the tree before expanding B.
Collapsing a branch can also be undone to restore its previous expanded tree.
Undo keeps the current selection and Context preview, root, pin state and canvas position.
The latest 100 tree actions are
available during this session. Changing the root, graph options or indexed
sources or recalling a slot starts a new undo
history. Backspace keeps its normal deletion behavior in editable fields, and
does not act as graph navigation in the source editor or Context. Slot contents
stay as saved until you explicitly replace them.

For a full-width bottom panel beneath both sidebars, select **Settings → Context
Layout → Combined · Full width**. The same VS Code alignment is available manually
through **View → Appearance → Align Panel → Justify**.

Hold the left mouse button on the graph's **background** and drag to pan. A small movement threshold distinguishes a drag from a click. Dragging does not analyze files or change selection. Node clicks, double-clicks and Context text selection keep their existing behavior. A new root resets the graph position.

Sorting, Context layout and call graph direction are saved in workspace settings (user settings when no folder is open):

```json
{
  "dynsight.calleeSort": "source",
  "dynsight.contextLayout": "separate",
  "dynsight.callGraphDirection": "callees-left"
}
```

Both views share one analysis index. Separate Context receives preview updates; it does not start a second analysis pass. Actual responsiveness depends on project size and displayed relationships.

## Function arguments (v0.1.31)

Open **Settings → Include Function Arguments** to include functions passed as
arguments in **Callers**, **Callees** and **Callers & Callees**. This option is
off by default. Changing it reuses the existing index; it does not rebuild it.

```c
int priv_task_data(void *ctx) {
    return svc_call_nonblock(ctx, a_func);
}
```

With the option on, `a_func`'s Callers includes `priv_task_data`. The latter's
Callees includes both the call to `svc_call_nonblock` and the function argument
`a_func`. The popup identifies **Function argument #2 · via svc_call_nonblock**.
Click the argument relationship to preview the original argument in Context;
Enter/double-click opens that location in the editor. Expansion follows the
selected function normally. The API body need not be available for a literal
function argument to be found.

- **Cyan dotted connector:** all locations on that branch pass a function as an
  argument. Existing function icons remain 16×16.
- **Solid connector:** normal call, or a group containing both calls and function
  arguments. The popup distinguishes every location.
- **Dashed icon border:** retains its existing candidate, conditional or recursive
  meaning. It is independent of the argument connector.

Passing a function does not prove that the receiver invokes it, registers it,
queues it or runs it asynchronously. An executor found by pointer analysis keeps
its own inferred-call relationship. `svc(a_func())` passes the returned value;
it does not pass `a_func` itself. Passing an object that contains callbacks does
not automatically count as passing each callback.

Literal names and function addresses use a light collection path. Alias, member,
table and returned function values use existing pointer inference only when that
analysis already runs. No additional full pointer analysis is forced solely for
arguments, so unresolved aliases can remain absent. Candidate and partial-result
notices apply. References and variable R/W filters retain their original meaning.

JSON setting: `"dynsight.includeFunctionArguments": true`.

### Callback analysis and legacy settings

Use **Smart Analysis Include / Exclude** for new workspaces. Macro expansion and full
callback propagation share this scope; **Include Function Arguments** remains a
separate display preference. Explicit registrations and safe simple local
candidates remain available outside detailed analysis.

The deprecated `dynsight.analyzeCallbacks` switch applies only in the legacy
compatibility path. Changing analysis modes can recreate affected flow facts.
Uncertain conditions, unknown writes and omitted effects remain uncertain; turning
analysis off does not turn a registration into proof of invocation.

## Symbol icons and badges

![All Dynsight symbol icons: outlined and filled functions, variables, types, macros, unknown symbols, dashed states and variable-use badges](media/symbol-icons.png)

All icons remain **16×16**. Function icons retain the original rounded `ƒ` shape; fill distinguishes declarations from implementations.

| Icon | Meaning |
| --- | --- |
| Outlined `ƒ` | Function declaration: a prototype without a body |
| Filled `ƒ` | Function definition: an implementation with a body |
| Generic `ƒ` | Function reference whose declaration/definition form is not identified; uses the outlined style too, so inspect the popup label |
| Blue `v` | Variable, including a function-pointer variable or struct/union member |
| Green `T` | Type, such as a typedef |
| Amber `#` | Macro |
| `?` | Unknown symbol kind |

The popup names a known function form as **Function declaration** or **Function definition**. A **dashed border** independently marks one or more of **Conditional**, **Candidate** or **Recursive**. These states share the same dashed style; inspect the popup for the exact reason. A solid border means none of these special states is marked; it does not prove the code executes at runtime. Filled function icons leave a small gap inside a dashed border so the dashes remain visible.

Variable-use badges are **R** (read), **W** (write), **RW** (read/write) and **&** (address passed). Several badges can appear on one node. Function colors adapt to light and dark themes. The image above shows the dark theme and includes enlarged icons for comparison alongside their actual size.

## Variable reads and writes

Selecting a variable switches the relation filter to **Variable · All uses**, **R · Read**, **W · Write**, **RW · Read/write**, or **& · Address passed**. Read and write filters both include RW operations. Clicking a use node previews the first matching use; its details list other locations.

Address passing does not prove that a callee writes the variable. These R/W lists do not add uses through aliases or writes through pointers/to array elements. Callback target inference separately follows supported pointer values. Named struct/union fields are supported as described below.

## Struct and union members

From v0.1.26, click the field token in `m->state` or `m.state`, or its declaration. Relation uses the declared receiver type and shows a compact qualified name such as **Motor.state** with the existing blue `v` icon. The popup labels it **Member of Motor**. A different type's **Sensor.state** and a global variable named **state** stay separate.

```c
struct Motor { int state; };
struct Sensor { int state; };
void run(struct Motor *m, struct Sensor *s) {
    m->state = 1;  // Motor.state: write
    s->state++;   // Sensor.state: read/write
}
```

Use the existing R/W/RW/& filters to inspect actual field uses. Clicking a use previews its exact source position in Context; increasing depth follows the containing function's callers.

Supported paths include declared variables and parameters, typedefs and pointer typedefs, array indexing, parentheses, dereference/address expressions, named nested fields, unions and bit fields. Type definitions in headers must be inside the analysis scope. Transitive includes are followed; quoted includes prefer an existing relative path. Without compiler include paths or known conditional values, ambiguous definitions remain candidates.

From **v0.1.32**, explicit casts such as `((Motor *)p)->state`, declared return
types such as `get_motor()->state`, and fields promoted through anonymous
struct/union members also resolve. A cast uses its written type; it does not
prove the runtime object has that type. A function's declared return type is
enough; its implementation need not be indexed. Callback-return type binding is
separate from inferring which function a callback executes.

Field designators in initializers such as `Motor m = { .state = 1 }` resolve to
the field declaration. Nested designated paths, arrays, compound literals and
unambiguous braced positional nesting are supported. Terminal field designators
appear as **W** at their original field tokens. Intermediate path fields remain
selectable without claiming a write to the whole parent field. Function-local
initializers belong to their containing function; global ones belong to the
initialized variable. Anonymous fields use the outer containing type's name.

Macro-generated types, scalar brace elision and positional continuation after
designators are not fully supported. Conditional positional layouts may remain
unresolved. Unsupported receiver/initializer syntax produces **Analysis notices**;
unavailable types or out-of-scope headers can also leave relationships unresolved.
Unknown types are not guessed from field names. Writes through a pointer field
or to an array element do not imply a write to the whole field. Callback target
inference is a separate analysis described below. Type/expression traversal is
bounded to 32 steps and intermediate candidates to 64, so more complex cases
may have missing relationships.

## Macro-expanded calls and callback targets (v0.1.28)

Use the existing **Callees**, **Callers** and **References** modes. No build configuration is needed. Include the relevant headers, callback registrations and implementations in the analysis scope, and wait for **Index ready**.

### Follow a callback from its call site

With **Following selection** active, click `cb` in `cb()` or the `callback`
member in `ops->callback()` in the editor or Context. **Callback targets** lists
the indexed possible functions by name and file/line. Context shows the original
call. Choose a target to explore its normal Callers/Callees graph, then pin it if
desired. Even one result is a static candidate, not proof of runtime execution.

Assignments, pointer aliases, member/table values and registrations use the
existing inference results. **Include Function Arguments** is not required for
this call-site navigation; that option controls functions passed as arguments.
Clicking the object `ops` or an array index retains ordinary variable navigation.

**Other targets may exist** indicates incomplete results. If no target is known,
the view explicitly says so; check analysis scope and notices. Candidate lookup
reuses the selected file's index and does not start another analysis pass.
Macro-generated indirect calls remain available through the enclosing function's
Callees and inference details.

**Callback analysis** expands automatically when no target is resolved. It shows
recorded reasons such as a getter with no indexed body (**Return value unavailable**),
a registration parameter with no indexed supply (**Argument … has no indexed supply**),
or missing object/member values (**Object connection unavailable** / **Member value unavailable**).
**Structure layout unavailable** means positional fields cannot be determined.
These describe missing analysis information, not a proven runtime error. Include
the relevant getter, registration and table definitions when collecting a reproduction.

- Explicit member initializers such as `.cb_preprocess = target` remain attached to their object even if the structure definition is unavailable. Getter returns, argument passing and stored pointers can carry that object to a callback invocation. Positional initializers such as `{target, other}` still require a known field layout.
- Macro/callback analysis limits show **Partial index: analysis limits reached** in the status bar. Existing relations remain usable; inspect **Analysis notices** for the limit that left results incomplete.
- **Callback region limit: 256 reachable objects** bounds abstract storage regions
  tracked by local callback flow analysis. **Stage=propagation** means function
  parameter, return and mutation effects were being propagated. Passing callback
  storage addresses to functions with unavailable bodies, or importing many
  callee effects, can fill the limit. Inspect the function/file location,
  `ordered-region` / `function-regions` / `reachable-regions` operation and
  `first omitted` storage in the notice. AI Analyze waits for local indexing and
  can use a stable partial result. Smart Analysis Include / Exclude limit AI requests; general
  Include/Exclude controls the local analysis scope that produced this warning.
- Object/function macros, nested argument expansion, stringizing, token pasting, variadics and literal indexed includes are supported. The popup shows the expansion chain and tinted effective code. Clicking a call still previews its original invocation in Context.
- Local pointer initialization/assignment, pointer aliases, branches/loops, callback argument forwarding/registration/returns, static state, struct tables and arrays supply possible targets. Constant array indices stay separate; unknown indices collect possible entries.
- Known object instances stay separate. Unknown pointer fields may merge by declaration and remain uncertain.
- Element addresses retain their offsets through helper calls, returned pointers
  and wrappers: `p[1]` after passing `&table[1]` refers to `table[2]`. Real nested
  arrays retain their dimensions. Unknown offsets merge aliases conservatively;
  unrelated numeric buffer writes do not become callback effects merely because
  the address uses an offset. Relevant callback selectors remain tracked.
- Valid GNU attribute groups in otherwise unsupported declaration positions are
  recovered while preserving original source locations. Malformed attributes and
  unrelated syntax errors still produce notices.
- Standard integer typedefs and array element types keep unrelated numeric/byte
  writes out of callback effect budgets. Callback selectors remain tracked.
- External `memcpy`, `memmove` and `memset` change destination storage without
  changing source objects or following pointer fields into their pointees. A
  zero-length operation preserves storage and the return value aliases the
  destination. Unknown byte counts may cover the containing destination array;
  copied or zero-filled callback bytes remain uncertain. Indexed user definitions
  use their own bodies. `sizeof`/alignment operands remain unevaluated and sizes
  without ABI information remain unknown, rather than being treated as zero.
- **Inferred call** is always a static candidate, not proof of runtime execution. Its **Evidence** buttons preview function addresses, assignments and argument-passing locations. Enter/double-click opens an evidence location in the main editor. Selecting the node previews the actual indirect call and can expand the target's own calls.
- Unknown values, opaque mutations and analysis limits retain an **Indirect call** leaf and **Other targets may exist** details. Arbitrary addresses, byte-level memory operations, every cast/pointer arithmetic case and runtime dynamic linking are not fully resolved.

Example: run's Callees includes target as a dashed candidate. Clicking target previews ops.run().

```c
typedef void (*CB)(void);
void target(void) {}
struct Ops { CB run; };
struct Ops ops = { .run = target };
void run(void) { ops.run(); }
```

Analysis runs in the Worker. Macro expansion is bounded to 32 alternatives, 32 nested steps and 40,000 tokens per function. Callback propagation is bounded to 64 value/alias candidates, 256 mutation slots per function, 12 project passes and 4 loop passes. There is no project time cutoff; use **Stop local** to interrupt it. **Analysis notices** and unknown targets identify partial results; narrowing Include/Exclude scope can reveal more targets. Ordinary integer values are not propagated across functions, so array candidates may be broader; addresses stored in integer variables and converted back remain unknown. This is not a complete compiler preprocessor or a proof of every build/runtime path. A selected Make build configuration supports contextual header occurrences; computed include paths, unsupported options and compiler defaults can still leave them unresolved. See **Existing Make build configurations** below.

## Skip inactive branches

**Skip inactive branches** excludes branches known to be inactive from literal `#if` / `#elif` conditions of `0` or `1`, including their `#else` branches and nesting. Context still displays the original source.

It does not determine build-specific `#ifdef`, `#ifndef`, `defined(...)` or macro-expression conditions. Both possible branches remain visible as conditional candidates. Call expansion follows ordered `#define` / `#undef` events and indexed includes, but does not evaluate compiler build flags. Turn the option off to include `#if 0` code too.

## If results are missing or slow

### Locate callback limits (v0.1.62)

**Analysis notices** shows callback/macro limits before syntax notices. Callback
details include the observed file, line and function, followed by `stage`,
`project` elapsed milliseconds, `scope` elapsed milliseconds and
`evaluations=current scope/project total`. Scope means the current function visit
or global initializer, not its accumulated cost across all propagation passes.
Up to 64 distinct limit/location records are retained per inference run.

The former project-wide 10-second cutoff has been removed. The footer shows the
current function and elapsed time for that visit, resetting at the next function.
**Taking longer** highlights visits of at least five seconds without stopping
them. This measures a static function-summary evaluation, not a callback's runtime.
Hover for the round and function counts; rounds repeat until convergence, so the
count is not an overall completion percentage.

**Stop local** interrupts the busy Worker and retains discovered targets as
incomplete. **Retry local** recomputes relationships using parsed sources; it does
not continue from the exact interrupted instruction. Both actions are also in the
command palette as **Dynsight: Stop Local Analysis / Resume Local Analysis**.
Stopped analysis remains paused across source edits until Retry or Rebuild.
Old fixed-deadline caches retain parsed sources but recompute relationships once.
These controls do not enable AI. Memory, work and convergence limits
remain, including cumulative function/project work bounds and the 256-slot function mutation limit. A function budget is not reset on each propagation visit.

Mutation slots count distinct storage locations retained in a function summary,
including effects imported from helpers. Repeated writes to the same exact slot
reuse one entry. Structure members and separately tracked array elements can
consume separate entries; this is not a count of files or callback functions.

Overflow details now show the operation (`write`, `branch-join`, `call-effects`,
`function-effects`, or a region operation), retained count, first omitted location
and up to eight retained examples. These examples describe the first recorded
overflow, not all omitted locations. Region records track possible mutation of
objects and pointees; they have separate limits from exact storage effects.

The first detailed notice also lists up to eight functions with the highest
cumulative propagation expression-evaluation counts. `runs` counts actual
function-analysis visits; `cache hits` counts visits reused without reevaluating
the body. `total` is accumulated wall time for noncached visits, including summary
processing, and can be affected by GC/system load. This list excludes setup and
global initialization and is not a CPU profiler. It can identify repeated work
without blaming the function where the project deadline happened to expire.

Names and storage examples stay in the local notice view/cache; Report issue
continues to exclude them. Diagnostics do not automatically send anything.
On an offline WSL host, install the VSIX, keep Analyze Callbacks enabled, reload,
and run **Dynsight: Rebuild Index**, then expand **Analysis notices** locally.

Capture the expanded warning to share its location. **Report issue** includes
`callbackLimits` categories and cost counters but omits function names and paths.
Safety limits remain unchanged; these diagnostics do not by themselves resolve
every missing callback target.

### Report a problem (v0.1.46)

1. Open **Diagnostics → Report issue**, or **Dynsight: Report Issue** in the Command
   Palette. This collects a current snapshot, recent saved runs and available host
   failure excerpts without requesting Worker analysis or rebuilding the index.
2. Review the editable Markdown draft, add the incident time and reproduction steps.
   **Host excerpts may contain private metadata**; review them before sharing.
3. Choose **Save report** in the notification to save the reviewed `.md` file and
   send it to the maintainer. Cancelling the save keeps the draft. You may also use
   **Save As** after dismissing the notification.
4. **Copy report** copies only. **Copy & Open GitHub** copies and opens a generic
   issue page; submit manually. Attach a saved report if it is too long to paste.
   No report or logs are uploaded automatically.

Small diagnostic records are saved to workspace-specific extension storage every
10 seconds, at analysis transitions and on navigation action types. They omit
source, symbol names, paths and setting values. At most three sessions are kept,
each with two 256 KiB segments. The write queue is bounded; overload can drop older
pending records. Saved records survive a host restart, but pending writes can be
lost and no samples are collected while the host is frozen. Worker values are the
last received samples (`sampledAt`); process RSS includes the shared host and its
Workers, not only Dynsight. This starts after installation, not retroactively.

Since v0.1.47, Diagnostics and reports include file counts for each rebuild:
**Search results** counts API results (possibly duplicates/non-C files); **Selected**
counts unique C/H files after filtering and the file limit. **Indexed**, **Failed**
and **Unaccounted** describe those selected files at rebuild end. Missing values
mean no final snapshot, for example a superseded rebuild. **Discovery: unfinished**
means collection stopped on an error or file limit. These counts do not prove the search API found
every file. Later edits/deletions can change the current index independently.
Failed source reads or analysis now report **Partial index**, not **Index ready**.

Report issue includes up to the last 16 KiB of each journal segment, without waiting for pending writes. Host collection
reads only known `exthost.log` / `remoteagent.log` files near the extension log
folder in the current and preceding VS Code log session, at most eight files and
the last 64 KiB of each. It selects lifecycle/OOM lines, not complete logs. Missing,
unreadable or unsupported locations are noted. Previous logs can belong to another
window/workspace. WSL cannot collect the Windows-side Window log this way.
Known home/workspace roots and URLs are redacted, but complete anonymization is not
guaranteed. No sources or other extensions' private log folders are scanned.
The in-memory Diagnostics view resets on reload; saved report history is separate.
If logging is unavailable, the current report remains usable. Capturing before a
manual reload/rebuild is still preferable.

[Browse existing issues or open one manually](https://github.com/mrdylee/vscode_extension_relation_window/issues).

### Unexpected reindexing (v0.1.45)

Open **Diagnostics** even if there are no Analysis notices. **Last rebuild** shows
when and why the most recent full indexing started: **Extension startup**,
**Analysis settings changed** (with setting names), **Workspace folders changed**,
**Rebuild command** or **Rebuild button**. The extension-session start time helps
separate a new activation from another rebuild in the same session.

Expand **Rebuild history and source activity** for the last five rebuilds,
results/durations, source-parse and relation-pass counters, and the last source
event. A file event can reuse unchanged source without increasing parse/pass
counts. Counters cover this extension session; they are not per-file timings.
Capture a photo or **Report issue** before manual Rebuild/Reload. The history is
in memory only and resets on a new extension session. It contains no source,
paths or setting values. The diagnostic addition does not establish or fix the
cause of an unexplained restart.

### Photograph a memory diagnostic (v0.1.38)

Click **Diagnostics** in the Relation footer. A new memory-limit incident or
Worker failure opens the summary once automatically. Close it to resume browsing;
the same incident will not keep reopening it.

1. Open Diagnostics **before Rebuild index or Reload Window**. Rebuild clears
   Worker measurements but retains the last five rebuild records; Reload clears
   both. Click **Refresh** if needed.
2. Increase the panel height if the summary needs scrolling.
3. Photograph the entire summary, from the version heading through the bottom
   measurements, and share it when reporting the problem.

It shows the environment (including WSL), index status, Worker JS heap used/limit,
the 60% analysis guard, sampled peak, external memory, source/macro/callback/transfer
checkpoints, first budget hit and raw input counts. **Last Worker sample** is
timestamped; a busy Worker may not answer Refresh immediately. **Worker stopped**
preserves the last available sample rather than presenting it as current memory.

Values use **MiB** (1,048,576 bytes). Extension-host JS memory is shared with other
extensions and shown separately. Samples include caches and garbage collection;
stage differences are not exact allocations and these values are not total system
RAM. Only a bounded summary is held in memory; no source text or automatic upload
is added. Diagnostics does not change memory limits or analysis results.

From **v0.1.34**, the Worker reserves heap headroom before it exhausts its memory
limit. Macro expansion and callback propagation can stop with **Partial index:
memory budget reached**, while available source calls and literal function
arguments remain usable. Files that cannot be parsed within the remaining budget
are reported individually in **Analysis notices**. This is a best-effort safeguard;
a very large single allocation or system/WASM memory pressure can still fail.

An actual **ERR_WORKER_OUT_OF_MEMORY** now shows **Analysis stopped**, rather than
**Index ready**. Narrow **Settings → Include / Exclude**, then click **Rebuild
index** to create a fresh Worker after either memory condition. On older versions,
use **Developer: Reload Window** to replace a terminated Worker. Increasing graph
depth or toggling **Include Function Arguments** does not restart the analyzer.

From **v0.1.33**, macro include processing also bounds repeated header visits,
including headers with no macro definitions. A pathological include graph stops
with **Macro include traversal limit reached** instead of blocking later
source updates. Affected files retain source-call candidates marked incomplete;
with **Include Function Arguments** enabled, literal function arguments also
remain as incomplete candidates. Macro expansion and callback execution inference
for those files are skipped. Narrow the
analysis scope or correct the include graph to obtain fuller results. Editing a
relevant header automatically retries analysis. This limit does not exclude
the entire source file from ordinary symbol navigation.

1. Check **Following selection** versus **Pinned · Follow paused**.
2. Check the status and file count. If **Index ready** shows zero files, use **Settings** to check Include paths, casing and Exclude matches. An empty folder or a folder without C/H files also produces zero files.
3. **Partial index: 10,000 file limit reached** means the initial scan or later file changes exceeded the cap, including pending reads. Existing files still update; deletion or a failed read frees a slot for later events. Narrow Include or add Exclude patterns, then rebuild to select the intended files. Scope filtering happens before this limit.
4. Expand **Analysis notices**. Files above 2,000,000 UTF-16 code units are skipped. Unsupported C syntax can also produce notices. **Index ready** means indexing finished, not that every file was analyzed without errors.
5. **Rebuild index** repeats analysis with the current settings. It does not change the scope or limits.

**Partial index: call analysis failed** means follow-up call analysis did not finish.
If Analysis notices says **Analysis input changed unexpectedly**, click **Rebuild
index** to resynchronize the Worker. Obsolete reads after edits/deletion/rebuild
are discarded automatically.

The graph displays at most 300 nodes. Recursion stops expansion along that path. Macro and callback analysis is bounded, and compiler-specific syntax may remain unsupported. Missing relationships can therefore also be an analysis limitation.

## Existing Make build configurations

Run **Dynsight: Select Build Configuration**, or use the **Build** button in Relation, to choose an existing Makefile or shell/batch build entry. Discovery starts from the C/H files selected by general Include/Exclude and checks their parent directories up to the workspace root. It finds multiple module `.mk` files and follows actual include and script calls. A nearby `.mk` alone is not treated as proof that its options apply. Use **Choose build entry file…** when a nested entry was not discovered.

The selected configuration is remembered for this workspace. A read-only preview shows each compile command, working directory, source locations and unresolved reasons. Required script arguments can be entered when selecting that script. Existing compiler commands are inspected without executing scripts, Make, or the compiler; no compilation database is required.

Supported static GCC Define/Include options affect preprocessing, macro expansion and callback candidates. Settings changes do not widen general or Smart Analysis scope. A required header outside the general scope is reported rather than indexed silently. Files whose build membership is unknown remain available through basic navigation. Header functions and static storage are distinguished by the source file that includes them; select that source context when prompted. Opening a contextual definition from Relation preserves its context.

Build-file changes refresh the affected configuration. Ordinary C edits reuse cached build metadata. **Dynsight: Refresh Build Configuration** forces a fresh configuration check. **Use basic source analysis** in the selection list clears the chosen build. With **Skip Inactive** disabled, all preprocessing branches remain visible and build conditions do not prune them.

Windows batch extraction handles case-insensitive environment names, `PATH` assignments, `call`, and direct `.bat`/`.cmd` transfers. Literal `del` and `echo >`/`>>` operations on `.cfg`/`.mk` metadata are modeled in memory without writing project files. Pure Make list/path/string functions, lazy `define` blocks, target-specific variables and inherited compilation flags are supported within extraction limits. Recognized literal read-only shell transforms are evaluated without starting a shell; arbitrary expressions and generators remain unresolved.

GCC and Diab `dcc` share ordered explicit `-D`, `-U` and `-I` extraction. Other Diab target/options, response-file semantics, compiler predefined macros/default include paths and final link membership remain unverified. Unknown options preserve partial results rather than pruning branches with unverified settings. An unsupported post-build script does not erase compiler invocations already found. Unknown pre-build generators can affect later metadata and remain conservative; generated headers that cannot be evaluated are reported separately.

The preview distinguishes **compile membership** from **Source coverage** of the final build/link set. Coverage remains partial even when an individual compile command is verified. `build membership unknown` means no reliable compile context was established for the active file; check the preview's file/line/expression and unit reasons. Use **Use basic source analysis** to clear a selected build. Cross-translation-unit links retain explicit uncertainty. Changing a build configuration invalidates AI context and requires review of saved manual targets. Existing macro/callback work, alternative, memory and mutation limits remain in force.

## WSL and updates

In a WSL-connected VS Code window, install the VSIX into the WSL environment. Check that Dynsight — C Code Explorer appears under the WSL extension list. Configure workspace scope from that same window and match Linux path casing.

Use **Dynsight: Check for Updates** to check for a newer release. Updates require internet access and your approval; analysis and this guide work offline. After installing an update, run **Developer: Reload Window** and verify the version shown next to **Context**.

Automatic checks are enabled by default and run when the production extension activates, then when due. Successful checks are limited to once per 24 hours; an hourly timer checks whether one is due. New releases do not trigger an immediate notification. From v0.1.22, failed network/metadata checks retry on the next hourly tick while the extension remains active. Manual checks bypass the daily interval and report failures. Automatic checks stay quiet on network errors and are disabled in development/test mode. Use the user setting **Dynsight → Automatic Updates** to enable or disable them.
