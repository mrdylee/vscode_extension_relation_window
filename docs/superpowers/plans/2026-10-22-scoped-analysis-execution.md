# Scoped Analysis Implementation Results

실행일: 2026-10-22–23, macOS arm64, Node v22.22.2.

기준 HEAD는 `8160f3fdea6d5272cac751c737b737991aafb54b`다. 계획 작성 뒤 반영된 기존 C 파서 변경을 포함해 보존했다. 기존 조사 문서와 재현 파일은 수정하지 않았다. 초기 구현 검증의 package version은 `0.1.71`이었고, 후속 검토·배포 후보는 `0.1.72`다. 분석 캐시 계약은 기존 4에서 **5**로 변경했다.

## 구현 결과

| 단계 | 결과 | 주요 검증 |
| --- | --- | --- |
| 1–3 정책·설정 | `Detailed Analysis Folders`, 기본 `[]`, resource scope. 영어 설정 순서와 통합 picker. 명시적 legacy 값과 기존 루트 캐시 증거만 호환 적용 | 정책, 다중 루트, 기존 설정 이관 |
| 4–5 기본·상세 경계 | 기본용 등록 자료와 전체 전파 프로그램 분리. 큰 숫자 initializer와 단순 scalar update 자료 생략. 선택 밖 헤더 정의는 참고하고 외부 본문은 자동 전파하지 않음 | 기본 호출·등록·literal 인자, 외부 getter 범위 추가 시 연결 복원 |
| 6–7 한도·캐시 | 함수 누적 100,000 / 프로젝트 누적 1,000,000 작업. 기존 슬롯·메모리·취소 한도 유지. 원인별 partial 상태와 Retry. 제한 결과는 완료 캐시로 seed하지 않음 | 낮은 예산, 독립 콜백 보존, Worker Stop/Retry, 범위 축소 GC, 캐시 손상·세대 |
| 8–9 Copilot | 호출별 명시적 요청. startup/enable/save/rebuild/model selection은 새 요청 0건. 해당 호출 재확인만 캐시 우회. 후보/자료 부족/미발견 응답과 근거 검증 | mock provider, 취소·시간 초과·구세대 응답, 요청 범위 |
| 10–12 사용자 연결 | `Set manually`, `User confirmed`, 별도 workspace 저장. AI 동의/다른 후보 비교와 명시적 `Use this target`. 정적 추론·Worker 캐시와 분리 | 재시작·Copilot OFF 보존, 동명 static 함수·두 호출 독립성, 서명 차이, 의존 코드 변경 검토 |
| 13–14 진행 UI | 고정 Stop 영역과 좁은 패널 별도 행. 전체 함수명 popup과 snapshot Copy, 키보드·실패·늦은 응답 처리 | Chrome Playwright 900/600/320px, 실제 VS Code clipboard API |
| 15 통합 | README/USER_GUIDE/진단 갱신, 전체 회귀와 실제 corpus 실행 | 아래 표 |

## 검증

| 실행 | 결과 |
| --- | --- |
| `npm run typecheck` / `npm run build` | 통과 |
| `npm test` | 533 / 533 통과 |
| `npm run test:worker` | 54 / 54 통과 |
| `npm run test:memory` | 5 / 5 통과 |
| `npm run test:ui` | 기존 UI 및 scoped UI 통과 |
| `npm run test:extension` | 실제 VS Code 통합 통과, clipboard 원래 내용 복원 |
| `npm run test:freertos` | 656개 파일, 기본 탐색 통과, 7.025초, 매크로 확장 0 |
| `DYNSIGHT_TEST_DETAILED=full npm run test:freertos` | 기본 탐색 통과, 13.751초, **상세 분석은 작업량 한도에 따른 partial** |
| `npm run test:large` | 12,551개 소스 중 Include로 2,501개 색인, 직접 호출 50,000개, 2.726초 |

FreeRTOS PASS는 전체 콜백 분석의 완전성을 뜻하지 않는다. 전체 상세 실행은 2,648개 매크로 호출을 확장한 뒤 한도에 도달했으며 inferred 콜백은 0개였다. 직접 호출과 등록 사실은 유지된다. 소스 폴더만 사용했고 clangd, Python 검색기, 빌드 툴체인을 추가하지 않았다.

## 성능 관측

Worker heap 제한 1 GiB, 동일 FreeRTOS 656개 파일. 소스 fingerprint: `e1f6a70abecd4a9ddca8813885c3f37be4c1851976c2a7a61c39e726cf2a51b8`. 일부 범위는 정렬된 파일 중 앞 10%를 선택한 측정용 범위이며 실제 프로젝트 추천 경로를 뜻하지 않는다.

| 범위 | 원본 준비 | 첫 관계 분석 | 메모리 내 재분석 | 새 Worker 캐시 복원 | 파일 하나 변경 분석 | 전체 전파 programs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 기본 | 6.396s | 0.552s | 0.002s | 1.213s | 0.684s | 0 |
| 일부 상세 | 6.369s | 2.385s | 0.001s | 1.249s | 2.742s | 431 |
| 전체 상세 | 6.549s | 10.604s | 8.313s | 2.973s, partial 재시도 | 7.145s | 5,490 |

