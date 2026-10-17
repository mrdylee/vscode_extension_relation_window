# 0.1.0 검증 기록 — 2026-10-17

## 결과

- `npm run typecheck`: 통과.
- `npm test`: 분석·관계 단위 테스트 9/9 통과.
- `npm run test:ui`: Chrome 브라우저 검증 통과. 그래프, Context의 실제 호출 줄, 루트 유지, 변수 아이콘, 키보드 펼침/접기/추가 단계 요청, 소스 열기 요청, 고정, 분할 너비, 좁은 화면을 확인. 브라우저 오류 0건.
- `npm run test:extension`: 실제 VS Code의 격리된 프로필에서 통과. 활성화, WASM worker, 편집기 선택, 실제 참조 위치, 미리보기 중 편집기 유지, 관계 모드/깊이/확장/접기, 고정, 명시적 소스 열기, 잘못된 위치 요청 무시, #if0 재색인, 미저장 편집, 파일 생성·삭제를 확인.
- `npm run package`: VSIX 생성. 6개 실행 자산의 내용이 빌드 결과와 동일함을 확인. worker, 두 WASM, 화면 자산, 라이선스 포함. 테스트 코드와 node_modules는 배포에서 제외.
- VSIX를 `artifacts/verification`에 추출한 후 `EXTENSION_PATH=artifacts/verification/extension node scripts/test-extension.mjs`로 위 Extension Host 검증을 다시 실행: 통과.

## 자체 리뷰

- 함수 본문/초기화 구문에서 참조를 수집하며 주석·문자열·선언부 컴파일러 속성을 직접 호출로 오인하지 않는지 확인.
- 파일별 static과 매개변수/지역 변수 이름 가림, 여러 외부 정의의 후보 표시를 테스트로 확인.
- 재귀 중단, 300개 노드 제한, 노드별 확장과 기본 깊이 분리 확인.
- 파일 변경 시 요청 버전/전체 색인 세대로 오래된 결과를 거부하고 삭제 시 버전을 무효화하는 경로 검토.
- Webview는 HTML 문자열 삽입 없이 소스를 텍스트로 표시. 스크립트 nonce와 CSP 사용. 위치 요청은 현재 그래프에 등록된 ID에 대해서만 허용.
- 패키징에서 WASM 런타임의 import.meta.url이 손실되는 문제를 수정하고 실제 worker 실행으로 검증.
- 테스트용 번들이 패키지에 포함되던 문제를 허용 파일 목록으로 수정.

## 검증 한계

예제와 합성 C 소스를 사용한 macOS 검증이다. 사용자 실제 펌웨어, Windows/Linux/Remote, 대규모 폴더는 미검증이다. 타입 사용처, 구조체 멤버, 전체 전처리, 간접 호출 대상 추론은 이번 구현의 범위 밖이다. 이름 연결은 컴파일러 의미 분석이 아닌 파일/스코프 기반이며 복잡한 선언·헤더·컴파일러 전용 문법에서 불완전할 수 있다. 파일 변경 시 관계 맵을 재구축하므로 대규모 프로젝트의 성능 개선 여부는 실제 측정 후 결정해야 한다.

화면 캡처: `output/playwright/relation-context.png`.
원시 결과: `test-results/ui.json`, `test-results/extension.json`, `test-results/package.json`.

## 배포 파일

`artifacts/c-relation-explorer-0.1.0.vsix`

크기: 214532 bytes

SHA-256: `e3ae6928d322ef4cd59b93543bc66509b8ceb4c8578ec5d6e8069e902c3f07b2`
