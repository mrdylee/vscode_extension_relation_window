# Changelog

## 0.1.70 — 2026-10-22

- Remove the project-wide 10-second callback cutoff. Show the current function's
  elapsed time, reset it at each function visit, and highlight visits taking at
  least five seconds without interrupting them automatically.
- Add Stop Local Analysis and Resume Local Analysis commands, plus Stop/Retry
  controls in the footer. Shared cancellation reaches the busy Worker during
  callback and macro analysis; retain found targets as incomplete after stopping.
- Retry cancelled/transient analysis instead of reusing partial project caches.
  Migrate old fixed-deadline disk caches by reusing parsed sources and recomputing
  relationships. Keep existing memory, work and convergence protections.
- Observe Stop during final registration-candidate collection too, retaining
  collected facts without caching partial output. Report cancellation instead of
  the removed time-budget reason, including stops at the propagation boundary.

## 0.1.69 — 2026-10-22

- Separate address-selection dependencies from pointed-to data so dynamic or
  unexpanded-macro offsets do not turn ordinary numeric packing into callback
  mutation/region limits. Relevant callback selectors remain tracked.
- Compose element addresses consistently through direct writes, return values,
  wrapper arguments and mutation regions. Preserve real multidimensional arrays
  and zero indexing of addressed scalar objects. Merge overlapping wildcard
  aliases conservatively and retain possible targets when reading them.
- Recover valid GNU attribute groups in declaration positions unsupported by the
  C grammar while preserving source offsets and conditional/macro information.
  Malformed attributes and unrelated syntax errors remain visible.
- Advance analysis compatibility to version 3 for corrected parsed and inferred
  results. Existing version-2 indexes require one Rebuild after upgrading.

## 0.1.68 — 2026-10-22

- Collect standard integer typedef declarators, recognize unindexed standard
  scalar names and preserve normalized element/dereference types and selector
  dependencies. Unrelated integer fields and byte arrays no longer consume
  callback mutation/region budgets; relevant selectors remain tracked.
- Model external memcpy, memmove and memset as destination-only byte writes,
  including through helper summaries. Preserve source and pointee callbacks,
  zero-length operations and destination return aliases. Keep unknown destination
  callback bytes uncertain and honor indexed user definitions.
- Keep sizeof/alignof results unknown without evaluating their operands instead
  of inventing a zero-byte count. Track function cache dependencies by affected
  object/array shape and matching invalidation regions, not total global growth.
- Advance analysis compatibility to version 2 so old inferred/parsed results are
  rebuilt instead of restored under the corrected semantics.

## 0.1.67 — 2026-10-22

- Honor Stop and disabling Copilot while Include setup or model selection is
  pending, preventing delayed commands from starting paid requests.
- Preserve explicit Copilot Include arrays, including empty arrays, when general
  Include and AI scope are edited in the same JSON save.
- Replace partial local callback entries when AI confirms the same target, while
  retaining local evidence and avoiding duplicate caller/callee counts.
- Copy general Include paths into the editable Copilot Include array. Preserve
  user removals, add newly included paths and support per-folder settings. Empty
  AI Include disables requests. Scope changes cancel active runs, retain excluded
  cache and restore eligible results without starting new paid requests.
- Add Combined alignments that keep the left sidebar, right sidebar or both
  sidebars full height. Use the remaining bottom area and preserve the existing
  full-width and Separate options.
- Separate analysis-cache compatibility from extension release versions. Reuse
  compatible indexes across updates; distinguish analysis-version, settings and
  legacy-format mismatches from damaged files in status and Diagnostics. Existing
  unversioned caches need one manual Rebuild when adopting the new manifest.
- Replace an indirect/unresolved Callees entry with available AI candidates at
  the same invocation. Preserve original callsite/evidence navigation, local
  inferred/direct edges and unhinted calls; restore entries when AI is cleared.

## 0.1.66 — 2026-10-22

- Ship the automatic Copilot run/Stop and AI candidate definition-navigation
  changes below for Windows, macOS and WSL.
- Wait for completion in asynchronous service tests instead of a fixed 1.1s
  delay. Windows CI caught that premature assertion and prevented 0.1.65 publication.

## 0.1.65 — 2026-10-22 (not published)

- Restore Windows, macOS and WSL download filenames and the Windows/macOS/Ubuntu
  CI matrix. Platform downloads contain the same universal JavaScript/WASM VSIX.

