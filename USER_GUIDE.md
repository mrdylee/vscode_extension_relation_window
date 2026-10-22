# Dynsight — User Guide

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

## Optional Copilot callback candidates

Run **Dynsight: Analyze Callbacks with Copilot** and select a model from your
existing GitHub Copilot account. VS Code handles access consent. No separate API
key is needed. This enables `dynsight.copilotCallbacks` for the workspace. Disable
that setting to stop background requests and remove AI candidates from the view.

In **Settings → Copilot Model**, click **Select Copilot Model** to choose from
models available to your account. The selection is saved as `dynsight.copilotModel`.
You can also run **Dynsight: Select Copilot Model** from the Command Palette.
Selection alone neither enables AI nor sends requests. Analyze uses the configured
model; an unavailable model requires another selection instead of silently falling
back. Results are cached separately for each model and version.

Relevant source snippets are sent to Copilot's service; account usage limits and
organization policies apply. Dynsight does not inherit Copilot chat history or
Agent search. It selects bounded source evidence from the local index.

Use **Settings → Copilot Include** to control which callback invocation files may
use AI. This is an editable array in the ordinary VS Code settings editor; there
is no separate scope dialog. Initial setup copies general **Include** paths.
Newly added Include paths are also copied, while removing a copied path from AI
Include remains effective after restart and when other Include paths are added.
If general Include and Copilot Include change in the same JSON save, the explicit
AI array takes priority, including an empty array.
Removing a general Include path removes its AI copy. An empty AI Include means
**no AI requests**. A workspace with no general Include paths starts with an empty
AI list; explicitly add paths (or `**` for all indexed files) when needed.

```json
{
  "dynsight.include": ["App/**", "Drivers/**"],
  "dynsight.copilotInclude": ["App/**"],
  "dynsight.copilotExclude": ["App/Generated/**"]
}
```

Patterns are relative to each workspace root; folder settings are supported.
Exclusions win over AI includes. Only invocation files in this AI scope contribute
to AI requests, cached candidate display and pending counts. Supporting evidence
may still come from any locally indexed path. Changing the scope cancels the
active AI run and restores eligible cached results only. Excluded cache is kept
for later reuse; use Analyze for missing results. Local callback analysis and its
limits use the separate general Include/Exclude scope.

When local registration and data-flow analysis has candidates, Dynsight first
selects up to eight of them and asks Copilot to review their evidence. This path
supplies at most ten source snippets and 8,000 source characters, including bounded
getter/caller context when available. When no local candidate is available, it
uses the broader source search. Local shortlists are incomplete and count as
**Context limited**; a negative reply only describes the offered candidates.
Prompt-format changes invalidate old AI results. Startup still makes no new
requests; use **Analyze Callbacks with Copilot** to refresh missing results.

- Unchanged startup, navigation and normal **Rebuild index** only reuse AI cache.
- Saved changes can analyze unresolved callbacks, up to five new requests per
  batch. No requests are made during unsaved editing. Diagnostics shows requests,
  cache hits, pending callbacks and failures.
- Click **Analyze all remaining** in the footer, or run **Analyze Callbacks with
  Copilot**, to process every pending site automatically in batches of five.
  Each request uses your Copilot allowance. Progress stays cumulative across batches.
- Click **Stop analysis** or run **Dynsight: Stop Copilot Analysis** to cancel the
  current request and stop further requests. Stop also applies during initial
  Include setup or pending model selection. Completed results are kept; Analyze
  resumes the missing sites. Saving does not restart a stopped job. Active jobs
  pause during unsaved edits and resume after saving and local indexing settle.
- A request error stops automatic continuation. Run **Reanalyze Callback Candidates
  with Copilot** to invalidate the old AI cache once and process all sites again.
  Normal Rebuild does not force AI requests.
- Source, relevant search results, settings, model and prompt versions determine
  cache validity. Changed inputs cancel outstanding work; stale answers are discarded.
- **AI candidate** labels appear in Callers, Callees and both mode. Their details
  link to source evidence. They are suggestions, never proof of invocation. An
  empty answer means no candidate was found in the supplied bounded context.
- In Callees and both mode, AI candidates replace the indirect/unresolved entry
  at that exact invocation. Other invocations and local inferred/direct targets
  stay visible. No candidate leaves the original entry visible; disabling or
  clearing AI restores it. The original reference remains available for tracing.
- Click an AI candidate function in Callees to preview its definition in Context
  and expand its callees. Double-click or press Enter to open the definition in
  the editor. The details popup keeps separate links to the original callback
  callsite and evidence; navigating a candidate does not prove the call occurs.

The Copilot footer shows processed/detected call sites, remaining sites, failures,
candidate count, **No candidate in supplied context**, and **Context limited**.
**Index ready** describes local indexing only. **All detected sites processed**
means the detected unresolved call sites have been processed; it does not mean
every source path or callback target was found. An empty bounded-context answer
can count as processed while still leaving a callback unresolved.

Local index records contain source and analysis data. AI cache records contain
validated result identifiers and hashes, not source prompts. Both live in workspace
extension storage, not the Git repository. Removing this storage removes the cache.
Caching avoids repeated work; it does not make incomplete static or AI analysis complete.
Successful saves retain the preceding local index generation. Interrupted or
concurrent writes can leave orphan generation directories; they are not deleted
automatically because another VS Code window might still be writing them.

`dynsight.analyzeCallbacks` controls the existing static callback engine independently.
Copilot supplements unresolved results. Disabling static analysis skips expensive
pointer propagation, but source facts needed by function-argument navigation and
later reanalysis remain available; this is not a zero-memory callback mode.

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

