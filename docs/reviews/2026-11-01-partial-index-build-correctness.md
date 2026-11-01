# Partial analysis and Make context implementation verification

The user authorized implementation, validation and publication after the issue review. Baseline source: `e499a75`. Approved design/plan: `6f3ae18`. Product version: 0.1.91; analysis cache compatibility:17.

## Resulting behavior

Truncated macro alternatives retain known targets and propagate unknown values through local/global initialization, getter outputs and dependent call results. Generated partial programs carry their reasons. Work-limited helpers export their possible omitted writes as uncertain regions, including transitive writes and output parameters. Known global writes stay scoped; independent global/local callbacks remain complete. If a possible write footprint exceeds the existing bound, the engine marks project results incomplete instead of expanding every global alias graph.

The reviewed 64-possible/32-retained macro example no longer reports completeness. The helper that stops before `cb=second` no longer proves that its caller invokes the previous callback. The controls within 32 alternatives, full helper execution, unrelated callbacks and disk-restored uncertainty pass. The guards remain 100,000 function work, 256 storage/region entries and 32 macro alternatives.

Make extraction assigns directly selected/discovered Makefiles their own directory. Offset-preserving grammar recovery handles computed names/targets, non-recipe comments and recipe/assignment continuation boundaries. Bounded outer `eval(call …)` includes, `MAKEFILE_LIST` and simple final-component wildcard source lists are evaluated as data. Eval in call/foreach-local scopes, unknown functions and unsupported wildcard forms remain unresolved. Source create/delete and directory deletion invalidate cached wildcard lists.

Shared immediate target options are expanded once for equivalent prior options. Exact target option lookups use an index so unrelated option groups do not spend the budget for every prerequisite. Existing operation/depth/size guards remain in force. No Make, compiler, shell or generator is executed by extraction.

The UI distinguishes `Local analysis limited / Re-run local`, interrupted Retry and paused Resume. Discovery with no chosen configuration says `No build selected · N found`. Existing caches require Rebuild index because cached completeness semantics changed.

## Actual RBMS evidence and limits

The original 147 source files still matched their cached source hashes. Two warm runs after the final bounded fallback took 31,362 ms and 30,414 ms in a separate Node process, compared with the previous 35,081 ms and 36,611 ms observations. These are observations on this machine, not a controlled speedup claim. Both retained the 100,001/100,000 function guard at the same source location, 9 mutation and 11 region details, and 154 detected unresolved/incomplete callback contexts. The project remains partial; warnings were not suppressed.

An initial conservative implementation grew alias work substantially and was stopped in its isolated diagnostic process before release. The final implementation falls back to explicit project uncertainty once an unknown footprint exceeds 256 roots rather than expanding that graph. The final 147-file runs completed with identical measured work counts 594,720 each.

Static extraction of the existing application build target changed from 0 compile units to 224 commands, 52 for C files inside the current analysis scope. Relevant application commands contain 45 explicit macro actions and 62 include paths. All 224 units remain partial because Diab-specific option semantics are unverified. Generated artifacts and final link coverage remain partial.

The actual partial build projection was checked on one application source: 5 prepared occurrences and 9 call results, all incomplete. The existing policy correctly withheld unverified compiler actions/include settings; it did not prune branches using those settings. This verifies conservative application, not a fully reconstructed Diab build. Required headers outside general Include remain unavailable. Actual project settings, build selection, firmware sources and active AI behavior were preserved; the tests sent no new AI requests.

## Validation

- Fresh typecheck and **858 unit tests** passed. New regressions were observed failing before implementation, including all four reviewed false-completeness assertions, nested cwd, computed names/targets, continued lines/comments, eval-call/list/wildcard extraction, target-option cost and UI status.
- **94 Worker/cache/workspace tests**, **six memory tests**, performance and both browser UI suites passed.
- Actual isolated macOS VS Code integration passed against source. The large-workspace native fixture passed: 2,501 indexed files and 50,000 calls.
- Local VSIX verification: 18 archive entries, 764,058 bytes, SHA-256 `b12aa546402ba5dcd7e6b05fa4254ae139a5ce52c94c80ce3daea4109917c156`. Manifest/runtime/webview/guides match the validated source; cache 17 and updated UI/Make extraction strings are present. Extracted-package native verification is recorded in the publication receipt.
- Local review covered omitted-effect bounds and independent callback controls, existing scope and provider behavior, data-only Make operations, cache compatibility, wildcard invalidation and release metadata. No unrelated refactor, dependency update or workflow change was made.

Evidence: ignored `artifacts/partial-index-147/` holds before/red/after probes and logs; `artifacts/release-0.1.91/` holds final unit/package/native and publication evidence. The release receipt records source/tag, three-platform CI, public assets and updater verification after publication. Actual board/compiler execution and the earlier WSL memory issue are not validated by this change.