- Make AI candidate function nodes preview their definitions in Context, open
  the definition with double-click/Enter, and expand the candidate's callees.
  Preserve AI uncertainty labels and separate callsite/evidence navigation.
- Process all pending callback sites from one Analyze command, automatically
  continuing in batches of five with cumulative progress and cache reuse.
- Add Stop analysis in the footer and Command Palette. Cancel the current request,
  keep completed results, and require Analyze to resume a stopped job. Active jobs
  wait for saved sources and local indexing; request errors stop continuation.
- Retain cache-only startup/navigation and the five-request limit for background
  saved-file analysis when no explicit automatic job is active.

## 0.1.64 — 2026-10-22

- Prefer locally derived callback registration/flow candidates and their source
  evidence when constructing Copilot requests. Limit this review context to
  eight candidates, ten snippets and 8,000 source characters; retain the broader
  source search when no usable local candidates are available.
- Keep local shortlists explicitly incomplete and invalidate prior AI prompt
  caches without making new requests during startup or ordinary navigation.

## 0.1.63 — 2026-10-22

- Arrange index status, Copilot progress and Analysis notices from left to right
  in one footer row. Truncate long status text instead of wrapping.
- Open Analysis notices above the footer without increasing its height. Keep
  Diagnostics and Copilot analysis actions available.

## 0.1.62 — 2026-10-21

- Show the overflow operation, first omitted storage location and a bounded
  retained-location sample in local callback limit notices.
- Add cumulative per-function propagation evaluations, actual runs, cache hits
  and elapsed time to identify repeated analysis on offline workspaces.
- Keep names and storage samples out of Report issue. This diagnostic release
  retains existing limits and does not resolve Partial index by itself.

## 0.1.61 — 2026-10-21

- Explain indirect calls that were not evaluated before callback analysis stopped.
  Keep the original project limit visible in Callback analysis.
- After time/work exhaustion, recover short getter/argument/global-registration
  paths as incomplete Registered candidates using a bounded projection. Preserve
  unresolved calls, warnings and uncertainty; skip recovery under memory pressure.
  Existing full-analysis budgets remain unchanged.

## 0.1.60 — 2026-10-21

- Keep logged scalar status fields out of callback mutation summaries unless
  they feed callback selectors, conditions or storage connections. Follow copies,
  aliases, helper parameters and returns; retain unresolved layouts conservatively.
- Separate unrelated aggregate fields while preserving compatible cross-file
  dependencies. Skip opaque scalar regions proven unrelated to callbacks.
- Apply limited helper uncertainty to omitted storage effects, preserving unused
  pointer arguments. Keep actual callback mutations and existing 256-entry budgets.

## 0.1.59 — 2026-10-21

- Keep unrelated callback calls complete when the ordered region summary reaches
  its 256-object limit. Preserve the warning and track omitted storage effects
  as bounded uncertainty through helpers, including no-argument global writes.
- Retain project-wide uncertainty when reachable-object traversal or omitted-effect
  tracking cannot safely describe the affected scope. Existing budgets remain.

## 0.1.58 — 2026-10-21

- Ship the 0.1.57 changes below. Update the extension-host regression to expect
  the new registration relationship; the 0.1.57 CI gate prevented publication.
- Explain Copilot wait reasons and preserve explicit Analyze/Reanalyze requests
  until saved sources and the index are ready. Keep startup cache-only.

## 0.1.57 — 2026-10-21

- Show literal function assignments and named field initializers as Registration
  relationships in Callers/Callees even when no invocation exists. Keep source
  locations and distinguish registrations from actual calls and call candidates.
- Resolve simple function-pointer and local structure-member assignments with
  full callback analysis disabled, including direct writes through a structure
  pointer parameter. Preserve invalidation after unknown writes and escapes.
- Include registration relationships in persistent analysis snapshots and
  invalidate older snapshots so the updated relationships are rebuilt.

## 0.1.56 — 2026-10-21

- Ship the callback and Copilot fixes below. Correct the new progress test to
  use dependency WASM files without requiring a previous local build. The
  v0.1.55 CI gate caught this test setup issue; no v0.1.55 release was published.

## 0.1.55 — 2026-10-21

- Preserve simple explicit callback registrations and exact local pointer aliases
  as Registered candidates when full static propagation is disabled or incomplete.
  Keep evidence and unresolved calls; do not raise the existing analysis limits.
