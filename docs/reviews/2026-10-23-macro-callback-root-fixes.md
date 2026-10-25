# Macro and callback root-cause fixes — 2026-10-23

## Scope

ELF and AI integration are deferred. The actual target firmware is unavailable, as confirmed by the user. Changes address reproducible general C analysis defects; they do not establish that every issue in the target project is resolved. Existing scope-picker changes in the working tree belong to separate work.

## Reproduced and fixed

1. Repeated alias predicates such as `#define BOARD FEATURE` followed by six separate `#if BOARD` groups were treated as independent choices. This exhausted the 32-alternative bound and introduced impossible callback combinations. Predicate identities now include transitive macro definition versions. Redefinition, conditional changes, token pasting, dynamic builtins and opaque environments remain conservative. Dependency traversal is bounded.
2. Copying a structure with 270 numeric substructures and one callback exported irrelevant container writes into mutation summaries. Those writes exhausted the 256-effect bound before the callback could propagate. Aggregate copies now use the existing tracked-storage predicate for container summary export, retaining their in-memory values and callback-relevant scalar selectors.

The new selected regression cases produced seven failures on the original HEAD; the genuine 257-callback limit control passed there. All now pass. Coverage includes object/function macro aliases, correlated table indices, header edits, structure/array/member copies, nested numeric selectors, and preservation of real limits.

Analysis cache semantics advance from version 9 to 10 so previously derived results are not reused. A Worker regression checks 13 complete inferred references across cold analysis, warm reuse, disk-cache restoration and a saved callback-target change.

## Final verification

- `npm test`: 622 passed, 0 failed.
- `npm run test:worker`: 88 passed, 0 failed (includes a build).
- `npm run test:memory`: 6 passed, 0 failed.
- `npm run typecheck`: passed.
- `git diff --check`: passed.

No deployment or Windows/WSL runtime test was performed.

## Remaining performance issue

The public FreeRTOS single-port corpus (33 files: root C sources, public headers, GCC ARM_CM3 port, heap_4 and template FreeRTOSConfig) still did not finish detailed analysis within the benchmark's 60-second cancellation window, both before and after these fixes. Basic analysis completed in approximately 0.7 seconds; most detailed-analysis time was spent in callback propagation. This corpus is not the user's Diab firmware configuration.

A 20-second CPU profile implicated opaque-write invalidation, region containment checks and garbage collection. An experimental alias-queue deduplication neither established a successful regression result nor completed the public benchmark; it was removed. No broad performance improvement is claimed. Follow-up needs a semantic repro of expensive invalidation that verifies retained uncertainty and cross-caller isolation before optimizing that path.

Temporary benchmark evidence: `/var/folders/x2/8pcxrtqs20gcnyj3_bm8jwlh0000gn/T/dynsight-root-comparison-0_7nl6eo/` (`baseline-single-port.json`, `current-single-port.json`, `baseline-regressions.log`, `profile-results.json`). These temporary files may be removed by the OS.
