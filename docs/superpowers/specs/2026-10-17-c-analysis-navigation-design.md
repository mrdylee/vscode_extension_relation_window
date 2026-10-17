# C analysis navigation: staged design

## Baseline and decision

Preserve main at 1c6de46 (v0.1.24). Work on feature/c-analysis-navigation.
Keep Tree-sitter and build-free operation. Add independently testable increments;
do not replace the existing engine or publish an experimental build as stable.

Alternatives considered: adding a compiler backend would improve build-specific
semantics but require configuration; implementing all semantic features together
would make regressions hard to isolate. Incremental development is preferred.

## Sub-projects

1. Callees (this implementation): outgoing call expressions, real sites, existing
   depth/Context interactions, conservative macro and indirect-call leaves.
2. Type/member binding: retain declared types and typedef/member ownership before
   resolving dot/arrow chains. Test identical member names on different types.
3. Macro dependencies: show replacement-list dependencies before attempting
   bounded expansion; do not equate token references with executed calls.
4. Pointer target candidates: use initializers/assignments and callback tables,
   display evidence and uncertainty; never promise runtime target certainty.

Sub-projects 2–4 need their own spec and tests after the first working increment.
This branch initially delivers sub-project 1, not full macro/pointer semantics.

## Callees contract

Add Callees to the existing function relation selector; References remains the
default. Variable roots retain access filters and incoming caller traversal even
when the remembered function mode is Callees. No new window or icon redesign.

Index outgoing references by containing function during each file update. Query
only that function's records and resolve targets with existing scope/static rules.
Group repeated sites for each resolved target; retain multiple candidates and
unknown conditional branches. Exclude proven inactive code and unevaluated
sizeof/alignof call expressions. Never interpret an address reference as a call.

Resolved function nodes support depth, expansion and cycle limits. Macro uses,
unresolved names and indirect expressions remain visible as leaves with explicit
popup descriptions. Pointer variables must not become a same-named global
function. Do not expand macro bodies or infer pointer targets in this increment.

For Callees children, click previews the actual call site and expands the node;
Enter/double-click opens that site. Popup site buttons retain all repeated uses.
Root preview remains the selected definition. Keep compact icons and 500ms hover.

## Verification

Core fixtures: cross-file direct calls, static shadowing, repeated/nested calls,
initializers, recursion, unknown/disabled branches, unresolved names, macros,
pointer calls, updates/deletes, variable-mode preservation and bounded graphs.
Integration: mode round trip, Context call-site selection and depth expansion in
the real VS Code Extension Host. Browser: mode selector and leaf explanations.
Run existing suite, FreeRTOS and large-workspace checks before packaging.
Version experimental package as 0.2.0-dev.1 and keep stable main unchanged.
