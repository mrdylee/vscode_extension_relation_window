# Review fixes — 2026-10-22

The review reproduced three regressions in the pending Copilot changes.

1. An Analyze command waiting for initial Include setup captured cancellation too
   late. Stop could therefore be ignored and all remaining requests could start.
   Capture explicit cancellation before setup and check it after model discovery,
   picker completion and setting writes. Disabling Copilot also cancels pending
   starts. Initial scope copying can still complete without canceling itself.
2. Saving general Include and an explicit Copilot Include subset together let
   automatic copying overwrite the user's subset. Respect explicit AI scope
   changes in the same configuration event, including empty arrays. Subsequent
   general Include additions still preserve previous AI removals.
3. AI hints confirming an existing partial local target were discarded as
   duplicates. Keep the AI overlay and replace the matching local presentation in
   Callees, Callers and References without double-counting. Retain local records
   for cursor resolution, supporting evidence and restoration after clearing AI.
   Cover both inferred and registered local candidates.

Validation: all 450 unit tests passed, TypeScript checking and the production
build passed, and the Chromium browser UI checks passed. Regression tests cover
immediate Stop, pending setup, pending model selection, disabling during setup,
atomic JSON edits and partial local target replacement/restoration.

These changes are included in the 0.1.67 release candidate. The separate
propagation, typedef and memory model issues discussed in analysis.md are not
changed by these review fixes.
