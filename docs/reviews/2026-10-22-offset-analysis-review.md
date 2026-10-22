# Review of the new analysis.md — 2026-10-22

Reviewed user commit `3087b82` on `fix/callback-candidates-progress`, based on the
published 0.1.68 source. The commit adds only analysis.md; it was fast-forwarded
locally without modifying that document. Product code is unchanged by this review.

## Confirmed: address-selection dependencies leak into pointed-to data

`collectReads` collects both the base buffer and offset for `&buffer[offset]`.
Its index expression marks the offset as required. Bidirectional argument links
then connect that offset to the pointer parameter and back to the entire buffer.
The required-scalar closure consequently retains ordinary numeric element writes
as callback effects. See `src/pointer-targets.ts:563` through the index case.

Synthetic comparison, using an unsigned parameter as the dynamic offset:

| Writes in pack | Actual address | Expansion | Limit diagnostics |
| --- | --- | --- | --- |
| 257 | `&buffer[0]` | disabled | 0 |
| 257 | `&buffer[offset]` | disabled | 1, pack mutation at parameter[1][256] |
| 257 | `&buffer[BASE]`, BASE defined as 0 | disabled | 1, same mutation |
| 257 | `&buffer[BASE]` | enabled | 0 |
| 248 | dynamic offset alone | disabled | 0 |
| 248 | dynamic and literal offsets to the same helper | disabled | 2, in caller |

The last case reproduces caller-side write/region overflow even though pack's
own effects fit the 256-slot bound. This confirms the documented mechanism; exact
diagnostic counts and first-omitted indices depend on the surrounding call order.

## Confirmed: offset addresses are composed as additional array dimensions

`instantiate`, `objects` and imported call effects append suffix strings to the
actual address. `buffer[0]` plus parameter `[n]` becomes `buffer[0][n]`, without
considering the pointee's type or array dimension. Unknown-index reads can also
retain overlapping wildcard/concrete addresses. Duplicate expanded paths consume
the per-function/call effect budgets and lead to further region warnings.

An additional correctness reproduction exposes more than excess warnings:

```c
typedef void (*CB)(void);
static void first(void) {}
static void second(void) {}
static CB table[3] = {first, first, first};
static void set(CB *p) { p[1] = second; }
void run(void) { set(&table[1]); table[2](); }
```

The analysis returns only `first` for the indirect call, marked incomplete=false,
and misses `second`. The write was represented under a spurious second dimension.
Any fix must preserve real multidimensional arrays and weak/wildcard uncertainty
while composing pointer offsets and merging overlapping aliases.

## Confirmed: the trailing GCC attribute warning is a parser limitation

The supplied `static struct ... write_buf __attribute__((section(...)));`
declaration passes local `gcc -fsyntax-only -x c`. Tree-sitter instead reports an
ERROR and a missing semicolon in its tree. The raw analyzer emits an unsupported
syntax issue while still collecting the variable symbol. This is separate from
the callback effect/region overflow and does not establish invalid firmware C.

## Evidence and limits

- Reproduction script: ignored `output/review-offset-analysis.ts`.
- Pre-fix result snapshot: `/tmp/dynsight-offset-analysis-review-work.jsonl`.
- All 65 existing callback-effects and callback-index regression tests pass,
  confirming that the existing suite missed these offset-composition cases.
- The actual firmware/settings are not available here. The document's real-target
  six-to-zero comparison, offset 400 and the settings typo were not independently
  rechecked. No firmware code or settings were changed.
- Fix scope: separate address-selection from pointee-data dependencies; compose
  typed pointer/array offsets and merge overlapping aliases conservatively; add
  regression coverage for scalar buffers, real callback selectors, offset
  callbacks, true multidimensional arrays and the GCC declaration syntax.
- At the time of this verification, no fix or new release had been applied.

## Review-work follow-up

The analysis is supported by fresh reproduction against the unchanged source.
Blocking product findings, in priority order:

