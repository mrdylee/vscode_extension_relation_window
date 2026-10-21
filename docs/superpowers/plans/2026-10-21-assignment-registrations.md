# Assignment callback registrations implementation plan

> Execute inline using superpowers:executing-plans; no parallel agents required.

**Goal:** Show literal function assignments as registrations and resolve simple pointer/local-member calls with full analysis off.
**Architecture:** Extend the existing explicit pass; retain separate registration references, index them for graph projection and reuse the registered UI with distinct registration labels.
**Tech Stack:** TypeScript, tree-sitter C, node:test, esbuild.

- [x] Add no-call graph and analysis-OFF regression tests; run to verify failures.
- [x] Extend registration collection and straight-line storage tracking in src/explicit-callbacks.ts and the model.
- [x] Project registration records in src/relations.ts; update webview labels, setting documentation and analysis cache identity.
- [x] Run targeted tests, repair only expectations directly affected by the new registration relationships, then run npm test, npm run typecheck, npm run build and Worker tests.
- [x] Review the diff and report verified scope and remaining runtime limitations.

Verification: npm test 360/360; Worker/cache/workspace tests 36/36; browser UI checks passed, including Registration badge, dotted connector, assignment preview and popup labels; build and typecheck passed; git diff --check passed. Installed VS Code extension was not replaced.