첫 관계 분석까지 관측된 Worker 최대 heap은 기본 약 253 MiB, 일부 약 375 MiB, 전체 약 507 MiB다. 전체 상세는 작업량 한도에 도달했다. 전체 상세의 캐시 재시도에서는 메모리 보호 한도도 관측됐다(관측 peak 약 673 MiB). 따라서 전체 범위에서 메모리 경고가 없어졌다고 주장하지 않는다. 기본값과 폴더 선택으로 상세 자료를 줄이고, 남은 어려운 호출을 사용자가 선택해 조사하는 설계다.

기준 구현의 전체 상세 첫 관계 분석은 28.681초였다. 변경 후 전체 상세는 처리 범위와 중단 조건이 달라졌으므로 동등한 정확도에서의 속도 향상 수치로 비교하지 않는다. 시간은 단일 환경의 관측값이며 보장값이 아니다. `complete` 측정 필드는 실행 한도 여부이며 모든 C 구문의 의미 해석 성공을 뜻하지 않는다.

측정기는 Host heap/external, Worker 단계별 시간·heap/external, 후보·참조·경고를 JSON으로 남긴다. 캐시/파일 변경은 별도 Worker에서 실행하고, 변경은 메모리 입력에만 적용해 corpus를 수정하지 않는다. 처음 동일 Worker를 재사용한 측정에서 보호 한도 오류가 발생해 이 분리를 적용했다.

## 계획 대비 조정과 남은 검증

- 기준 캐시 버전이 실행 전 4로 바뀌어 새 형식은 5를 사용했다.
- 후속 검토에서 측정기의 `--fixtures`에 고정 C 사례를 추가했다. 일반 데이터·독립 콜백, 같은 필드의 다른 객체, getter→3번째 인자→전역 호출, callback array selector의 6개 간접 연결과 5개 대상 이름을 검사했다. `--callbacks=off`로 전체/일부 매크로 범위의 Cold/Warm/disk/1-file-save도 측정했다.
- 후속 scoped UI 검증은 두 AI 후보·두 호출 site, 동의/다른 제안/자료 부족, 동명 함수 경로 선택, AI 대기 중 수동 변경과 늦은 응답, Esc, 단계·큰 카운터·Stopping 상태의 고정 위치와 overflow까지 확장했다. FreeRTOS Worker Stop 표본은 요청 후 약 421 ms에 취소를 관측했다. 실제 firmware의 지연 보장값은 아니다.
- **Windows SafeRTOS/Wind River 실제 환경은 미검증**이다. 경로 정책과 다중 루트는 로컬 회귀로 검사했다.
- **실제 Copilot 모델의 20–30개 콜백 정확도 평가는 미실행**이다. mock 테스트를 모델 정확도로 해석하지 않는다.
- 초기 구현 단계에서는 패키징·배포를 하지 않았다. 이후 사용자의 배포 승인에 따라 `0.1.72` 검토·패키징·릴리스를 진행한다. 현재 배포 증거는 아래 검토 문서를 따른다.

원시 결과는 로컬 `test-results/analysis-final-{basic,partial,full}.json`, `freertos-{basic,full}.json`, `large-workspace.json`에 있으며 실행 환경 산출물로 Git에서 제외된다. UI 화면은 `output/playwright/scoped-user-confirmed.png`에 저장한다.

## 후속 review-work 및 배포 검증

[0.1.72 릴리스 검토](../../reviews/2026-10-23-release-0.1.72.md)에 발견한 두 문제의 red→green 재현, 수정, 추가 계획 검증과 게시 증거를 기록한다. 후속 로컬 검증은 unit 535개, Worker 54개, memory 5개와 native/corpus/UI 검사를 통과했다.

## 최종 감사의 추가 보완: 0.1.73

초기 결과 표의 기본 탐색 선공개는 등록·함수 인자까지 먼저 공개한다는 계약을 완전히 증명하지 못했다. 상세 매크로 단계에서 이 두 자료가 없다는 새 실패 테스트를 만들고 Worker의 기본 사실 선공개를 구현했다. 이제 해당 사실의 실제 도착 뒤 Basic/AI readiness를 표시하며, 후속 Stop·메모리 한도에서도 이미 공개한 사실을 유지한다. 이전 세대와 fatal Worker 뒤의 메시지는 적용하지 않는다.

[0.1.73 검토 및 게시 증거](../../reviews/2026-10-23-release-0.1.73.md)를 최종 상태로 따른다. 분석 캐시는 **6**이고, 기존 unified 기본 범위를 legacy 전체 분석으로 바꾸지 않는 업그레이드 및 명시적 legacy 설정 변경 회귀를 추가했다. 추가 Worker 검증은 60개다. 기존 0.1.72 태그·파일은 변경하지 않는다.
