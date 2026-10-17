# Variable Access Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for continuous inline implementation. No subagents requested.

**Goal:** Explore C variable reads, writes and address-taking in the existing Relation + Context view.

**Architecture:** Add optional syntactic access metadata and enclosing function ID to references. Variable roots filter access sites and group them by enclosing function; further function levels keep normal caller/reference behavior. The webview switches its existing selector for variable roots and previews the first matching use site on click.

**Tech Stack:** TypeScript, tree-sitter C WASM, VS Code webview, node:test, Playwright.

---

Approved scope: ordinary variables including parameters and globals, explicit initialization, direct assignment, compound assignment, increment/decrement and address-taking. No new pane. No pointer alias or structure-member mutation analysis. Function behavior and the one-second stationary hover remain intact.

Access values: `read`, `write`, `readwrite`, `address`. Filter `all` plus those values. Read includes RW; Write includes RW; RW only includes readwrite. `sizeof`/`_Alignof` operands are not counted as value reads. A dereferenced pointer on an assignment's left side is itself read, not written. `&x` means address-taking, never an inferred write. A declaration without initializer is not an explicit write. `extern` declarations must resolve to available definitions.

### 1. Analyzer and index
- [x] Add failing cases in `test/core.test.ts`: R/W/RW/& and parentheses; initialization versus declaration; locals and parameters; extern definition resolution; sizeof and indirect pointer writes; filters with preserved upper caller tree; inactive code.
- [x] Run `npm test`, verify new assertions fail.
- [x] In `src/model.ts` define `Access = 'read' | 'write' | 'readwrite' | 'address'` and `AccessFilter = 'all' | Access`; add optional `access` and `functionId` to references.
- [x] In `src/analyzer.ts`, classify direct identifier expressions by their parent assignment/update/address operator. Explicit variable initializers produce a write site owned by the enclosing function. Preserve existing initializer ownership for function-pointer tables. Mark extern-only variables as declarations.
- [x] In `src/relations.ts`, resolve extern declarations, filter variable sites, choose their enclosing function as owner, and add optional access filter arguments to relations/graph. Strip access metadata from non-variable target relations. Run `npm test` and `npm run typecheck`.

### 2. Existing window integration
- [x] Add `accessFilter: 'all'` to `ViewState` and validated `access` message in `src/view.ts`; pass the filter to graph generation.
- [x] In `webview/main.ts`, variable roots use All/R/W/RW/& selector. Nodes get compact colored access badges. Clicking a variable-use node previews its first matching site. Popup shows access label per site. Function descendants keep function navigation.
- [x] Add access colors to `webview/styles.css` using existing theme colors; preserve node height and hover timing.
- [x] Extend `test/create-ui-fixture.ts` and `test/ui.mjs` with a real analyzed variable fixture, selector changes, badges, site preview, popup selection, node height and colors.
- [x] Extend `test/extension.test.ts` with variable selection/filter/preview and invalid-message validation. Run `npm run test:ui` and `npm run test:extension`.

### 3. Validate and deliver
- [x] Add a real FreeRTOS variable assertion in `test/freertos.test.ts`; run `npm run test:freertos`.
- [x] Bump package and lock versions to 0.1.7, update README and CHANGELOG with access semantics and limitations, save measured verification in `docs/verification-0.1.7.md`.
- [x] Run `npm run package`, install the VSIX using VS Code CLI, reload the user window, confirm visible version and ready index.

No Git commit is planned: this folder has no Git repository. Existing install authorization covers updating the local extension.
