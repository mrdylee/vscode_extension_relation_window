# RBMS Diab build context validation

The static extractor now selects overlapping object patterns using specificity
and prerequisite evidence. Shared and product object prefixes no longer become
extra components in the C source path. Directory observations invalidate cached
selection when prerequisite files are created or deleted.

The option normalizer recognizes the finite option forms observed in RBMS Diab
5.9.6.7 general, MCAL, SafeRTOS and SOX configurations. Ordered explicit macros
and include paths remain available for preprocessing. Target/dialect builtins,
default include paths and unrecognized options remain unknown or partial.
The extraction-version change invalidates old build-context fingerprints.

## Validation

- Ten initial regressions failed on the old pattern selection and unsupported
  option handling before the implementation. A later stress regression exposed
  unnecessary budget consumption; duplicate patterns and nonmatching checks were removed.
- 903 unit tests, 96 Worker/cache/workspace tests, typecheck and the synthetic
  build-context performance check passed.
- Regressions cover 1,400 C units with overlapping C/assembly rules, competing
  prerequisites, negative directory-cache invalidation and four Diab flag groups.
- Cold, warm and debug-edited contexts select the expected callbacks through an
  explicit include directory. Pre-build generators still prevent verified membership.
- Exhaustion remains visible after generated artifacts fill the 128-notice cap.
  The existing 20,000-operation extraction budget is unchanged.

## Actual RBMS inputs

These are read-only static checks of the current checkout, without BAT, Make,
compiler, generator or AI execution.

| Entry | Extracted C commands | Missing source paths | Option diagnostics | Result |
| --- | ---: | ---: | ---: | --- |
| Root `Build_RBMS.bat` | 228 | 0 | 0 | Partial; membership unknown |
| Root `Build_RBMS_no_pbms.bat` | 228 | 0 | 0 | Partial; membership unknown |
| `Makefile.mk`, RBMS app target, grid_JF3/SafeRTOS | 223 | 0 | 0 | All explicit command options resolved |

The root BAT projections retain generator uncertainty and report extraction
exhaustion while traversing the full factory-image build. Their counts are bounded
projections, not complete firmware build membership. The RBMS app target finishes
within the existing extraction budget; its final link coverage is still partial.
The representative app command preserves 45 macro actions and 62 include paths;
the debug entry adds `DEBUG_TEST`, producing 46 macro actions.
All 65 read root-build inputs had identical hashes before and after validation.

Evidence is local under `/private/tmp/dynsight-diab-review-20261102/`, including
`final-rbms-validation.json`, failing-first logs and regression logs. Installed
extension UI, native Diab output and hardware behavior were not exercised.

## Second review 2026-11-03

Four additional correctness issues were reproduced and addressed:

1. Directory-less patterns now match the target basename. The target directory
   is restored to pattern prerequisites and `$*`, while fixed prerequisites stay
   relative to Make's working directory. Three owned fixtures were compared with
   GNU Make using `-n`; no project Makefile was executed.
2. Parent-folder creation/deletion invalidates descendant directory observations
   and cached included Makefile contents, including earlier missing reads. Cache
   identity follows canonical URI spelling for Windows encoded drives and path case.
3. Compiler option values and response-file names ending in `.c` no longer become
   source files. Multi-input commands retain a distinct unit per C source, with
   repeated normalization charged to the unchanged extraction budget.
4. A target-specific append that leaves an expression unresolved on a simple
   variable is partial with unknown membership. It cannot prune branches using
   incomplete macro options, and independent sibling targets remain resolved.

Fourteen new failing-first regressions cover these cases. The final unit suite
passes 898 tests, the Worker suite passes 96 tests, and typecheck and the synthetic
build-context performance check pass. Root BAT entries still extract 228 bounded
C commands each with zero missing source paths or unsupported observed options.
The app target retains 223 resolved C commands and stays within the extraction budget.
Root generator uncertainty and full-image exhaustion remain explicit. Read input
hashes are unchanged: 65 files for the root checks and 46 for the app check.

The source changes remain on `codex/rbms-diab-build-context`; no installed extension
update, public release or repository integration was performed.

## Additional review findings corrected 2026-11-03

The subsequent review reproduced two regressions against the original HEAD and
owned GNU Make dry-run fixtures. Both now select the expected compile source:

1. A generated C file explicitly listed as a prerequisite of the current target
   participates in implicit candidate availability. The extractor no longer chooses
   an unrelated existing fallback source instead. Other targets' prerequisites do
   not displace an available source. Generator recipes remain unevaluated and retain
   their existing diagnostics.
2. Implicit rule candidates with empty stems are excluded before specificity sorting.
   This applies to both direct and nested targets. Shared text matching is unchanged,
   preserving empty matches in `patsubst` and `filter`.

Five regression cases were added; the generated-source case and both empty-stem
cases failed before the fixes. The focused extraction/cache/parser suite passes
95 tests, and both original review reproductions pass. The full suite passes 903
unit tests and 96 Worker/cache/workspace tests. Typecheck and the synthetic
build-context performance check pass. The extraction version is
`tree-sitter-make-1.1.1-diab-patterns:5`.

Read-only RBMS checks retain 228 bounded C commands per root BAT entry and 223
resolved C commands for the app target. Source paths exist and observed compiler
options produce no unsupported-option diagnostics. Read input hashes are unchanged:
65 root-build inputs and 46 app inputs. Root generator uncertainty and full-image
extraction exhaustion remain explicit. No native Diab or installed UI validation
was performed, and no publication or integration is included.

Additional evidence is under `/private/tmp/dynsight-review-work/`: `fix-red.log`,
`fix-focused.log`, `fix-full-unit.log`, `fix-worker.log`, `fix-rbms.log`,
`fix-rbms-app.log` and `fix-performance.log`.
