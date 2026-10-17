# Context Navigation Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for continuous inline implementation. No parallel agents are needed.

**Goal:** Context 클릭으로 메인 소스 위치와 고정 해제된 Relation을 함께 이동한다.

**Architecture:** `webview/main.ts`에서 토큰 위치를 `navigateContext` 메시지로 전달하고 `src/view.ts`에서 검증 후 에디터를 열고 기존 심볼 추적을 실행한다. 기존 그래프 클릭 및 고정 의미를 유지한다.

**Tech Stack:** TypeScript, VS Code API, 기존 Webview/Playwright/Extension Host 테스트.

- [x] `test/ui.mjs`에 클릭한 토큰 위치와 드래그 선택 검증, `test/extension.test.ts`에 실제 이동/Relation/고정/잘못된 위치 검증을 추가하고 실패 확인.
- [x] `webview/main.ts`, `webview/styles.css`, `src/view.ts`에 최소 구현.
- [x] 타입·단위·UI·Extension Host 검사. 실패 원인 수정 후 관련 검사 재실행.
- [x] README/CHANGELOG/버전/릴리스 안내 갱신 및 VSIX 패키징. 태그 게시 후 세 플랫폼 검증과 공개 다운로드 확인 결과는 최종 응답에 기록한다.