- Include typed plain function-pointer calls in Copilot analysis and allow known
  registered/AI candidates to be selected with static callback analysis off.
- Show Copilot processed/total, remaining, failures and bounded-context outcomes
  separately from Index ready, with an Analyze next 5 action.
- Let model changes cancel a provider that ignores cancellation. Enforce the
  existing 60-second deadline across discovery, token counting, requests and
  streaming; discard late results without affecting the new model.
- Replace repeated reference scans when restoring cached candidates with per-file
  lookups. Model selection alone and normal Rebuild still make no new AI requests.

## 0.1.53 — 2026-10-21

- Exclude proven unread scalar fields from callback mutation summaries. Retain
  selectors, address uses, compatible cross-file fields and unresolved storage.
- Represent opaque-call changes as bounded object regions, including pointer
  aliases and helper parameters. Preserve conditional candidates, later exact
  overwrites and callback values copied before a change.
- Keep unrelated mutation limits from marking every callback incomplete.
  Preserve uncertainty for omitted effects and project-wide analysis limits.
- Index uncertainty by storage object to avoid scanning unrelated regions.
  Existing time, memory and explicit-mutation limits remain unchanged; complex
  analyses may still return partial results.

## 0.1.52 — 2026-10-20

- Attribute callback limits to the actual observed file, line and function, with
  analysis stage, elapsed time and evaluation counts. Show limits before syntax
  notices and keep at most 64 detailed records per inference run.
- Identify time/memory limits as project budgets; an observation location does
  not imply that one function consumed the entire budget. Report issue includes
  only the diagnostic categories and numeric counters, without source identifiers.
- Stop building unused function mutation summaries for global initializers.
  Large static tables no longer falsely trigger the 256-slot function limit.
  Preserve heap writes, callback candidates and all existing safety limits.

## 0.1.51 — 2026-10-20

- Add **Analyze Callbacks**, enabled by default and independent of **Include
  Function Arguments**. Turning it off skips callback propagation and uses
  ordinary symbol navigation while retaining direct calls and literal arguments.
- Recalculate relationships on option changes without reparsing sources; discard
  in-flight results from an obsolete setting and record the option in reports.
- Preserve the full source range of non-macro callback calls inside functions
  that also contain macros, so selecting the member opens callback candidates.

## 0.1.50 — 2026-10-20

- Preserve explicit callback member initializers and pointer/return layers when
  only a forward structure declaration is indexed. Follow the object through
  getters, registration arguments and stored pointers without matching unrelated
  objects by member name or guessing positional field order.
- Show recorded callback failure reasons in an expandable **Callback analysis**
  section, open automatically when no target is resolved.
- Report macro/callback analysis limits as **Partial index** instead of
  **Index ready**. Keep existing memory and inference limits.

## 0.1.49 — 2026-10-20

- Select `cb()` or a callback member such as `ops->callback()` to inspect indexed
  possible targets, then choose a function to explore its Relation graph.
- Label all results as static candidates, preserve unknown/partial results, and
  preview the original call in Context. No additional inference pass is started.
- Preserve object/index variable navigation and reject stale candidate choices
  after index changes. Pin pauses callback selection tracking as well.

## 0.1.48 — 2026-10-20

- Pin the node last selected in Relation instead of always pinning the current root.
- Add **Pin this symbol** to resolved nodes' context menus so the pin can be replaced
  while following is paused. The pushpin and **Go to pinned symbol** follow the new root.

## 0.1.47 — 2026-10-20

- Report partial indexing when source files fail to read or analyze, instead of
  incorrectly reporting Index ready. Successful retries clear the failure.
- Record per-rebuild search results, selected files and final indexed/failed/
  unaccounted counts in Diagnostics, saved history and issue reports.
- Keep interrupted discovery and superseded runs distinguishable. This does not
  establish the cause of the reported 1,820-to-297 file-count change or host restart.

## 0.1.46 — 2026-10-20

- Enhance Report issue with bounded persistent diagnostic history across host restarts,
  recent navigation action types and best-effort lifecycle/OOM host-log excerpts.
- Add Save report for a reviewed Markdown file; preserve copy/manual GitHub flow.
- Bound disk/queue/read sizes, report missing evidence and redact known paths/URLs.
  No automatic upload, no complete anonymization or freeze fix claimed.

