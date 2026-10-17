# review-work — function pointers and callbacks

Local review against macro feature commit 98a16f8 and the approved derived-calls
specification. No review subagent or external review service was used. The macro
feature was reviewed, fixed, verified and committed before starting this feature.

## Findings fixed during review

- **P1, lost alternatives:** Conditional local declarations need outer/global
  fallbacks; conditional-expression assignments need branch memory joins.
  Switch alternatives, condition side effects and loop iteration observations
  must retain possible targets. Declaration initializers bind their own local.
- **P1, object identity and value semantics:** Struct copies, nested member
  assignments, aggregate returns and by-value arguments must not alias the source
  object's callback slots. Publish returned storage and copy by declared layout.
  Opaque by-value calls may modify pointees but cannot overwrite copied fields.
- **P2, storage lifetime:** Static local callback initializers execute once;
  later writes persist across possible invocations. Macro-generated static
  initializers replace their raw counterparts and are invalidated on edits.
  Distinct same-named statics created by one macro invocation retain separate
  slots. Macro-created local calls activate inference even without raw symbols.
- **P2, callback declarations and visibility:** Function-form parameters adjust
  to callback values, rather than masquerading as local function definitions.
  Static callback tables in transitive headers are visible to consumers.
- **P2, aggregate candidates:** Conditional layouts preserve both positional
  interpretations. Hexadecimal/octal designated indices remain concrete.
  Typed field writes after opaque allocation retain object identity.
  Conditional callback parameter types retain callable alternatives, and partial
  wildcard writes in multidimensional arrays remain visible at concrete indices.
- **P1, preprocessing interactions:** Reparsing expanded C must preserve the
  source conditions of assignments and returns, including literal returns and
  dereference writes. Keep compact statement-condition facts and conservatively
  guard generated statements. Distinct macro bodies can bind a same-offset call
  to different local/global targets; keep variants until target resolution, then
  merge equivalent sites. Block function prototypes resolve to linked definitions.
- **P2, source interaction:** Preserve original variable/member selection and
  ordinary references, keep unknown variable icons, mark every inferred edge as
  a candidate, and navigate both the actual call and evidence in Context.
- **P2, bounded propagation:** Retain unknown leaves for opaque writes, null or
  missing values and explicit limits. Recursive callback argument traversal uses
  a bounded worklist. Loop limits are visible instead of silently truncating.
- **Performance:** Profiling found repeated full-memory scans for array lookup,
  redundant scalar object aliases, repeated name/type resolution and duplicate
  macro-variant parsing. Index array slots, retain storage roots only for
  relevant declared types, memoize stable values/lookups and reuse identical
  expanded syntax with identical source origins. Keep conditional call-site
  provenance and caller-acknowledged Worker result identities.
  Cache function results only while their original heap reads, parameters and
  called summaries remain current. Preserve the first dependency read; replacing
  it with a later write incorrectly hid persistent callback updates in review.
  Scalar storage does not carry object aliases; wide mutation summaries are
  explicitly bounded and treated as opaque when incomplete.
  Unknown pointer fields use stable declaration abstraction rather than growing
  recursive object paths. Internal flow facts stay inside the Worker. Additional
  callback inference has a 10-second interactive budget with explicit partial
  results; a deterministic clock regression verifies that boundary.

## Verification

- Typecheck, git diff whitespace checks and 134 unit tests passed, including 39
  callback regressions. Reproducers failed before their fixes. Includes clock,
  recursion, wide-effect and multidimensional wildcard limits.
- Built Worker tests passed: callback initializer edits, result acknowledgement,
  unchanged identity and keeping flow facts out of the extension host.
- Browser tests passed. Inspected inferred-calls.png: compact existing glyphs,
  dashed candidate state, tinted expression and evidence preview remain usable.
- VS Code Extension Host passed: table call navigation, expansion to target
  callees, evidence preview without moving the editor, edits and deletion.
- Full FreeRTOS: 655 files, 33,212 ms, 14,183 expanded call records, automatic
  tracking 107–139 ms. This all-platform kernel run reached explicit callback
  loop/mutation/time limits and resolved zero concrete callback edges; callback
  correctness is verified by the dedicated fixtures and Extension Host table
  example, not claimed as complete kernel-wide runtime inference.
- Large workspace: 12,551 source files; 2,501 indexed after scope filtering,
  50,000 calls; 4,244 ms indexing and 82 ms selection. Incremental index check:
  12,500 files / 125,010 references, 20.7 ms updates and 0.030 ms edit.

No remaining actionable finding in the reviewed scope. The explicit accuracy
limits below remain product constraints. Package/release verification follows
in a separate delivery commit.

## Accuracy boundary

These are static may-target candidates from indexed source, never runtime proof.
Opaque code, arbitrary addresses, byte-level memory operations, pointer
arithmetic, compiler-specific constructs and unsupported types/control flow can
retain unknown targets or miss relationships. Conditional builds remain
candidates. Macro-generated type declarations are not a complete compiler
preprocessor; ordinary member R/W analysis remains syntactic.
