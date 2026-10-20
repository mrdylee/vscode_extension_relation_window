# Callback diagnostics implementation plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: superpowers:executing-plans; inline execution, no subagents.

**Goal:** Show where callback limits were observed and remove unused global initialization summaries.
**Architecture:** Add bounded CallbackDiagnostic records to FileAnalysis. Keep limit messages generic for inference; format source attribution in RelationView and project only safe counters into issue reports. Skip write effects only in the synthetic global initializer context.
**Tech Stack:** TypeScript, Tree-sitter, VS Code, Worker, node:test.

- [x] Add failing analyzer regression tests: 300-slot static initializer must not emit a function mutation limit; 300 real function writes must emit a detail on the correct file/function. Preserve target edges in both cases. Test time/memory diagnostics using controlled callbacks/clock, bounded records, and macro source locations.
- [x] Add model CallbackDiagnostic with kind, stage, message, optional location/symbol and numeric elapsed/evaluation/slot fields. Implement first-observation capture capped at 64 per pass, without per-operation allocation. Attach generic warnings to files matching retained locations and project fallback only for unlocated kinds.
- [x] In synthetic global initializer write, omit state.effects while keeping state.memory and heap writes. Keep real function and persistent local effects unchanged. Run pointer and memory tests.
- [x] Format callback diagnostics in the view; show project context without file attribution and prioritize limit details before syntax notices. Include only kind/stage and numeric counters in reports. Add privacy and ordering tests; native integration confirms report/selection behavior.
- [x] Update README, Help, CHANGELOG, release/review notes. Run typecheck, unit, Worker, memory, performance, browser and native checks, inspect the diff and fix review findings.
- [ ] Package the next patch VSIX, test it, push release tag; verify three-platform CI, public assets/checksums and local/public ZIP content equality. Record publication evidence without changing production installation.
