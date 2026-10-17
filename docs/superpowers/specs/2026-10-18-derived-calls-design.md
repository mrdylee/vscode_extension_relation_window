# Macro expansion and callback target analysis

Baseline: feature/c-analysis-navigation at v0.1.27 (db1ddd6). Preserve main and
all prior tags. Continue the approved build-free source-folder workflow.

## Chosen approach

Use a token preprocessor and reparse expanded function bodies with the existing
Tree-sitter C parser in the analysis Worker. Compiler integration would require
build flags and toolchains; token-only call scanning would mistake declarations
and unevaluated expressions for calls. Preserve original source locations for
all generated calls, with macro definition/expansion provenance in details.

A project-analysis stage receives indexed raw files, resolves ordered includes,
defines and undefines, and returns derived files without reparsing unrelated raw
sources. Workspace requests carry accepted file versions and a project revision;
stale derived results cannot overwrite edits. Initial indexing and whenIdle wait
for this stage. Runtime work remains off the extension-host main thread.

## Feature 1: macros

Support object/function macros, balanced argument lists, nested expansions,
argument prescan, multiline definitions, stringizing, token pasting and variadic
arguments. Follow indexed transitive headers in include order. Respect definition
positions and undef/redefine; retain conditional/ambiguous alternatives instead
of assuming a build target. Bound recursion, token counts and alternatives, and
report limits rather than silently presenting complete results.

Reparse expanded bodies to collect effective calls; do not count discarded,
stringized, declaration-only or sizeof/alignof calls. Replace raw call records
for affected functions so nested arguments are neither duplicated nor retained
when a macro does not evaluate them. Keep original non-call symbol references.
Display generated function calls with Macro-expanded call details and original
invocation locations. Unexpanded or incomplete macro calls remain explicit leaves.
Expose expansion chains and text in the existing tinted popup; retain node sizes,
icons, 500 ms hover and Context/source navigation.

Finish this feature, run review-work, fix findings, and commit its review record
before implementing Feature 2.

## Feature 2: function pointers

Collect serializable expression and control-flow facts for declarations,
assignments, branches/loops, calls, returns and aggregate initializers. Resolve
local aliases, global pointers, callback parameters/registration, function-pointer
returns and named struct/union or array tables. Preserve declared-type/member
separation and distinguish object instances and constant array indices; unknown
indices conservatively union table entries.

Use bounded project fixed-point propagation for parameters/global/return values
and flow-sensitive local assignment/branch merges. Known overwrite kills old
local values; unknown writes and escaping addresses preserve an unknown marker.
Target candidates carry evidence, remain inferred (not runtime proof), and can
expand the called function's outgoing tree. Unknown calls retain an indirect leaf.
Incoming relations include inferred/expanded call sites with explicit labels.
Do not conflate same-named fields/locals or silently invent unsupported targets.

Finish this feature, run review-work and fix findings before packaging/publishing.

## Verification and release

Use TDD fixtures covering macro preprocessing semantics, effective-call accuracy,
conditional/header ambiguity, invalidation, pointer reassignment, aliasing,
callback forwarding, instance-specific tables, unknown paths and termination.
Validate per-feature UI and Extension Host navigation, then full existing tests,
FreeRTOS and synthetic large-workspace performance. Update offline Help/README,
release notes/version, verify extracted VSIX, and publish only after final review.
Keep source analysis independent of compile_commands.json and external tools.
