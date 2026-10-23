# Basic macro-definition binding

Third comment from origin/main 107287e is reproducible: one CHECK_FAULT1 reference resolves to two unrelated header definitions in raw and basic analysis. Expansion binds the included definition and removes the macro Callees leaf when the replacement is only a condition. Preserve this separate expansion display policy.

Use bounded directive metadata for basic binding; do not expand function bodies or generate flow programs. Reuse include ordering, define/undef and branch constraints. Keep uncertainty when a definition may be absent, an include is unavailable, or a scan is limited. Avoid expensive macro-body tokenization and irrelevant definition events in this path. Header edits and source scope changes must invalidate bindings.

A uniquely bound use links the active definition. A genuinely ambiguous set of macro definitions appears as one node with one entry for each actual use and a list of definition locations. Group by candidate identity, not name alone: different bindings at different uses remain distinct. Existing References queries for each definition must retain the real use. The popup opens each actual definition through the existing validated location registry. It creates no persistent manual override.

Publish basic bindings before detailed analysis, including while stopped or memory-limited. Macro and Copilot settings and their existing scopes are unchanged. Keep cache compatibility explicit.

Inline review: normal function/member resolution must remain available after #undef; a possibly undefined macro must not hide a same-name real function. No compiler/clangd, new setting or full preprocessor is introduced.

Verified implementation tradeoff: basic binding uses conservative unions for conditional definitions and summaries for ambiguous header searches. It does not reuse detailed-analysis boolean-world enumeration. This removed an observed >60-second basic regression; the 656-file native basic run completed in about 10.09 seconds, with about 1.97 seconds measured in binding alone. A repeated known include is reused only in the same context without tracked definition changes. Unknown includes and opaque directives retain uncertainty; a later unconditional definition can restore a unique binding. True macro/function alternatives keep their distinct kinds rather than being merged by name. Cache analysis version is 8.
