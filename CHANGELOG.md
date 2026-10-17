# Changelog

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
