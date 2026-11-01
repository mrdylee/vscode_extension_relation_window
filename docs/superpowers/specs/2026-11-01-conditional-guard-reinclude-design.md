# Conditional guard re-entry after macro mutations

The accepted P1 review demonstrates that a header with a guarded prefix and a suffix containing conditional `#undef CFG_H` loses a valid callback target on re-inclusion. Full macro expansion keeps CFG_H in `defined`, while basic reference binding already invalidates uncertain guard facts.

The user authorized this correction and previously authorized verification/deployment of the same RBMS issue. No additional product preferences or visual design are needed.

Use the existing uncertain-guard state and optional include branches in both timeline modes. An unconditional definition/undefinition still establishes a known state; a conditional mutation that changes definedness establishes uncertainty. Preserve the guarded-prefix optimization, suffix processing, all analysis bounds, source scopes and AI settings. Advance cache compatibility because previously saved relationships can omit targets.

Alternatives: disabling all guarded-prefix skipping restores repeated expansion and risks the original RBMS limits; implementing a second symbolic preprocessor duplicates existing state machinery. Reusing the existing uncertainty handling is the smallest correction. If real-project verification exposes excessive branching, investigate that evidence before changing scope or resource bounds.

Acceptance: maintained regressions retain first/second after a conditional reset and conditional guard definition; controls retain one target for unconditional reset/known guard. Check cold/warm derivation, header edits and disk restoration. Existing guarded-prefix tests and actual RBMS native analysis/rebuild retain all 147 files with no macro/callback limit notices. No BAT/compiler/generator or AI execution.
