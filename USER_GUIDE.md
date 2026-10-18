# C Relations — User Guide

This guide is included with the extension and works offline. You do not need Git or a GitHub account to use C Relations.

## Start here

1. Open a folder containing your C source files in VS Code. A build, SDK or compilation database is not required.
2. Run **C Relations: Open Relation and Context** from the Command Palette.
3. Click a function or variable name in the main editor. Relation shows its relationships; Context shows the selected code.
4. Check the file count and index status at the bottom. Relationships may be incomplete while **Indexing C sources…** is shown.

Use **Settings** in the C Relations toolbar to configure sorting, Context layout, call graph direction and Include/Exclude together for the current workspace. With no folder open, it opens user settings instead. In a multi-folder workspace, use folder settings for folder-specific Include/Exclude overrides; layout preferences apply to the whole window. **Help** opens this guide again. Both actions are also available in the Command Palette as **C Relations: Open Settings** and **C Relations: Open User Guide**.

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
  "cRelation.include": ["App/**", "Drivers/**"],
  "cRelation.exclude": ["**/generated/**", "**/test/**"]
}
```

Analyze the full project except Polyspace and build output:

```json
{
  "cRelation.include": [],
  "cRelation.exclude": ["**/Tools/Polyspace/**", "**/build/**"]
}
```

Other examples: `App/**/*.{c,h}` matches C/H files under App; `**/vendor/**` matches vendor folders at any depth. Paths are case-sensitive in WSL. Windows-hosted analysis ignores path casing.

- `node_modules`, `.git` and `.vscode-test` are always excluded.
- `files.exclude`, `search.exclude` and `C_Cpp.files.exclude` do not configure this extension's analysis scope.
- Definitions and references outside the scope are absent from Relation. Include shared headers and libraries if you need their relationships.
- To restore full scope, empty Include and remove unwanted Exclude entries.

## Navigate Relation and Context

- **References** shows calls, address references and declarations. **Callers** includes direct, macro-expanded and inferred callback calls. The tree grows toward the code that calls or references the selected symbol.
- **Callees · Called functions** grows in the opposite direction: from the selected function to the functions it calls. Repeated calls share one node; the popup lists each actual call site. Click a child to preview the call site in Context and expand its outgoing calls. Enter or double-click opens that call site in the editor.
- **Callers & Callees** shows the selected function between incoming callers and outgoing callees. The default is callers on the left and callees on the right; Settings can reverse them. The whole graph starts at the left edge, with no automatic root centering. The depth selector applies to both sides; click a branch to expand it independently. Variable selections still use the existing R/W filters. Both sides share a 300-node limit, with roughly half reserved for outgoing calls.
- **Macro-expanded call** shows a call found after token expansion. **Inferred call** shows a possible function-pointer/callback target, with a dashed candidate icon and evidence. **Macro invocation**, **Indirect call** and **Unresolved call** leaves retain unavailable expansions, unknown indirect targets or names missing from the analyzed scope. Declared functions without an indexed body have no outgoing calls to expand.
- Variable selections keep their Read/Write filters and incoming caller tree, even when the remembered function mode is Callees. Returning to a function restores that mode.
- **1 level – 8 levels** controls the initial tree depth. Click a Relation symbol to preview it in Context and expand from that node by the selected depth. The root stays in place; already deeper branches remain open. Repeated clicks do not grow the same node indefinitely.
- **Double-click / Enter** opens the symbol or reference in the main editor.
- **Context code click** moves the main editor to that location. When following selection, Relation also follows the clicked symbol. Drag to select and copy text without navigating.
- **Following selection** means Relation follows symbols selected in the editor or Context. Click it to switch to **Pinned · Follow paused** and keep the current root. Click again to resume. Pinning does not stop indexing or manual branch expansion.
- Hover over a node without moving for 500 ms, or press **Space** on a focused node, to see details and individual call/reference locations. Click a location to preview the exact use in Context. **Escape** closes details.
- **→** expands a focused node, **←** collapses it, and **Shift+→** lets you choose an expansion depth. The details popup also offers **Levels…**.
- If multiple definitions match, use **Select definition** to choose the correct file.
- Drag the divider to resize Context and Relation.

## Settings and moving Context (v0.1.30)

Click **Settings** in Relation to open all C Relations settings in one place. Sorting and layout choices are configured here:

- **Callees sorting → Name order / Source order**: the default is name order. Source order groups each target at its first original call location, including macro-expanded and inferred calls. Repeated calls stay in one node, with popup locations in source order. Tied locations retain discovery order. This is the order written in source, not runtime evaluation order. Callers/References keep name order.
- **Context layout → Combined / Separate**: Combined keeps the existing two-pane layout. Separate gives Relation the panel's full width and opens **C Relations Context** as an independent Explorer view. Drag that view's **header**, or use **View: Move View**, to move it below the file tree or to another supported VS Code location. VS Code remembers docking positions. Its width follows the destination area; long code lines may require horizontal scrolling. Choose Combined to return to the shared window. Syntax colors, code clicks, pinning and shared selection remain available.
- **Call Graph Direction → Callers left / Callees right**, or **Callees left / Callers right**: applies to Callers & Callees mode. Changing sides preserves expanded branches, selection and the Callees sorting rule. The graph remains left aligned and left-side branches are visible initially; it does not center the selected function or reanalyze sources. Single-direction modes keep their existing orientation.

Right-click inside Relation (or focus a node and press **Shift+F10**) for **Settings…** and **Reset graph position**. Reset returns the whole graph to its initial left-aligned position.

Hold the left mouse button on the graph's **background** and drag to pan. A small movement threshold distinguishes a drag from a click. Dragging does not analyze files or change selection. Node clicks, double-clicks and Context text selection keep their existing behavior. A new root resets the graph position.

Sorting, Context layout and call graph direction are saved in workspace settings (user settings when no folder is open):

```json
{
  "cRelation.calleeSort": "source",
  "cRelation.contextLayout": "separate",
  "cRelation.callGraphDirection": "callees-left"
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

JSON setting: `"cRelation.includeFunctionArguments": true`.

Functions, variables, types and macros have distinct icons. Context and detail popups use syntax colors; these are not full compiler-based semantic highlighting.

## Symbol icons and badges

![All C Relations symbol icons: outlined and filled functions, variables, types, macros, unknown symbols, dashed states and variable-use badges](media/symbol-icons.png)

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

Casts, function-return receivers, macro-generated types, anonymous-member promotion and designated-initializer member references are not supported for selecting member R/W relationships. Unknown types are not guessed from field names. Writes through a pointer field or to an array element do not imply a write to the whole field. Callback target inference is a separate analysis described below. Type/expression traversal is bounded to 32 steps and intermediate candidates to 64, so more complex cases may have missing relationships.

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

1. Check **Following selection** versus **Pinned · Follow paused**.
2. Check the status and file count. If **Index ready** shows zero files, use **Settings** to check Include paths, casing and Exclude matches. An empty folder or a folder without C/H files also produces zero files.
3. **Partial index: 10,000 file limit reached** means the initial scan omitted files. Narrow Include or add Exclude patterns. Scope filtering happens before this limit.
4. Expand **Analysis notices**. Files above 2,000,000 UTF-16 code units are skipped. Unsupported C syntax can also produce notices. **Index ready** means indexing finished, not that every file was analyzed without errors.
5. **Rebuild index** repeats analysis with the current settings. It does not change the scope or limits.

The graph displays at most 300 nodes. Recursion stops expansion along that path. Macro and callback analysis is bounded, and compiler-specific syntax may remain unsupported. Missing relationships can therefore also be an analysis limitation.

## WSL and updates

In a WSL-connected VS Code window, install the VSIX into the WSL environment. Check that C Relation Explorer appears under the WSL extension list. Configure workspace scope from that same window and match Linux path casing.

Use **C Relations: Check for Updates** to check for a newer release. Updates require internet access and your approval; analysis and this guide work offline. After installing an update, run **Developer: Reload Window** and verify the version shown next to **Context**.

Automatic checks are enabled by default and run when the production extension activates, then when due. Successful checks are limited to once per 24 hours; an hourly timer checks whether one is due. New releases do not trigger an immediate notification. From v0.1.22, failed network/metadata checks retry on the next hourly tick while the extension remains active. Manual checks bypass the daily interval and report failures. Automatic checks stay quiet on network errors and are disabled in development/test mode. Use the user setting **C Relation: Automatic Updates** to enable or disable them.
