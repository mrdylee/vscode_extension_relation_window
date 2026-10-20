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

1. Open a folder containing your C source files in VS Code. A build, SDK or compilation database is not required.
2. Run **Dynsight: Open Relation and Context** from the Command Palette.
3. Click a function or variable name in the main editor. Relation shows its relationships; Context shows the selected code.
4. Check the file count and index status at the bottom. Relationships may be incomplete while **Indexing C sources…** is shown.

Use **Settings** in the Dynsight toolbar to configure sorting, Context layout, call graph direction and Include/Exclude together for the current workspace. With no folder open, it opens user settings instead. In a multi-folder workspace, use folder settings for folder-specific Include/Exclude overrides; layout preferences apply to the whole window. **Help** opens this guide again. Both actions are also available in the Command Palette as **Dynsight: Open Settings** and **Dynsight: Open User Guide**.

The index stays in memory for the current window. Navigating or closing unchanged
files reuses existing results. Edits (including unsaved edits), discarded edits,
and external file changes update the affected source and call relationships.
**Rebuild index**, analysis-scope changes, or reloading the window starts a fresh
analysis. This is not a persistent on-disk index cache.

## Choose which files to analyze

Only C/H files are analyzed. Patterns are relative to each workspace folder; use `/` even on Windows. For a folder and everything inside it, write `App/**`, not just `App`.

| Include | Exclude | Result |
| --- | --- | --- |
| Empty | Empty | All C/H files, apart from built-in exclusions |
| Set | Empty | C/H files matching any Include pattern |
| Empty | Set | All C/H files except Exclude matches |
| Set | Set | Include matches minus Exclude matches |

**Exclude always wins.** An empty Include list means all C/H files; a nonempty list with no matches means zero files. Overlapping patterns do not duplicate files. Changes automatically rebuild the index and also apply to file changes and unsaved edits.

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
3. Wait for the automatic rebuild to reach **Index ready**. Check all for all
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
- **Context layout → Combined / Combined · Full width / Separate**: Combined keeps Context and Relation together. **Combined · Full width** places them together across the bottom, beneath both sidebars, using VS Code's Justify panel alignment. Terminal and other bottom-panel views share that width. Selecting Combined or Separate after Full width restores Center alignment (editor width). Separate gives Relation the panel's available width and opens **Dynsight Context** as an independent Explorer view. Drag that view's **header**, or use **View: Move View**, to move it below the file tree or to another supported VS Code location. VS Code remembers docking positions. Its width follows the destination area; long code lines may require horizontal scrolling. Syntax colors, code clicks, pinning and shared selection remain available in all three choices.
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

- Object/function macros, nested argument expansion, stringizing, token pasting, variadics and literal indexed includes are supported. The popup shows the expansion chain and tinted effective code. Clicking a call still previews its original invocation in Context.
- Local pointer initialization/assignment, pointer aliases, branches/loops, callback argument forwarding/registration/returns, static state, struct tables and arrays supply possible targets. Constant array indices stay separate; unknown indices collect possible entries.
- Known object instances stay separate. Unknown pointer fields may merge by declaration and remain uncertain.
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
