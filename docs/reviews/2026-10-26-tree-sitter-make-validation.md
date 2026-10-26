# Tree-sitter Make migration and 0.1.81 validation

## Scope and review

Replaced the Make statement regex loop with a typed Tree-sitter adapter. BAT/SH
traversal, metadata overlays, ordered includes, target evaluation and GCC/Diab
normalization retain their interfaces. Expressions inside recipes and define
blocks still use the bounded evaluator; there is no legacy statement fallback.

Eight failing-first GCC/Diab regressions covered quoted conditions, command-line
precedence in define blocks, computed references and foreach scope. Controlled
GNU Make dry runs of self-authored inputs independently confirmed expectations.
No original project script, Makefile or compiler was executed.

Review found and repaired empty-iteration foreach spacing and the bundled WASM
runtime's module URL, each with a regression. Computed assignment names and
unsupported operators remain explicit uncertainty rather than silently losing
flags. Inactive unsupported branches do not poison selected contexts. Parser
errors, oversized input, statement/iteration bounds and missing/corrupt grammar
are checked. Parser/tree handles are deleted in finally; repeated parses return
independent plain data. Cache compatibility is15 and extraction revision is
`tree-sitter-make-1.1.1-empty-replacement:1`.

The upstream1.1.1 grammar rejects valid empty substitution replacements. The
checked-in WASM changes only that field to optional; two builds with pinned
CLI0.27.1 produce SHA256
`e9d02f4641930b460e28cc5bda4b1494bf7a2f4082db032864f6584d41555aa1`.
The script, pinned dependency source and MIT notice are included in the source.
End users and normal CI do not build or download the grammar.

## Local verification

- Typecheck,730unit tests,93Worker/cache/workspace tests and6memory tests pass.
- Index performance and build-context performance gates pass. Twelve contextual
  C units have a local median35.46ms in the synthetic benchmark; this is not a
  private-firmware performance claim.
- Both browser UI suites pass.
- Real macOS VS Code host passes the Make picker, new quoted/computed/foreach/
  define syntax, GCC-to-Diab change, callback context and generic parse reuse.
- Native large workspace passes:2501indexed files and50000call sites, with
  12551fixture source files before the configured exclusions.
- Standalone parser bundle loads without node_modules and reports missing or
  corrupt grammar. The VSIX has17entries; every runtime entry and notices match
  the validated local build. Make WASM matches the checked-in vendor asset.
- Local VSIX731151bytes,SHA256
  `86f24ed7a33350f266fa4e944ef52c2772dd9e55d8b85f3de07b27b56949007b`.

Private firmware, compiler builtins, full Diab-specific semantics and final link
coverage remain unverified. Static extraction does not run build commands.
Clean-install, extracted-package host and publication evidence follows.

A fresh temporary source copy passed `npm ci --ignore-scripts` and all730unit
tests before any dist build. The extracted final0.1.81VSIX passed the full native
macOS host suite with exit0, including the new Make syntax and GCC/Diab callback
context assertions. No node_modules directory exists in that extracted package.
