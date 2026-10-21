# Assignment callback registrations

A literal function value on the right of `=` is a registration even without a later invocation. Record `fn` and `&fn` (including casts), simple pointer initializers, and named aggregate field initializers. A call expression such as `factory()` is not a literal function registration. Respect symbol shadowing, static linkage, inactive code and unevaluated expressions.

Extend the existing explicit pass rather than enable full propagation unconditionally. Store registration references separately from call references, preserving their source location and owner. Project them into Callers/Callees regardless of full analysis and argument settings. Label them Registration, distinguishing them from registered call-site candidates. Global initializers belong to the initialized variable; assignments and local initializers belong to their enclosing function. Runtime branches retain written registration facts without proving an invocation or subsequent pointer value.

Expand the straight-line explicit pass to local function-pointer storage and local aggregate fields. Unknown writes, escapes and control flow invalidate subsequent call-site candidates; historical registration facts remain. Existing conservative alias limits remain.

Validation: failing regressions for no-call registration projection and analysis-OFF pointer/member calls; negative controls for calls on the RHS, non-function values, shadows, inactive/unevaluated code; full suite, cache/Worker tests, type check and build. No packaging, installation or publication requested.
