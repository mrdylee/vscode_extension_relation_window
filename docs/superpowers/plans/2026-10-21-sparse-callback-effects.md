# Sparse callback effects implementation plan

> **For agentic workers:** Use superpowers:executing-plans for continuous implementation. Higher-priority platform instructions permit independent test/review agents.

**Goal:** Remove demonstrably irrelevant mutation-summary entries and bound opaque-call uncertainty without losing callback candidates or claiming uncertain targets are complete.

**Architecture:** Keep the existing source-folder analyzer, function summaries, and reverse call index. First exclude proven unread scalar storage from exported effects while preserving evaluation and heap values. Then represent opaque mutations by bounded storage regions rather than a separate unknown write for every descendant; preserve ordering, aliases, aggregate copies, and relevant incompleteness.

**Tech Stack:** TypeScript, tree-sitter C, node:test, VS Code Worker and extension integration tests.

Recovery point: `checkpoint/pre-sparse-callback-effects-20261020` at `1f2c1c6`, pushed before edits. Existing 256 explicit effects, 10-second callback time and memory guards remain unchanged.

## 1. Sparse effects

- [x] Add `test/callback-effects.test.ts`: 270 and 2700 unread scalar members plus one callback must avoid the mutation limit; helper-updated array selectors must still select the correct target.
- [x] Run `node --import tsx --test test/callback-effects.test.ts`; verify the two scalar-cap failures on the baseline.
- [x] Modify only the effect export path in `src/pointer-targets.ts`. Collect resolved scalar reads/address uses before propagation. Omit a scalar effect only with a known declaration and no read; unresolved layout, aliases, and array paths remain conservative. Preserve memory evaluation, getters and arbitrary argument positions.
- [x] Run the new tests, `test/pointer-calls.test.ts`, and typecheck. Commit this stage.

## 2. Bounded uncertainty

- [x] Add `test/callback-uncertainty.test.ts`: wide opaque objects, formal-to-actual region import, nested pointees, later strong overwrite, branch join, and independent versus dependent limits.
- [x] Confirm expected baseline failures before changing production behavior.
- [x] Add bounded region summaries and apply them on reads. Preserve known writes after an invalidation and snapshots copied before it. Normalize exported effects under final state so stale writes cannot regain precision in callers.
- [x] Keep project-level Partial diagnostics; localize edge uncertainty only where dependency coverage supports it. Retain conservative global incompleteness for project-wide time/work/memory/nonconvergence stops.
- [x] Run both focused suites and existing pointer tests; fix regressions. Commit this stage.

## 3. Review and measurement

- [x] Independently review the diff against the recovery tag; fix important findings and add failing regressions first.
- [x] Run `npm run typecheck`, `npm test`, `npm run test:worker`, `npm run test:memory`, `npm run test:performance`, `npm run test:extension`.
- [x] Compare the same synthetic sources against baseline and changed inference, recording callback time, warning counts, targets, incompleteness, and sampled heap. Do not interpret these as measurements of the unavailable private WSL firmware.
- [x] Document scope, findings, tests and remaining limitations under `docs/reviews/`.

## 4. Package and publish

- [x] Bump manifest, lockfile and package output to 0.1.53; add `docs/releases/0.1.53.md`.
- [x] Package and validate the actual VSIX in an isolated native VS Code test.
- [x] Commit, push the source branch and `v0.1.53`; require Windows/macOS/Linux release CI success.
- [x] Verify public release assets, SHA256, package contents and update resolution. Commit publication evidence separately.

No new settings, AI inference, selected-function-only index, or increased protection limits. Scalar reads used only for guards or payloads may still be retained in this conservative first stage. The private WSL corpus and its total indexing duration require a subsequent user-side measurement.