## 0.1.45 — 2026-10-20

- Show the latest full-index trigger and extension-session start in Diagnostics,
  including settings/folder changes, startup and manual rebuild actions.
- Keep the last five rebuilds with outcomes/durations and session counters for
  source parses and relation passes. Include sanitized history in problem reports.
- Preserve expanded diagnostic history during live updates. This adds evidence
  for unexpected reindexing; no confirmed restart or macro-search fix is claimed.

## 0.1.44 — 2026-10-19

- Complete the Dynsight rename in Settings, extension identity, publisher and VSIX
  downloads: `dylee.dynsight`, publisher `dylee`, settings/commands `dynsight.*`.
- Migrate explicit legacy settings at user/workspace/folder scopes while keeping
  existing new values. Preserve old custom keybinding commands as hidden aliases.
- Pause new activation while the previous extension is active; offer removal and
  reload to avoid duplicate analysis. Panel placement may need to be restored.
- Keep one legacy-named universal download for older update clients.

## 0.1.43 — 2026-10-19

- Rename the visible product to **Dynsight — C Code Explorer**. Use **Dynsight**
  in panels, commands, diagnostics, update prompts and issue reports.
- Update README, offline Help and future release titles. Preserve the extension
  identity, setting/command/view IDs, repository and VSIX naming for compatibility.

## 0.1.42 — 2026-10-19

- Reuse existing source and callback results when unchanged documents close or
  duplicate file-change notifications arrive. Avoid repeated project analysis
  during navigation and VS Code document-cache eviction.
- Preserve real edits, discarded unsaved edits and external disk changes. Restore
  Worker input correctly when a pending edit is superseded by the original text.
- Keep the existing memory guard. This prevents redundant analysis; it does not
  guarantee that every project's initial callback analysis fits the memory budget.

## 0.1.41 — 2026-10-19

- Discard obsolete disk reads before sending source to the analysis Worker.
  Preserve newer buffered edits and callback results across edit, delete and
  rebuild races. Report persistent analysis-version mismatches as a partial index.
- Apply the 10,000-file limit to watched additions and pending reads, while
  allowing existing files to update and freeing slots on deletion/read failure.
- Exclude unevaluated `sizeof` calls from Callers and Callers & Callees, matching
  the existing Callees behavior. Keep those uses in References.

## 0.1.40 — 2026-10-18

- Add Diagnostics → Report issue and a Command Palette entry. Prepare a local,
  editable report with versions, view/scope counts, categorized notices and the
  latest memory samples, even when the Worker has stopped.
- Omit source, symbol names, paths, raw errors and scope patterns. Users review
  and copy the draft before opening GitHub, then paste and submit it themselves.
  No automatic uploads or background logging. Include offline Help and triage docs.

## 0.1.39 — 2026-10-18

- Release macro and callback caches when rebuilding the index. Keep only the
  current project's callback cache per analyzer, and discard obsolete macro
  entries when a source no longer contains function bodies or initializers.
- Reduce callback-analysis allocation by sharing immutable empty/unchanged
  values and avoiding repeated local-variable array copies. Preserve call sites,
  inference evidence, candidate limits and the existing 60% memory guard.

## 0.1.38 — 2026-10-18

- Add photographable Diagnostics in the Relation footer: measured Worker heap
  usage/limit and 60% guard, sampled peak, external memory, phase checkpoints,
  input counts and the first budget hit. Show environment and shared extension-host
  heap separately. Open once on memory incidents and preserve timestamped last
  samples on Worker failure. Keep updates bounded without rebuilding the graph.
- Include screenshot instructions in the offline Help and README. Analysis
  behavior and memory limits are unchanged.

## 0.1.37 — 2026-10-18

- Prevent quadratic memory growth when Callees has many same-name target
  candidates. Share resolver candidate lists within each call and omit this
  internal metadata from displayed graph sites. Keep every displayed call site,
  ambiguity markers and navigation; preserve complete resolver results.

## 0.1.36 — 2026-10-18

- Add a compact ↩ Pin button beside Pinned · Follow paused. Reveal the pinned
  root in Relation and return the editor and Context to its source without
  changing the pin, expanded branches or traversal settings.
