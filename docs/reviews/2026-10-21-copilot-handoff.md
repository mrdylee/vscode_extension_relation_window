# Dynsight Copilot 중단 조사 인계

2026-10-21. 사용자가 이슈가 많아지고 대화가 느려져 새 세션을 고려하여 현재 작업을 인계한다.

## 우선 목표

v0.1.56 사용자 WSL 화면의 `Copilot: waiting for saved index · 0/0 processed · Remaining 0 · Failed 0` 원인을 식별하고 저장 후 재개를 검증한다. 사용자는 이전에 처리 대상 38개가 10분 이상 걸리고 정상 처리되지 않았다고 보고했다. 사용 모델, 실제 요청 수, 당시 시간 분해는 미확인이다. 이 사진은 모델 응답 대기 자체의 증거가 아니다.

화면에는 196 indexed files, 정적 분석 Partial index, callback region/mutation 256 limit 경고가 함께 있었다. 일반 partial-limit 경고 자체는 WorkspaceIndex.stable을 false로 만들지 않는다. 미저장 C/H 파일이나 인덱스 갱신/오류는 차단할 수 있으나 실제 원인은 아직 모른다.

## 저장소 상태

- 경로 `/Users/james_black/work/project/vscode_extension`
- 브랜치 `fix/callback-candidates-progress`, HEAD `ff8a07a`.
- 현재 manifest는 0.1.57. 이번 작업 전에 이미 등록 콜백 후보 관련 미커밋 변경이 다수 존재했다. 되돌리거나 이번 변경이라고 묶지 말 것.
- 이번 대기 표시 변경은 미커밋·미게시 상태다. 실제 사용자 WSL에서 해결됐다는 주장을 하지 말 것.

## 이번에 추가한 변경

- `src/diagnostics.ts`: CopilotWaitReason, 고정 안내 메시지, diagnostics.waitReason.
- `src/workspace.ts`: copilotWaitReason getter만 추가(이 파일의 나머지 변경은 기존 작업).
- `src/copilot-service.ts`: clear/run/schedule 대기 상태에 이유를 넣고 실행 시 이유 제거. schedule의 조건 불충족 시 이유를 다시 표시한다. 자동 무한 재시도·요청 정책 변경은 하지 않았다.
- `webview/main.ts`: 대기 중 footer에서 0/0 통계 대신 원인과 조치 표시(다른 변경은 기존 작업).
- `webview/diagnostics.ts`: 대기 중 안내와 세션 요청 수 표시. else 블록 들여쓰기 정리 필요 여부 확인.
- `src/issue-report.ts`: 허용된 waitReason 코드만 내보낸다.
- `test/copilot-service.test.ts`: 이유 표시, dirty→save→settled 재개, stable partial 허용, 분석 실패 차단 테스트.
- `test/workspace.test.mjs`: getter의 차단 사유 검사 테스트 추가. 아직 실행하지 않았다.
- `test/issue-report.test.ts`: 이유 코드 유지와 임의 문자열 제거 검사.
- 계획: `docs/superpowers/plans/2026-10-21-copilot-wait-reasons.md`.

## 검증 결과와 남은 일

1. 변경 전 새 서비스 테스트 3개가 waitReason 누락으로 실패하는 것 확인.
2. 변경 후 `npx tsx --test test/copilot-service.test.ts test/copilot-progress.test.ts test/issue-report.test.ts`: 26/26 통과. 실제 Copilot 대신 mock provider를 사용했다.
3. 첫 typecheck에서 optional waitReason 전달 타입 오류 발견. `waitReason ?? ''`로 수정한 후 `npm run typecheck && npm run build && git diff --check` 종료 코드 0 확인.
4. 새 Workspace getter 테스트와 실제 브라우저 UI 검증, 최종 코드 리뷰는 남아 있다. 전체 테스트·사용자 WSL 재현·게시도 이번 변경에는 수행하지 않았다.
5. 서비스의 저장 후 재개 테스트는 기존 스케줄 정책을 검증한다. 실제 재개 버그가 재현되어 해결됐다는 의미가 아니다.

다음 세션은 이 대기 문제부터 마무리한다. Python 전환·메모리 재설계·LLM 프롬프트 개선을 한 번에 섞지 않는다. 원인을 표시한 버전에서도 대기가 지속되면 이유 코드와 Diagnostics를 받아 차단 조건을 좁힌다. 10분 지연은 별도로 문맥 준비/토큰 계산/첫 응답/완료 시간을 계측해야 한다.

