# Build-selected AI callback fallback repair

User reports0.1.79 onWSL with a selectedBuild: prior AI variable-to-function
relations disappear. The View chooses `indexFor(uri)` and falls back to the base
index; the Copilot service snapshots/projects only `workspace.index` (build-only).

Use systematic-debugging/TDD and inline execution. Preserve raw and contextual
indexes independently. Expose both callback indexes, snapshot both, and construct
separate bounded AI source searches for basic and contextual facts. Basic files
with a contextual counterpart support basic fallback search but do not create
duplicate AI call sites. Project each validated hint/manual override into its
matching index. Route manual actions by call-site identity. Never merge static
objects across translation units or discard existing AI cache entries blindly.

1. Reproduce empty/partial Build index loss in service and workspace tests; assert
   AI requests, offered targets and visible projected edges, not only total sites.
2. Implement index selection, bounded context collection and action routing.
3. Test no-build, empty/partial Build, context duplication/isolation, cache restore,
   Stop/recheck/manual and Build clearing. Run focused and full required gates.
4. Deliver a new immutable patch release using existing authorization after local
   package/native checks; verify allOS CI, public hashes and actual updater.

This is a local synthetic reproduction. The reported WSL workspace and live AI
response are not accessible here; report those boundaries explicitly.