- Add Macro Expansion Folders with a native checkbox picker in Settings and the
  Command Palette. Expand selected source folders while retaining basic analysis
  of unchecked sources and their header macro definitions for checked sources.
  Default to all; support all-off, custom globs and per-folder workspace settings.
  Automatically rebuild on changes without widening Include/Exclude scope.

## 0.1.35 — 2026-10-18

- Add Combined · Full width to Context Layout settings. Place Context and Relation
  across the bottom beneath both sidebars; restore Center alignment when leaving
  this mode. Explain the shared width with Terminal and other Panel views.
- Mark the pinned Relation root with a compact pushpin and identify its symbol
  in the existing toolbar tooltip. Unpin removes the marker without rebuilding
  the graph or changing branch expansion and navigation behavior.

## 0.1.34 — 2026-10-18

- Reserve Worker heap headroom during macro expansion and callback propagation;
  report partial results instead of letting optional analysis exhaust the heap.
- Retain literal function-argument candidates and original Context locations when
  preprocessing stops at a memory or repeated-include limit.
- Preserve fatal Worker errors instead of displaying Index ready. Rebuild after
  memory pressure or Worker termination starts a fresh analysis Worker.
- Reject additional source parses already under memory pressure with visible
  per-file notices. Keep Include/Exclude scope and heap limits user-independent.

## 0.1.33 — 2026-10-18

- Bound repeated macro include traversal even when headers emit no define/undef
  events, preventing exponential work from blocking following Worker requests.
- Stop incomplete include environments with an explicit Analysis notice. Retain
  source calls as partial candidates instead of expanding from a truncated prefix.
- Keep result identity caching and recover after header edits; verify queued
  source analysis and native Relation updates continue after a limited include graph.

## 0.1.32 — 2026-10-18

- Bind member selections through explicit casts and declared function/callback
  return types, using lexical typedef scope and preserving pointer/array layers.
- Promote actual anonymous struct/union fields while keeping named nested fields
  and unrelated same-named members separate.
- Link designated initializer fields to their receiving types and original
  locations. Terminal field designators are writes; intermediate paths remain
  selectable without claiming writes to whole parent fields.
- Preserve function/global initializer ownership, R/W filters, conditional
  candidates, header invalidation and original Context/editor navigation.
- Report unsupported member expressions/initializer paths in Analysis notices.
  Keep runtime pointer inference, build-free operation and graph limits unchanged.

## 0.1.31 — 2026-10-18

- Add default-off Include Function Arguments in Settings. Show explicitly passed
  functions in existing Callers, Callees and bidirectional graphs with a dotted
  connector and receiver/argument-position details.
- Preserve existing compact icons, ordinary References and variable filters.
  Mixed call/argument groups retain solid connectors and separate source sites.
- Preview and open original argument locations, with normal function expansion.
  Keep argument passing separate from proof of callback execution.
- Reuse parsed direct arguments and existing pointer values, cache identities
  and Worker updates; toggling the option does not rebuild the index.
- Document the option, connector legend and limits in bundled offline Help.

## 0.1.30 — 2026-10-18

- Add Call Graph Direction in Settings: Callers left / Callees right (default)
  or Callees left / Callers right. Preserve branch expansion, selection and sorting;
  change presentation without reindexing or rebuilding graph data.
- Left-align the whole dual graph instead of centering the selected function.
  Remove viewport-width padding and root anchoring so left branches remain visible.
- Open all extension preferences from Settings, including sorting, Context layout,
  direction and analysis scope. Keep Settings and Reset in the context menu.
- Reveal Separate Context when its preference changes through native Settings.
- Update offline Help and cover both orientations, deeper branch geometry,
  left alignment, single-direction stability and native configuration changes.

## 0.1.29 — 2026-10-18

- Add Callers & Callees to the existing mode selector, with one center root,
  independent left/right branches and a shared 300-node limit.
- Add a keyboard-accessible Relation context menu for Callees name/source sorting,
  Combined/Separate Context layout and resetting graph position. Preserve defaults
  and save sorting/layout choices in workspace settings.
- Pan by dragging the graph background without index queries or source navigation.
- Provide a movable Explorer Context view sharing the existing index, preview,
  syntax colors and validated code navigation. Keep Combined as the default.
- Cover original macro/callback call positions, directional expansion, shared node
  limits, mouse/keyboard interaction and native split-view registration in tests.

## 0.1.28 — 2026-10-18

