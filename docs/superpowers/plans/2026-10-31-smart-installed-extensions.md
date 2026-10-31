# Installed AI Extension Integration Plan

**Goal:** Use one installed AI extension for Smart Analysis with no separate CLI setup.

**Architecture:** Add a small installed-extension discovery module, retain the bounded subprocess transport for the selected bundled engine, and reuse the existing exclusive controller. Copilot remains on the Language Model API.

1. Write failing installed-engine path tests and service tests for all-three-installed single-provider execution, auto selection, saved choice, cancellation and no fallback.
2. Add `src/ai-extensions.ts`: provider metadata, installed-extension enumeration and host-compatible bundled-engine resolution. Connect it in `src/copilot-service.ts`; add the provider picker and Auto default. Remove manual path configuration.
3. Update transport error instructions and both manuals to describe installed extensions and one-provider behavior. Preserve optional models, existing cache contracts and unrelated monitor files.
4. Run focused/full tests, typecheck, browser UI and actual native Extension Host. Smoke-test the actual installed Codex bundled engine without relying on a global CLI. Review the diff, rebuild a local preview VSIX and verify its runtime and documentation contents. Leave publication and installation unchanged.
