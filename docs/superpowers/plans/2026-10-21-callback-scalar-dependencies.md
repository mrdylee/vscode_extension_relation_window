# Callback scalar dependencies implementation plan

**Goal:** Keep existing analysis budgets while excluding unrelated scalar effects and preserving unused pointer arguments across limited helpers.

**Architecture:** Collect scalar dependencies from selectors, conditions and storage expressions before propagation. Follow assignments and pointer aliases, identify members by declaring aggregate rather than member name alone, and retain unknown layouts conservatively. Exclude proven unrelated scalar storage from opaque regions as well as explicit effects. Apply omitted-effect regions instead of treating every incomplete indexed helper as an opaque function.

**Tech Stack:** TypeScript, tree-sitter C, node:test.

- [x] Add failing regressions for logged scalars, unrelated same-name members, scalar addresses, unused pointer arguments and genuinely omitted callback writes.
- [x] Implement dependency collection and scalar storage filtering in `src/pointer-targets.ts`; preserve the 256-entry effects, regions and omission budgets and all project stop conditions.
- [x] Verify selector copies, aliases, compatible cross-file declarations and opaque selector changes; update region-boundary fixtures to use relevant storage where appropriate.
- [x] Run focused regressions, full unit suite, typecheck, build, Worker/workspace, memory and FreeRTOS validation. Review the diff for scope and conservative fallbacks.

The user approved this scope in chat. No release, version bump, installation or publication is included. Existing investigation files remain intact.

## Verification

- The initial seven bug regressions failed before the engine change. Global-alias and pointer-getter dependency regressions also exposed missing dependency links during implementation and passed after those links were added.
- Final focused callback suites: 129 passed. Full unit suite: 394 passed. Worker/cache/workspace: 40 passed. Memory: 4 passed. Typecheck, build, diff checks and native VS Code extension integration passed.
- The 21-case budget audit now expects the repaired behavior; all cases passed. Relevant integer selectors and callback storage still reach the existing mutation/region limits at 257 entries. Genuine traversal truncation and exhausted omission bookkeeping retain conservative project uncertainty.
- The repository's real `callback_example.c` retains complete `example_preprocess` and `example_process` inferred calls.
- Full FreeRTOS native integration did not pass: one changed-engine run reached analysis limits, another exceeded the 60-second indexing deadline. An isolated original `HEAD` worker also failed the native `Index ready` assertion with mutation/region/10-second limits. A separate identical-input 656-file Worker comparison (2 GiB heap) reached memory/time limits in both engines. These partial runs are not evidence of complete corpus equivalence or a performance benchmark.
- To diagnose the corpus failure, the FreeRTOS test now includes bounded callback diagnostics and the first memory-limit incident in its status assertion. Production limits and runtime interfaces are unchanged. The user's WSL project was not available for validation.

## Review follow-up

- [x] Reproduce call-site effect expansion (135 fields × two actual objects) with unused and affected pointer storage, including a wrapper.
- [x] Reproduce unrelated local `struct Data` declarations in different functions and nested blocks sharing scalar dependency keys.
- [x] Apply overflow uncertainty only to omitted keys; identify locally declared aggregates by declaration ID while retaining cross-file global compatibility.
- [x] Re-run callback, full unit, Worker/workspace, memory, typecheck, build and extension integration checks. Existing full FreeRTOS limitations above remain separate.

All four new regressions failed before the follow-up changes and passed afterward. The expanded-effect tests retain the mutation warning and unresolved calls for both omitted destinations while preserving the unused object's complete callback, directly and through a wrapper. Locally scoped tag tests cover separate functions and separate blocks; the existing cross-file global struct selector test still passes.

Final follow-up verification: focused callbacks 133 passed; full unit suite 398 passed; Worker/cache/workspace 40 passed; memory 4 passed; typecheck, build, 21-case audit, native extension integration and diff checks passed. The original review reproductions now show a complete unused `foo` callback with the mutation warning retained, and no limit warning for unrelated scoped tags. No limits were increased. Full WSL/FreeRTOS corpus equivalence remains unverified as documented above.

## Current publication request

The subsequent user request explicitly asks to analyze/fix the remaining mutation
limit issue, keep Analyze Callbacks enabled, validate/review and publish WSL VSIX.
The previously prepared implementation is being reviewed and verified for 0.1.60.
See `docs/reviews/2026-10-21-review-0.1.60.md` for current evidence and limits.