1. **P1 — Missing real callback targets with an apparently complete result.**
   Offset composition is duplicated in returned values (`instantiate`, line 420),
   actual-object resolution (`objects`, line 431), and imported call effects
   (line 912, plus region paths). Tests fail for a direct mutator, a returned
   element address and wrapper forwarding. Fixing only imported writes would
   leave the other failures in place. Share typed offset composition while
   preserving real multidimensional indexing and conservative alias semantics.
2. **P1 — Ordinary scalar buffer packing still exhausts callback summaries.**
   Bidirectional argument links at lines 569–571 mix address selection with data
   dependency. Both the 257-write dynamic-offset case and the 248-write case with
   overlapping actual addresses fail the no-false-limit assertion. Keep relevant
   callback selectors/aliases tracked when separating the dependency kinds.
3. **P2 — Valid trailing GCC attributes produce unsupported-syntax warnings.**
   The syntax must be handled during parsing or narrowly recognized recovery,
   preserving offsets, symbols and actual following functions. Merely suppressing
   every parser ERROR could hide unrelated malformed/unsupported code.

Assertion-based review probes live in ignored
`output/review-work-offset-regressions.test.ts`. Running them yields **6 failures,
1 pass**; the passing control preserves real 2D-array callback changes. Log:
`/tmp/dynsight-offset-review-work-regressions.log`. These are review probes, not
yet checked-in CI regression tests. Promote them into the existing test suite
when implementing the fixes. Product code, tests and released versions were
unchanged by that review.

## Implementation after review

The user requested the fixes after review. The working tree now addresses all
three product findings; these changes are not published yet.

- Array values and addresses of individual elements/objects have distinct
  abstract representations. A common offset composer is used for returned
  pointers, actual-object resolution, imported effects and invalidation regions.
  It adds the first relative element offset, keeps real nested dimensions and
  handles zero indexing of scalar-object addresses.
- Wildcard and concrete aliases are merged conservatively. Wildcard pointer
  reads retain known possible elements, and wildcard writes remain weak.
  Opaque calls invalidate the correctly offset object while preserving neighbors.
- Address-selection dependencies are excluded from pointee-data links. This also
  covers pointer null guards, member-address arguments and decayed member arrays.
  Relevant integer selectors and pointees registered in aggregate initializers
  remain tracked.
- If the initial parse fails, only error-free GNU attribute groups are blanked
  with equal-length whitespace for one recovery parse. Source/newline offsets,
  conditional declarations, multiple declarators and macro bodies are preserved.
  Malformed attributes and unrelated syntax errors remain diagnostics. Macro
  expansion uses the same recovery parser.
- Analysis compatibility advances from 2 to 3, independently of package version.
  Old parsed/inferred results require Rebuild rather than silent reuse.

Validation includes 28 new permanent unit regressions in core, macro,
callback-effects and callback-index tests. The original seven review probes now
pass. Synthetic literal/dynamic/macro offset comparisons, including 248 and 257
writes with overlapping actual addresses, have no false limit diagnostics. The
flat callback-offset example resolves second, and the GNU declaration has no
unsupported-syntax warning. Production tests still enforce genuine callback
mutation/region budgets. No actual firmware/settings were modified.

Final verification: all **514 unit tests**, **47 Worker/cache/workspace tests**
and **4 memory/cache collection tests** passed. TypeScript checking, production
build, the seven original review probes and index performance validation passed.
Node 22 was used for Worker and memory/performance checks. The Worker integration
fixture confirms Index ready with 400 dynamic-offset writes, GNU declaration
recovery and the corrected callback target. The native Extension Host fixture
was updated to include dynamic-offset packing and a trailing GNU section
attribute; that native fixture has not been run locally.

Evidence logs: `/tmp/dynsight-offset-fixes-complete-unit.log`,
`/tmp/dynsight-offset-fixes-complete-workers.log`,
`/tmp/dynsight-offset-fixes-complete-memory.log`,
`/tmp/dynsight-offset-fixes-complete-performance.log` and
`/tmp/dynsight-offset-fixes-complete-review-probes.log`. The before/after synthetic
comparison is preserved in `/tmp/dynsight-offset-analysis-review-work.jsonl` and
`/tmp/dynsight-offset-fixes-complete-comparison.jsonl`.
