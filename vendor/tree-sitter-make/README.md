# Make grammar asset

Source: [tree-sitter-grammars/tree-sitter-make](https://github.com/tree-sitter-grammars/tree-sitter-make), npm 1.1.1, integrity pinned in package-lock.json.

License: MIT; full notice is included in THIRD_PARTY_NOTICES.txt and the VSIX.

Local grammar change: allow an empty replacement in a substitution reference,
for example `$(DIRS:/=)`. The published grammar requires a nonempty replacement
although GNU Make allows deleting a suffix. All other grammar rules are upstream.

Rebuild with Node 22 and pinned tree-sitter-cli 0.27.1:

```sh
npm ci --ignore-scripts
(cd node_modules/tree-sitter-cli && node install.js)
node scripts/build-make-grammar.mjs
npx tsx --test test/build-make-parser.test.ts test/build-options.test.ts
```

The development CLI may download its WASI SDK on first use. Normal extension
builds/tests use the checked-in WASM, so clean CI and end users need no compiler,
native grammar binding, network access or install script. Updating this asset
requires rerunning parser, extraction and packaged-host tests and changing the
extraction revision if interpretation changes.

Checked-in WASM SHA-256: `e9d02f4641930b460e28cc5bda4b1494bf7a2f4082db032864f6584d41555aa1`. Two consecutive local builds produced identical bytes.
