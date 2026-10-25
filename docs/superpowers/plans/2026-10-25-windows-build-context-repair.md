# Windows build context repair execution plan

> Use superpowers:executing-plans inline. User authorized implementation, tests
> and publication; no intermediate approval handoff is required.

## 1. Regression baseline

Add focused cases in `test/build-options.test.ts`, `test/build-context.test.ts`
and contextual integration/cache tests. Run `node --import tsx --test` on these
files. Record intended failures before touching production extraction.

## 2. Bounded expressions and Make invocation

Repair `src/build-options.ts`; extract expression helpers to a focused file if
necessary. Add balanced expansion, pure functions, define blocks, per-target
variable inheritance and correct pattern/automatic prerequisite handling. Check
distinct module options, function bounds, unknown expressions and existing tests.

## 3. Batch and uncertainty boundaries

Add case-insensitive cmd variables, direct transfer semantics and literal metadata
overlay. Preserve provenance and dependency digests. Record error state at compile
invocation; preserve already resolved units after postprocessing. Keep unknown
pre-build effects conservative. Verify original fixture text is unchanged.

## 4. Compiler and contextual pipeline

Implement documented common Diab options beside GCC in `src/build-context.ts`;
keep unsafe options explicitly partial. Verify selected defines reach contextual
preprocessing/callbacks for both drivers. Update cache semantics and preview
locations as necessary. Run all focused tests, then typecheck/full unit/Worker.

## 5. Review and release

Review changes against the spec. Update guides and release notes/version for the
next unused patch. Run `npm run typecheck`, `npm test`, `npm run test:memory`,
`npm run test:performance`, `npm run test:worker`, `npm run test:ui`, native
`npm run test:extension` and `npm run test:large`. Package, inspect and run the
extracted VSIX. Commit and push release source/tag; observe cross-platform release
workflow and verify all public asset hashes and updater selection. Record private
firmware limitations and exact published source without claiming user installation.