## 후속 세션 검증 (2026-10-21)

- 기존 미커밋 변경을 보존한 상태에서 이어서 검증했다. 이번 추가 변경은 `src/copilot-service.ts`, `webview/diagnostics.ts`, `test/copilot-service.test.ts`, `test/ui.mjs`와 이 문서뿐이다.
- 추가 재현: Copilot 설정이 꺼져 있어도 dirty source 이벤트 후 스케줄 타이머가 `off`를 `waiting-for-saved-index`로 덮어썼다. 새 회귀 테스트에서 실제 `waiting-for-saved-index`, 기대 `off`로 실패하는 것을 확인했다. 타이머에서 활성 여부를 먼저 확인하도록 한 줄을 추가했다. 이는 사용자 WSL에서 보고한 중단의 원인으로 확정한 것이 아니다.
- 기존 dirty→save→settled 재개, stable partial 허용, 분석 실패 차단 서비스 테스트와 새 Workspace getter 테스트가 통과했다. 서비스 테스트는 mock Copilot/Workspace를 사용하며, Workspace 테스트는 실제 Worker를 사용한다.
- 브라우저 테스트에 대기 이유 8종의 footer/Diagnostics 안내, 세션 요청 수 유지, `0/0` 통계·분석 버튼 숨김, ready 복귀 후 진행 표시 복원을 추가했다. Chrome headless에서 통과했고 `output/playwright/copilot-waiting.png`를 직접 확인했다. Diagnostics의 이번 대기 안내 else 블록 들여쓰기도 정리했다.
- 최종 검증: `npm test` 363/363, `npm run test:worker` 37/37, `npm run typecheck`, `npm run test:ui`(빌드 포함), `git diff --check` 모두 종료 코드 0.
- 최종 코드 검토에서 대기 이유 getter는 기존 stable/dirty 차단 조건을 설명하며, 일반 Partial index 한도 경고를 새 차단 조건으로 추가하지 않음을 확인했다. 요청 한도·권한·캐시 정책은 유지했다.
- 미커밋·미게시 상태다. 실제 Copilot 요청, 사용자 WSL 설치/재현 및 10분 지연 원인 검증은 수행하지 않았다. WSL에서 계속 대기하면 표시된 안내와 issue report의 `copilot.waitReason`으로 다음 조사를 좁힌다.

## 저장 대기 중 명령 보존 검증 (2026-10-21)

- 이번 세션에서 추가로 수정한 파일은 `src/copilot-service.ts`, `test/copilot-service.test.ts`, `test/workspace.test.mjs`와 이 문서다. 기존 미커밋 변경은 보존했다. 작업 중 별도로 들어온 `src/workspace.ts`의 대기 사유 실시간 갱신과 Worker 종료 회귀 테스트도 보존했으며, 아래 Worker 검사에는 함께 포함되어 있다.
- 새로 재현한 결함: 미저장 상태에서 Analyze/Reanalyze를 실행하면 `run()`이 조기 반환하면서 실행 이유가 사라졌다. 편집 버퍼가 이미 인덱싱되어 저장 시 generation이 유지되면, 스케줄러가 명령을 재개하지 않고 캐시만 복원했다. 서비스 회귀 테스트 두 건에서 저장 후 요청 수가 각각 기대 1/2, 실제 0/1로 실패했다. 실제 Worker 테스트에서도 미저장 버퍼 인덱싱 후 저장 시 generation이 유지되는 조건을 확인했다.
- 수정: 명시적 Analyze/Reanalyze의 실행 이유를 대기 중 보관하고 준비된 인덱스에서 한 번 소비한다. Copilot 비활성화 또는 모델 변경 시 보류 명령을 취소한다. 미저장/관계 분석 중에는 요청하지 않으며, 강제 재분석의 캐시 우회와 기존 배치 한도를 유지한다. 새 서비스 테스트 네 건은 일반/강제 재개, 중복 settled에서 재요청 방지, 비활성화/모델 변경 시 취소를 검증한다.
- 최종 검증: `npm test` 367/367, `npm run test:worker` 39/39, `npm run typecheck`, `npm run test:ui`(빌드 포함), `git diff --check` 모두 종료 코드 0. 서비스는 mock Copilot/Workspace, 저장 시 generation 검증은 실제 Worker를 사용했다.
- 이 결함이 기존 사용자 WSL 화면의 원인이었는지는 미확인이다. 실제 Copilot 요청·WSL 설치/재현·10분 지연 측정·패키징·게시·커밋은 수행하지 않았다.
