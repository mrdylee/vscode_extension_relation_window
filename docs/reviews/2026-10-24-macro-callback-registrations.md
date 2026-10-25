# Macro callback registrations — 2026-10-24

`SET_TASK_PARAM(p, name, handler)` expands to a literal function assignment such as `p.on_create = handler`. Previously the explicit registration collector only inspected unexpanded source, so this relationship was absent even when macro expansion succeeded.

The analyzer now passes its existing expanded files into the explicit registration collector. Only new expanded bodies are scanned for literal assignments; source-based local invocation inference is unchanged. No extra macro parse, AI request or whole-project pointer propagation is initiated. Results use the existing `registered` reference kind, distinct from actual call sites. Macro argument locations point to the original function-name token; functions named in a macro body point to the original macro-name token. Macro expansion must be enabled and successful for these facts to be available.

Tests first reproduced the missing relation with full callback propagation both off and on. Additional coverage checks zero callback work with propagation off, header changes and warm reuse, preservation of actual call sites, and 12 macro registrations across Worker cold/warm/disk-cache/save transitions. A preexisting macro binding test now checks calls separately from the newly visible registration instead of treating every relation as a call.

Validation:
- Full tests: 639 passed.
- Worker/cache tests: 89 passed, including build.
- Memory tests: 6 passed.
- Typecheck and diff whitespace checks: passed.
- Local synthetic task-parameter macros with no service body and propagation off: 1 registration in 6.75 ms; 32 registrations in 24.44 ms, callback work 0, no inferred calls or limit warnings. These single measurements exclude initial parser setup and are not firmware performance claims.

Cache semantic version is 12, invalidating prior derived results. No installation or release was performed. Existing broader propagation-performance issues are outside this registration fix.
