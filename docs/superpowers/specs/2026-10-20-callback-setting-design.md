# Separate callback analysis setting

Create and push `checkpoint/pre-callback-settings-20261020` before implementation (HEAD 3f34ac5).

Add window-scoped `dynsight.analyzeCallbacks`, default true. Settings must explain that it controls inferred function-pointer/structure callback targets and callback selection in all relation modes. `includeFunctionArguments` remains a separate display setting. Off keeps direct calls, macro expansion and literal function arguments; alias-derived arguments require analysis. Off must bypass propagation, not merely hide inferred edges.

Changing this setting recalculates derived relationships using existing source facts, invalidates in-flight results and clears obsolete callback selection. It does not reparse every source. Analysis already running finishes before the queued mode change; existing safety budgets stay unchanged. Inference caches must not reuse results across modes.

The reported WSL screenshot shows an unresolved member and partial analysis. A typedef member/getter/registration fixture will check navigation; no claim of reproducing the full private project without its limit diagnostics.

Validation: analyzer on/off/on and literal arguments; real Worker configuration changes including an in-flight result; native view selection and Settings; issue report records the setting. Self-review, package and existing release checks follow the user's standing review/publication request.

Investigation reproduced a separate source-location bug: macro reparse mapped ordinary callback calls to only the first receiver token. Preserve the full mapped callee range for non-expanded calls; macro-generated calls keep their invocation location. A failing regression test now verifies member selection and ordinary receiver navigation.
