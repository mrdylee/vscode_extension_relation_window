# Review of the updated analysis report

The user requested reviewing `analysis.md` from main commit `8e7c3d0` and fixing
the validated problems while preserving the current release branch and unrelated
files. The updated report is copied onto this branch without replacing product
code from main.

The repeated conditional-macro reproduction currently yields 32 variants, 30
contradictory, instead of two. Keep the 32-alternative bound and carry explicit
branch identities through macro environments, undefined alternatives, argument
prescan and expansion. Conditional overwrites and undef retain the complementary
old environment. Identities refer to directive groups and include visits, not
macro names or display labels, so independent/redefined conditions are not
incorrectly equated. Equivalent expansion states may be deduplicated only when
token provenance and branch state agree.

Retain 100,000/1,000,000 work limits and 256-slot/object limits. Add phase-specific
work accounting and expose why cached function summaries are invalidated. Stop
re-executing a body once its cumulative function budget is exhausted, retain
previous observations as incomplete, and preserve independent functions.

Reproduce both split-statement patterns before selecting a narrow parser fix.
Recovery must retain original positions, unknown alternatives and literal
inactive exclusions. Malformed source keeps diagnostics. Shared-body syntax
that already parses still needs callback-relation tests.

Large summary compression, context splitting and build-profile configuration
remain proposals unless a synthetic correctness regression demonstrates a
specific safe fix. Do not drop callback-bearing objects or increase limits to
hide real partial results. Update analysis.md to distinguish reproduced facts,
implemented fixes and remaining proposals. No original firmware corpus or logs
are available; use synthetic fixtures and the existing public FreeRTOS corpus,
without uploading source or delegating.

SECOND Comment from `68caf23` makes conditional numeric constants and reparse
inflation explicit. Verify the 43-use defined/undefined case, warm-cache reuse,
and correlated numeric callback indices. Reducing impossible variants must be
reported separately from expression-level structural sharing, which is not
implemented here. Preserve the user measurements as supplied evidence, not a
local measurement of the unavailable project. Broad-corpus regressions and
Partial results must remain visible in the report.
