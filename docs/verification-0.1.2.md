# 0.1.2 검증 — 2026-10-17

- Relation 노드 높이 26px 이하, 아이콘과 심볼 이름 한 줄 표시. 기본 노드 안에 참조 위치/동작 버튼 없음.
- hover 상세 팝업에서 두 번째 호출 위치 선택 및 Context 강조 확인. hover 전후 노드 높이 동일.
- 노드 클릭은 정의 미리보기, Space/Tab/Escape로 상세 접근, 기존 방향키 확장/접기와 명시적 소스 열기 유지.
- 함수/타입/키워드/변수/상수/숫자/문자열/주석/전처리 색 분류. 전체 파일에서 토큰화해 긴 주석 중간에서도 상태 보존. HTML 문자열 삽입 없이 텍스트로 렌더링.
- 타입 검사와 단위 테스트 17/17 통과. UI 테스트 통과, 브라우저 오류 0건. 어두운/밝은 화면 캡처 시각 확인.
- 실제 Extension Host 검증 통과. Context의 함수명 색상 토큰 전달 확인.
- VSIX 배포 자산 일치 확인 후 추출본으로 실제 Extension Host 재검증: 종료 코드 0.
- FreeRTOS 커밋 640d0c4의 list.c(249줄), tasks.c(8968줄) 토큰화 후 원문/줄 보존 확인. 전체 프로젝트 의미 분석 정확도 검증을 뜻하지 않음.

화면: output/playwright/relation-context.png, relation-context-light.png, relation-hover.png.

구문 색상은 어휘 기반이다. 임의의 typedef와 확장 매크로의 완전한 의미 분석은 제공하지 않는다. Source Insight 테마나 VS Code 편집기의 사용자별 토큰 색 설정을 그대로 복제하는 구현은 아니다.

패키지: artifacts/c-relation-explorer-0.1.2.vsix

SHA-256: `5e3d051d709d65ec290d1225447754336632c5fd923a2970570088b5c4c351c3`
