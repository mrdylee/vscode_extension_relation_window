# Defer project relations while typing

The approved [one-hour idle update design](2026-11-04-idle-relation-updates-design.md)
supersedes the immediate-on-save timing below; live navigation and incremental
reuse from this design remain applicable.

The reported symptom is automatic analysis activity in the bottom status area
when typing inside a function without saving. This is separate from a cache
compatibility prompt or the explicit Rebuild index command.

The current 100 ms editor debounce reparses one changed file and then invokes
the project relation pipeline. Common headers and token-pasting macros can make
its conservative dependency component include the whole project.

Keep the existing per-file parser updates for live symbols and direct references.
Defer project macro/callback derivation while any eligible C/H document is dirty.
Show a static save-to-update status rather than restarting project progress.
Saving the final dirty document, discarding changes, or closing it resumes the
existing incremental relation pipeline. Unchanged save events must still resume
pending relations even when their source text needs no additional parse.

Longer debounce alone still runs expensive analysis after a single character;
ignoring edits entirely leaves live symbols and locations stale. Deferring only
project relations preserves useful live navigation without repeated deep passes.

Cancel active relation work when a dirty edit arrives and reject its later result.
Pending detail stays visible in diagnostics, never appears current, and cannot
replace the saved cache. Startup compatibility, explicit rebuild protection,
Smart Analysis scopes and analysis cache version 19 remain unchanged.

Verification uses real Workers, temporary caches and isolated native VS Code
profiles. It covers repeated typing, save without reparsing, multiple dirty
documents, discarded changes and an edit arriving during a relation pass.

## Saved changes

Saving must update only changed files and affected dependents. Treat included
declarations and macro definitions as reusable context, rather than joining all
consumers of an unchanged common header. Value flow through functions, global
storage and callback registrations still connects participating files. Keep
static names private to their translation unit. Token-pasting definitions must
not connect unrelated files merely because they exist.

Reuse the existing per-file macro expansion cache before constructing runtime
dependency groups, so generated call names participate in dependency tracking.
Apply the same grouping to basic relations and callback derivation. Pass required
header context to an affected batch, but retain unrelated outputs and objects.
Header changes, additions, deletions and changed dependencies must invalidate all
affected groups. Unchanged limited groups are retained on unrelated edits; an
explicit retry with unchanged inputs still retries their analysis.

Validate the selected batches and result identity, and compare updated results
against a fresh full analysis for header, callback and token-pasting changes.

Preserve the contextual RelationIndex while its old view is hidden during an edit.
Worker file-version stamps identify which entries actually need updating after
the current result is accepted. Keep the complete Worker response so discarded
responses cannot lose later updates. Reuse unchanged build-cache records only
when both raw and derived identities match a saved or validated restored record.
