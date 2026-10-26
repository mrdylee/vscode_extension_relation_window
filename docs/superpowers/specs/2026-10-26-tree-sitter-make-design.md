# Tree-sitter Make extraction for GCC and Diab

## Authorization and outcome

The user approved the revised review and requested Superpowers review,
implementation, verification, push and release. C is the source language. Both
GCC and Diab remain supported. The baseline is main `f2eb271`, version 0.1.80.

Replace the hand-written Make statement parser with tree-sitter-make and repair
the confirmed evaluation failures. Success means correct per-C-file commands
and explicit uncertainty, not merely a syntax tree or parity with old output.
Never execute a workspace build script, Makefile, compiler or generator during
automatic extraction. Controlled test fixtures may use GNU Make as an oracle.

## Evidence and scope

The review reproduced four gaps with synthetic inputs:

1. Quoted `ifeq` loses an active define and reports partial extraction.
2. Computed variable names such as `$(FLAGS_$(MODE))` produce no compile unit.
3. `foreach` used to construct options produces no compile unit.
4. A `define` block overwrites a command-line variable and incorrectly reports
   resolved for both gcc and dcc. GNU Make preserves the command-line value.

The upstream candidate is tree-sitter-grammars/tree-sitter-make, npm 1.1.1.
Its published tarball contains a WASM grammar. Pin the exact version and lockfile
integrity, verify loading with web-tree-sitter 0.27.1, and ship its MIT notice.
No grammar is assumed correct merely because it parses without ERROR nodes.

## Architecture

BAT/SH traversal -> metadata text/overlay -> Make syntax adapter -> bounded Make
evaluation -> CompileInvocation -> existing GCC/Diab normalization -> contextual
C analysis. Keep public BuildEntry/BuildProfile/CompileUnitContext contracts.

Create `src/build-make-parser.ts` for runtime initialization, tree lifetime and
typed statements. Statement kinds are assignment, definition, condition,
include, rule, export and unsupported. Preserve raw values and recipe text,
operators, target selectors, conditional branches, and source locations. Convert
to ordinary data before deleting each tree. Cache only the loaded language;
avoid a permanent cache of live Tree-sitter nodes. Use a separate Make Parser,
not the C analyzer's Parser instance. Resolve packaged assets from the bundle
directory and source-test assets from dependencies, without depending on dist.

Replace the Make-only logical-line/regex loop in `build-options.ts` with ordered
statement evaluation. Includes must be evaluated at their original position
using the current variable environment and working directory. Traverse only
known active branches; unresolved branches remain uncertain and do not merge
mutually exclusive values. Do not report errors from an inactive semantic branch
as active build failures when the containing structure is known.

Retain the BAT/SH logical-line helper, environment/cwd propagation, in-memory
generated metadata, Make argument handling, target traversal, dependency tracking,
budgets, and GCC/Diab option normalization. Remove the old Make statement parser
after the replacement passes the oracle fixtures; no silent legacy fallback.

Retain pure function evaluation in `build-make-expression.ts`. Support computed
variable names and bounded foreach with local loop-variable scope and lazy body
evaluation. Use a single assignment path for ordinary and define assignments,
including command-line precedence, flavor and +=/?= rules. Retain raw expression
expansion for recipe and define text where the grammar exposes raw text; do not
misrepresent this as a complete Tree-sitter evaluator. Keep only one expression
evaluation implementation. Call/eval, arbitrary shell execution, compiler builtins,
full implicit-rule search and final link membership are not new capabilities in
this change; unsupported relevant constructs remain diagnosed.

Syntax recognized by the grammar but not implemented by the evaluator (e.g.
double-colon/grouped rules, custom recipe prefix) must not silently become an
ordinary rule. A syntax error or missing node gets a located issue. A malformed
common Make input conservatively affects commands dependent on that invocation;
a target-local unknown must preserve independent sibling facts. Missing required
includes remain errors; absent optional includes stay optional. Missing grammar
or incompatible WASM produces an explicit extraction issue and leaves basic C
analysis usable. No fallback to the removed statement parser.

## Correctness and lifecycle

Use the existing BuildFileSystem rather than Node filesystem reads for workspace
metadata. Never normalize all whitespace or comments before parsing: Make values,
recipes, continuation lines and escaped hash characters have different rules.
Normalize only the specific node being evaluated while retaining raw evidence.
The complete source text receives a trailing newline for the grammar if needed;
reported ranges remain bounded by the original text.

Retain extraction size/depth/operation limits and add bounded syntax traversal.
Release tree and parser resources on success and failure. Track parsing cost
separately from evaluator iteration counts so syntax traversal cannot erase all
useful evaluation budget. Verify cold/warm timing and repeated extraction memory.
Change analysis cache compatibility when extraction semantics change, and include
the extraction revision in build fingerprints. A parser upgrade must not silently
reuse results from the previous evaluation semantics.

## Acceptance

- Existing build-context, BAT/SH, option, preprocessor and fallback tests pass.
- GCC and Diab obtain expected ordered commands from quoted conditions, multiple
  includes, target-specific variables, define precedence, computed variable names
  and foreach. Tests use independent expected values checked against GNU Make.
- Continuations, CRLF, escaped hashes, no final newline, inline recipes, comments,
  empty inputs and malformed inputs do not fabricate resolved compile facts.
- Unsupported grammar/evaluation constructs remain located diagnostics. Existing
  side-effect and real budget-limit tests remain meaningful.
- Clean npm ci/test before build works; packaged VSIX includes and loads the Make
  grammar. Runtime never downloads a grammar or requires a native compiler.
- Typecheck, full unit, Worker/cache, memory, performance, build-context performance,
  native Extension Host, UI and large-workspace gates pass as applicable. The
  release workflow verifies Windows/macOS/Linux before publication.
- Publish a new immutable patch tag; verify public aliases, checksums, packaged
  files and the real updater path. Do not claim private firmware confirmation.

## Alternatives considered

Parser-only replacement is smaller but preserves the proven incorrect define
precedence. Rewriting the entire Make evaluator expands scope without eliminating
dynamic-build uncertainty. The selected approach replaces statement recognition
and repairs the four proven gaps while preserving bounded evaluation and C APIs.

## Self-review

The design distinguishes syntax, evaluation and compiler options; has no automatic
execution path; retains platform and scope boundaries; names unsupported behavior;
and requires independent semantic expectations rather than old-output parity.

## Verified grammar adjustment

The published 1.1.1 grammar loads with the runtime but rejects the valid empty
substitution replacement in `$(DIRS:/=)`. Keep upstream pinned and apply only
`optional(field('replacement', $._primary))` during a reproducible development
build. Commit the resulting WASM under `vendor/tree-sitter-make`; normal builds
copy it to dist. The pinned CLI and regeneration script are development tools,
and normal CI uses `npm ci --ignore-scripts`. Standalone bundle tests verify
runtime module URL setup, sibling assets, and missing/corrupt grammar diagnostics.