- Expand supported object/function macros, nested arguments, stringizing, token
  pasting and variadics through ordered indexed define/include/undef events.
  Keep original call positions and show expansion provenance in the popup.
- Infer static function-pointer/callback candidates from assignments, forwarding,
  registration, returns, static storage and typed struct/array tables. Retain
  unknown targets, instance separation and candidate/evidence labels.
- Follow inferred targets in existing Callees/Callers/References graphs and
  preview/open evidence without adding another window or enlarging nodes.
- Keep flow facts in the Worker; cache equivalent macro syntax, type/name
  lookups, object/array slots and current function summaries. Bound propagation,
  mutation slots and additional callback analysis time; surface partial results.
- Fix conditional declarations/returns, value-copy semantics, transitive static
  tables, source binding and macro-variant deduplication found in separate
  per-feature review-work passes. Add 59 macro/callback regressions.
- Update offline Help and README with examples, uncertainty and scope guidance.
  Preserve main at v0.1.24; add reviewed feature checkpoint tags for rollback.

## 0.1.27 — 2026-10-17

- Resolve a locally introduced struct/union tag when its definition follows the pointer declaration in the same block. Preserve already visible outer types and reject unrelated enclosing-block completions.
- Retain outer variable and function candidates when a conditional local declaration may be absent, including nested scopes and block extern declarations.
- Add member and ordinary-name regressions plus VS Code integration checks for both review findings. Require review-work, fixes and revalidation before publication.

## 0.1.26 — 2026-10-17

- Bind named struct/union member uses through declared receiver types, separating same-named fields and ordinary variables.
- Support typedef/pointer aliases, nested named fields, arrays/dereference, unions/bit fields, lexical type scopes and forward-completed tags across indexed headers.
- Reuse variable access filters, exact Context locations and caller traversal. Show compact qualified names and a member-owner popup label with the existing icons.
- Preserve uncertain header/conditional candidates and avoid name-only fallback for unsupported expressions. Runtime pointer targets, casts, function-return receivers, anonymous-member promotion and designated-initializer references remain unsupported.
- Document member navigation and analysis limits in the bundled Help. Preserve v0.1.25 for rollback; main remains at v0.1.24.

## 0.1.25 — 2026-10-17

- Add Callees to the existing Relation selector, with outgoing depth expansion, recursion limits and exact repeated call sites.
- Preserve macro invocations, unresolved names and indirect call expressions as explicitly described leaves without guessing their runtime targets.
- Keep variable access filters and incoming traversal independent of the remembered function mode.
- Maintain per-function outgoing buckets during incremental file updates; querying a function does not rescan the workspace.
- This increment does not implement macro expansion, member type binding or pointer-target inference. Released from the feature branch; main remains at v0.1.24 for rollback.

## 0.1.24 — 2026-10-17

- Restore the compact rounded `ƒ` function icon: outline for declarations, fill for definitions, with independently visible dashed conditional/candidate/recursive borders.
- Add the complete symbol and variable-use badge legend, with a bundled offline image, to Help.

## 0.1.23 — 2026-10-17

- Show Relation details after the pointer remains still for 500 ms instead of one second. Movement restarts the delay and leaving the node cancels it.

## 0.1.22 — 2026-10-17

- Failed update requests no longer consume the 24-hour successful-check interval.
- Poll hourly to retry failures and check when due after window restarts; successful automatic checks remain daily and manual checks bypass the interval.
- Explain automatic notification timing and manual checks in the bundled guide.

## 0.1.21 — 2026-10-17

- Distinguish function declarations with an outlined document icon and definitions with a filled cube, preserving the 16×16 footprint.
- Name the function form in details and accessible labels; keep conditional/candidate/recursive outlines separate.

## 0.1.20 — 2026-10-17

- Add Settings and Help buttons to the C Relations toolbar and matching Command Palette commands.
- Settings opens Include/Exclude in workspace settings, falling back to user settings without an open folder.
- Bundle an offline English user guide covering navigation, scope examples, inactive branches, troubleshooting and WSL updates; open it in VS Code Markdown preview without changing the Relation root.

## 0.1.19 — 2026-10-17

- Search each Include pattern independently so brace alternatives and literal commas retain their meaning when multiple patterns are configured. Deduplicate files before applying the initial file cap.
- Add regressions for mixed brace patterns, comma-containing folder names, and consistent file-watcher/rebuild results.
- Publish the menu stability, click expansion and Include/Exclude features prepared in 0.1.17–0.1.18.

