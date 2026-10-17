# C Relation + Context Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for continuous inline implementation. Do not delegate. Steps use checkbox syntax for tracking.

**Goal:** C 소스 폴더에서 함수 선택, 호출·참조 그래프, 코드 미리보기, 단계 확장, 종류 아이콘과 #if 0 제외가 동작하는 설치 가능한 VS Code 확장을 만든다.

**Architecture:** Tree-sitter C WASM을 분석 worker에서 실행하고 파일별 심볼·참조를 메모리에 색인한다. VS Code 하단의 WebviewView를 Context와 Relation으로 나누고, 메인 편집기의 선택만 그래프 루트를 변경한다. 이름 판별이 모호하면 후보를 표시하고 확정 호출자와 구분한다.

**Tech Stack:** TypeScript, VS Code API, web-tree-sitter 0.27.1, tree-sitter-c 0.24.1, esbuild, Node test runner, VS Code Extension Host tests, browser UI tests.

---

## 범위와 가정

- 현재 폴더에는 설계·연구 문서만 있다. 이 폴더에 새 확장을 작성한다.
- 첫 버전은 C 함수 중심 References/Callers 탐색이며, 함수 주소를 담는 변수 노드와 해당 참조를 포함한다.
- 전체 전처리기와 간접 호출의 실행 대상 추론은 구현하지 않는다. 미확정 조건과 후보는 화면에 구별한다.
- 원본 확장 단축키는 미확인이므로 Relation에 포커스가 있을 때 오른쪽/왼쪽 화살표로 펼침/접기, Shift+오른쪽으로 추가 깊이를 지정한다. Enter는 명시적인 소스 열기다. 도움말에 이 키를 안내한다.
- 현재 함수가 아닌 클릭한 함수가 루트다. 선택만으로 메인 코드가 이동하지 않는다.
- 원본 코드·미저장 버퍼의 위치를 보존한다. 문자열과 HTML은 실행하지 않고 텍스트로 렌더링한다.

## 파일 구성과 계약

- `src/model.ts`: Position/Location, SymbolRecord, ReferenceRecord, FileAnalysis, GraphNode/GraphData.
- `src/analyzer.ts`: WASM 초기화와 C 구문 분석. `analyze(uri, text, skipInactive)`는 파일별 값 데이터만 반환.
- `src/relations.ts`: `RelationIndex.update/remove/resolveAt/relations/graph`; 파일·스코프 기반 후보 해석과 깊이·순환 제한.
- `src/analysis-worker.ts`: 분석 요청을 worker에서 처리하고 결과나 실패를 요청 ID로 전달.
- `src/workspace.ts`: VS Code 파일 열거·문서 변경 감시, worker 호출, 색인 상태·제외 옵션 재적용.
- `src/extension.ts`: 활성화, 선택 추적, 명령 등록, 테스트용 API 노출.
- `src/view.ts`: Webview HTML, 메시지 검증, Context 데이터와 그래프 전달.
- `webview/main.ts`, `webview/styles.css`: 양쪽 영역, 그래프, 아이콘, 선택·확장·접기·키보드·폭 조절.
- `scripts/build.mjs`: 확장·worker·webview 번들 및 WASM 복사.
- `test/core.test.ts`: 실제 C 소스 기반 분석·관계 검증.
- `test/extension.test.ts`, `scripts/test-extension.mjs`: 격리 프로필 Extension Host 통합 검증.
- `test/ui.mjs`: 브라우저에서 그래프 선택·Context·키보드 검증.
- `examples/demo/`: 빌드 불필요한 다중 파일 C 예제.
- `README.md`, `CHANGELOG.md`, `package.json`, `.vscode/launch.json`: 사용법·실행·패키징.

## Task 1 — 분석과 관계의 검증 기준

- [x] 패키지·타입 검사·테스트 실행 설정을 만든다.
- [x] 실제 C 문자열로 다음 테스트를 먼저 작성한다: 호출과 주석·선언 구별, 여러 호출 위치, 한글 위치, #if0/else/elif/중첩, 알 수 없는 분기, static 동명 함수, 매개변수 이름 가림, 포인터 테이블의 함수 주소, 외부 동명 후보, 재귀, 삭제·수정 후 관계 갱신.
- [x] `npm test`로 아직 없는 기능 때문에 실패하는 것을 확인한다.
- [x] `analyze`와 `RelationIndex`를 구현한다. 반환값의 URI+범위로 심볼과 위치를 식별하고, 선언부 속성은 함수 본문 호출로 수집하지 않는다.
- [x] 같은 테스트를 통과시키고 `npm run typecheck`로 타입을 확인한다.

## Task 2 — VS Code와 분석 worker 연결

- [x] 예제 폴더의 함수 선택·참조 조회, 미저장 변경·삭제, 제외 옵션 재적용을 통합 테스트에 작성한다.
- [x] Worker와 WorkspaceIndex를 연결한다. 파일별 최신 요청만 반영하고 분석 실패·진행·완료를 분리한다.
- [x] 클릭한 심볼로 루트를 변경하고, 빈 곳 클릭 시 루트를 유지한다. 동일 이름 후보는 선택 가능한 목록으로 전달한다.
- [x] 격리된 VS Code 테스트 프로필에서 통합 테스트를 실행한다.

## Task 3 — Relation + Context 화면

- [x] 노드 선택이 Context만 바꾸고, 키보드 확장과 다중 호출 위치 선택이 동작하는 UI 테스트를 먼저 작성한다.
- [x] 하단 패널에 좌측 코드 미리보기, 우측 가로 그래프, 두 영역 사이 조절선을 만든다.
- [x] 상단에 References/Callers, 기본 깊이, 고정, 비활성 제외, 새로고침을 제공한다.
- [x] 노드 종류 아이콘·경로·위치, 조건과 후보 표시, 선택 강조, 순환 표시, 과도한 그래프 제한을 구현한다.
- [x] 노드별 추가 N단계 펼치기, 접기, 키보드 선택·확장, Enter 소스 열기를 연결한다.
- [x] Context에 구문 색상·원본 줄 번호·선택 강조·스크롤을 제공한다. 파일 경로·위치는 색인의 유효한 항목으로만 요청한다.
- [x] 브라우저 UI 검사와 실제 Extension Host 검증을 수행한다.

## Task 4 — 검증·문서·설치 파일

- [x] 전체 테스트와 타입 검사를 실행하고 실제 결과를 기록한다.
- [x] 설계 대비 자체 코드 리뷰: 모호성·static 스코프·순환·갱신 경합·미저장 코드·Webview 입력 검증을 점검하고 필요한 수정만 한다.
- [x] 사용법, 키보드, #if0 규칙, 지원 한계를 한국어 README에 작성한다.
- [x] `npm run package`로 로컬 VSIX를 만들고 WASM·worker·화면 자산이 들어 있는지 확인한다.
- [x] 패키지에서 추출한 확장을 격리 Extension Host에서 검증한다. 게시·원격 푸시는 하지 않는다.

## 완료 판단

실제 테스트 결과, UI 검증 결과, 설치 가능한 VSIX가 있어야 완료로 보고한다. 사용자 실제 프로젝트의 정확도·성능은 예제 및 합성 테스트 결과와 구분한다.
