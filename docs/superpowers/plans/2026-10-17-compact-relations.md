# Compact Relations Implementation Plan

> Execute inline using superpowers:executing-plans. No subagents. Existing implementation authorization applies. Workspace has no Git repository.

**Goal:** 한 줄 Relation 노드와 hover 상세 정보, 색상으로 구별되는 Context 코드를 제공한다.

**Architecture:** 기존 그래프 데이터와 메시지를 유지한다. webview/main.ts의 카드 세부 DOM을 하나의 고정 위치 팝업으로 이동한다. src/syntax.ts의 순수 C 토큰 분류 결과를 RelationView가 전체 파일에서 계산/캐시한 후 Preview에 포함한다.

**Tech Stack:** TypeScript, DOM/CSS, 기존 Node 테스트, Playwright, Extension Host.

- [x] test/ui.mjs에서 노드 높이 <=26, 기본 .site 없음, hover 후 두 참조 표시/선택, 키보드 상세/접기, 두 테마의 함수/타입 색을 먼저 검증하고 실패 확인.
- [x] test/syntax.test.ts에 주석/문자열 보호, 함수/타입/숫자/매크로 분류, 원문과 줄 보존 검증을 추가. src/syntax.ts에 highlightC(text): SyntaxToken[][] 구현; package.json 테스트 패턴에 포함.
- [x] src/view-state.ts Preview.tokens와 src/view.ts 전체 파일 토큰 캐시를 연결. test/create-ui-fixture.ts에서 동일 토큰 생성. test/extension.test.ts에서 Context 토큰을 확인.
- [x] webview/main.ts의 상세 정보를 고정 팝업으로 이동. hover/포커스/Space 표시, Escape/외부 클릭/스크롤 닫기, 포인터 이동 지연 닫기, 기존 메시지 유지. 한 줄 카드와 선택/후보 표시를 webview/styles.css에서 구현.
- [x] Context의 기존 줄 단위 정규식을 전달된 토큰 렌더링으로 교체. 밝은/어두운 테마 색을 CSS로 제공. 기존 줄 강조 유지.
- [x] npm run typecheck, npm test, npm run test:ui, npm run test:extension 실행. 스크린샷 시각 확인.
- [x] 0.1.2 버전·README·CHANGELOG 갱신. 패키징 후 추출한 확장을 Extension Host로 검증. 이전 설치 요청의 연속으로 사용자 VS Code 설치판도 0.1.2로 업데이트하고 설치 버전 확인.