## 0.1.18 — 2026-10-17

- Add folder-scoped `cRelation.include` patterns. Empty includes all C/H files; Exclude always takes precedence. Apply both settings before the initial file cap and to runtime file events and unsaved edits.
- Preserve the original double-click source target when single-click expansion moves Relation nodes.
- Document Include/Exclude combinations, Settings UI, JSON examples and WSL paths.

## 0.1.17 — 2026-10-17

- Keep depth and relation-mode selectors mounted during background updates so open menus remain usable. Preserve unchanged definition choices.
- Clicking a Relation symbol previews it and expands callers/references from that node using the selected depth, preserving the root and existing deeper branches.
- Add browser menu-interaction and Extension Host click-expansion regressions.

## 0.1.16 — 2026-10-17

- Include the large-workspace improvements prepared in 0.1.15, which was not published because Windows integration validation failed.
- Normalize workspace-relative paths and match Windows exclusion patterns without case sensitivity so excluded files remain excluded when edited.

## 0.1.15 — 2026-10-17

- Replace full-project index rebuilding with file-level updates; remove repeated reference-array copies.
- Cache shared definition candidates and look up file-local symbols directly, avoiding repeated scans of declarations for every call site.
- Add `cRelation.exclude` workspace-relative glob patterns, applied before the initial file limit and to file watching and unsaved edits. Changing exclusions rebuilds the index automatically.
- Add incremental-equivalence tests, exclusion integration tests, and large-workspace performance checks to release validation.

## 0.1.14 — 2026-10-17

- Translate interface labels, tooltips, accessibility labels, dialogs, and update messages into English.
- Clarify the inactive-branch filter: literal #if/#elif 0 or 1 conditions are evaluated; macro conditions remain visible. Analyzer behavior is unchanged.

## 0.1.13 — 2026-10-17

- 고정 버튼에 다음 동작 대신 현재 상태인 `자동 추적 중` / `고정됨 · 추적 중지`를 표시해 의미가 반대로 읽히던 혼동 해소.
- 버튼에 마우스를 올리면 클릭 시 수행할 동작을 설명. 고정 및 Context 탐색 동작 자체는 변경하지 않음.

## 0.1.12 — 2026-10-17

- Context 코드 클릭으로 메인 편집기를 해당 줄·토큰으로 이동하고, 고정 해제 상태에서는 Relation도 클릭한 함수·변수로 전환.
- 고정 중에는 관계를 유지하고 메인 소스만 이동. 드래그 선택은 복사용으로 유지.
- 현재 미리보기 범위·내용과 실제 문서를 확인해 잘못되거나 오래된 클릭 위치는 무시.

## 0.1.11 — 2026-10-17

- 고정 해제 상태에서 더블클릭으로 선택한 심볼을 놓치는 문제 수정.
- 분석 중 선택한 심볼을 분석 완료 후 다시 추적하고, 고정 해제 시 마지막 코드 창 선택을 반영.
- 동일 심볼 내 커서 이동 시 관계 트리 재계산·재전송을 생략해 WSL 전송 부담 감소.

## 0.1.10

- Windows/macOS/WSL 다운로드와 GitHub Releases 자동 게시 추가.
- Windows/macOS/Ubuntu의 Extension Host 검증 추가 및 재분석 중 공유 상태가 바뀌던 테스트 수정.


## 0.1.9 — 2026-10-17

- 지정 GitHub 저장소의 정식 Releases를 하루에 한 번 자동 확인하고, 변경 내역과 버전을 보여준 뒤 설치 여부 확인.
- 수동 업데이트 검사 명령과 자동 검사 설정 추가. 사용자 동의 전 다운로드/설치하지 않으며 창 다시 로드도 별도로 선택.
- 버전·릴리스 설치 파일·파일 크기·제공된 체크섬 검증과 네트워크 실패 처리.
- 저장소 정보와 향후 VSIX 릴리스 배포 절차 문서화.

## 0.1.8 — 2026-10-17

- 중첩 블록의 extern 선언이 바깥 매개변수를 가리고 실제 외부 정의로 연결되도록 수정. 정의가 없는 경우 선언으로 연결하며 블록 밖의 지역 변수 탐색은 유지.
- 조건부 변수 초기화의 W 위치를 해당 정의에 직접 연결해 반대 분기의 초기화가 섞이는 문제 수정.
- 변수·함수 extern 이름 가림과 조건부 초기화에 대한 회귀 테스트 추가.