- `node_modules`, `.git` and `.vscode-test` are always excluded.
- `files.exclude`, `search.exclude` and `C_Cpp.files.exclude` do not configure this extension's analysis scope.
- Definitions and references outside the scope are absent from Relation. Include shared headers and libraries if you need their relationships.
- To restore full scope, empty Include and remove unwanted Exclude entries.

## Choose where to expand macros (v0.1.36)

Include/Exclude choose the files to index. **Macro Expansion Folders** chooses
which indexed source bodies and initializers receive macro expansion.

1. Click **Settings → Macro Expansion Folders → Select folders…**, or run
   **Dynsight: Select Macro Expansion Folders** from the Command Palette.
2. Check the entries that need expansion, then click **OK**. The list uses your
   Include patterns, or top-level folders when Include is empty. Saved custom
   patterns remain available. In multi-folder workspaces, choose a workspace
   folder first; the setting is saved for that folder.
3. Wait for the analysis update to reach **Index ready**. Check all for all
   sources; uncheck all to disable expansion. Cancel leaves settings unchanged.

```json
{
  "dynsight.include": ["App/**", "SDK/**"],
  "dynsight.macroExpansionFolders": ["App/**"]
}
```

This indexes App and SDK but expands only App sources. Unchecked SDK headers
still provide macro definitions to checked App sources. Unchecked bodies keep
basic symbols, direct calls, literal function arguments and supported pointer
analysis. Calls or callback targets that depend on macro expansion may be absent.
Headers must still be inside Include/Exclude scope; Exclude always wins.

The default `["**"]` expands all indexed sources. An explicit `[]` disables
expansion. Edit the Settings array directly for narrower glob patterns such as
`App/control/**`. Patterns follow the same path and case rules as Include/Exclude.
This reduces macro work; basic indexing and pointer analysis still consume memory.
It does not guarantee that every project fits the Worker memory budget.

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

### Callback analysis (separate option)

**Settings → Analyze Callbacks** (`dynsight.analyzeCallbacks`, default **on**)
controls full function-pointer and structure callback propagation in Callers,
Callees and Callers & Callees. With it off, a conservative **Registered candidate**
pass still uses global designated initializers such as `.cb = target`, direct writes
within the same function, and exact-object local pointer aliases such as
`p = &table; p->cb()`. Alias chains are limited to 16 steps. This fallback does not
infer through branches, loops, getter returns or interprocedural forwarding.
Registered candidates are evidence of registration, not proof of runtime invocation;
unresolved call sites remain visible. Clicking a call site can still open registered
or Copilot candidates when static propagation is off.

This is separate from **Include Function Arguments**. Turning callback analysis
off skips propagation, while direct calls, macro expansion and literal function
names/addresses passed as arguments remain available. Alias, member and returned
function argument targets require callback analysis.

Changing the option recalculates relationships from existing source facts without
reparsing files. Any running analysis completes before the change is applied.
This is not immediate cancellation or recovery of failed/missing files: check the
scope and use **Rebuild index** when recovery is needed. Basic parsing and macro
analysis still consume memory and retain their existing limits. Report issue
records the option so partial results can be interpreted correctly.


If macro include traversal reaches its limit, directly written function names
and addresses can still appear as partial argument candidates. Their popup shows
the incomplete-analysis reason; this does not confirm macro expansion or actual
execution. Alias and function-pointer inference stays disabled for those files.

Functions, variables, types and macros have distinct icons. Context and detail popups use syntax colors; these are not full compiler-based semantic highlighting.

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
  can use a stable partial result. Copilot Include limits paid requests; general
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

Analysis runs in the Worker. Macro expansion is bounded to 32 alternatives, 32 nested steps and 40,000 tokens per function. Callback propagation is bounded to 64 value/alias candidates, 256 mutation slots per function, 12 project passes, 4 loop passes and an approximately 10-second budget for additional callback inference. **Analysis notices** and unknown targets identify partial results; narrowing Include/Exclude scope can reveal more targets. Ordinary integer values are not propagated across functions, so array candidates may be broader; addresses stored in integer variables and converted back remain unknown. This is not a complete compiler preprocessor or a proof of every build/runtime path; computed include paths and build-specific header instantiation are outside the supported scope.

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

The 10-second callback budget covers project inference. **Project budget observed
at** identifies where a time/memory check stopped it; that function did not
necessarily consume the whole budget. A setup or project-wide limit has no
arbitrary file attribution. The 256-slot limit applies to function mutation
summaries; global initializers no longer build that unused summary.

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

## WSL and updates

In a WSL-connected VS Code window, install the VSIX into the WSL environment. Check that Dynsight — C Code Explorer appears under the WSL extension list. Configure workspace scope from that same window and match Linux path casing.

Use **Dynsight: Check for Updates** to check for a newer release. Updates require internet access and your approval; analysis and this guide work offline. After installing an update, run **Developer: Reload Window** and verify the version shown next to **Context**.

Automatic checks are enabled by default and run when the production extension activates, then when due. Successful checks are limited to once per 24 hours; an hourly timer checks whether one is due. New releases do not trigger an immediate notification. From v0.1.22, failed network/metadata checks retry on the next hourly tick while the extension remains active. Manual checks bypass the daily interval and report failures. Automatic checks stay quiet on network errors and are disabled in development/test mode. Use the user setting **Dynsight → Automatic Updates** to enable or disable them.