## 0.1.7 — 2026-10-17

- 기존 Relation 창에 변수 읽기(R), 쓰기(W), 읽기/쓰기(RW), 주소 전달(&) 필터와 색상 표시 추가.
- 변수 사용 함수 선택 시 실제 사용 줄을 Context에 표시하고, 팝업에서 반복 사용 위치를 각각 선택.
- 명시적 초기화, 대입, 복합 대입, 증감, 주소 사용 판별. 읽기/쓰기 필터에 RW 포함.
- extern 변수 선언을 정의에 연결하고, 변수 사용 함수에서 상위 호출 트리 확장 유지.
- 함수 탐색, 1초 정지 팝업, 기존 Context 색상 유지.

## 0.1.6 — 2026-10-17

- 노드 위에서 마우스가 1초 동안 멈춘 뒤 상세 팝업 표시. 움직이면 대기 시간을 다시 계산하고, 벗어나거나 창을 떠나면 취소.
- 마우스 클릭으로 포커스가 생겨도 대기 시간을 건너뛰지 않도록 수정. 키보드 상세 보기 유지.
- 팝업 심볼 이름, 줄 번호, 호출/참조/선언 구분, 조건식과 경고에 색상 강조 적용.

## 0.1.5 — 2026-10-17

- 대량 파일을 편집기 문서로 열면서 발생하던 문서 닫힘/재분석 반복으로 인한 인덱싱 정지 수정.
- 닫힌 파일은 디스크에서 읽고, 열린 파일은 미저장 편집 내용을 사용.
- `PRIVILEGED_FUNCTION` 같은 후행 매크로가 붙은 함수 원형을 선택하면 정의와 참조 관계로 연결.
- 93개 파일 회귀 테스트와 전체 FreeRTOS 분석/queue.c 함수 선택 검증 추가.

## 0.1.4 — 2026-10-17

- 왼쪽 상단 확장 이름과 Context 제목에 실행 버전 표시. 패키지 버전에서 자동 생성.

## 0.1.3 — 2026-10-17

- 여러 정의 후보를 파일 경로가 표시되는 한 줄 선택창으로 변경해 그래프 공간 확보.
- 새 심볼의 정의가 여러 개일 때 이전 그래프와 Context가 남는 오류 수정.
- 그래프를 위쪽에 배치하고 심볼 변경 시 스크롤 위치 초기화, 도구 모음과 제목 여백 축소.
- 다수 후보 UI와 후보 선택 전후 상태 회귀 검증 추가.

## 0.1.2 — 2026-10-17

- Relation을 아이콘과 심볼 이름만 있는 한 줄 노드로 축소.
- 호출 위치·조건·후보·확장 버튼을 마우스/키보드로 열 수 있는 상세 팝업으로 이동.
- Context의 함수·타입·변수·숫자·매크로·전처리·문자열·주석 색상 구분 강화.
- 긴 블록 주석 중간에서 시작하는 미리보기와 들여쓴 전처리 지시자의 색상 유지.
- 밝은/어두운 테마, 팝업 선택/키보드 접근, 한 줄 높이 회귀 검증 추가.

## 0.1.1 — 2026-10-17

- 지역 변수 초기화 중 직접 호출을 해당 함수에 연결해 상위 콜트리 누락 수정.
- 함수 원형 및 중첩 콜백 매개변수의 이름이 선언 범위 밖의 함수를 가리는 문제 수정.
- `for` 초기화 변수의 이름 가림이 반복문 종료 후에도 남는 문제 수정.
- 미확정 조건부 `static` 정의가 외부 함수 후보를 제거하는 문제 수정.
- 위 사례와 확정 조건의 기존 동작을 검증하는 테스트 추가.

## 0.1.0 — 2026-10-17

- 빌드 없이 C 소스 폴더를 분석하는 최초 로컬 버전.
- 편집기 선택을 따르는 References/Callers 그래프와 독립 Context 미리보기.
- 실제 참조 위치, 종류 아이콘, 단계별 확장, 루트 고정, 키보드 탐색.
- 알려진 비활성 전처리 분기 제외와 미확정 조건 표시.
- Worker 분석, 미저장 편집 및 파일 변경 반영, VSIX 패키징.
