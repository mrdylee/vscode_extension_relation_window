# Partial index 이슈 재분석 및 수정 검토

검토일: 2026-11-01 KST. 검토 기준 소스: `e499a75`, 제품 소스 변경 없음. 사용자 요청 범위는 Superpowers를 통한 이슈 분석과 수정 검토다. 이번 작업은 제품 수정·배포를 포함하지 않는다.

적용 절차: `superpowers:systematic-debugging`으로 원인 추적과 가설 검증, `superpowers:brainstorming`으로 수정 접근 비교, `superpowers:requesting-code-review` 기준으로 로컬 검토, `superpowers:verification-before-completion`으로 근거 확인. 서브에이전트는 사용하지 않았다.

## 결론

RBMS 147개 파일의 인덱싱은 완료됐고 상세 분석은 한도에 도달했다. 추가 검토에서 **한도 때문에 생략된 정보가 개별 콜백 결과에 전달되지 않아, 불완전한 대상 집합을 완전하다고 표시하는 두 가지 결함**을 재현했다. 이 정확성 결함의 수정이 우선이다. 재시도 문구 변경과 분석 비용 개선을 그 뒤에 다룬다.

두 결함은 작은 소스 입력으로 입증했다. 실제 RBMS 코드의 특정 콜백이 잘못된 대상으로 표시됐다는 사실까지 입증한 것은 아니다. 실제 프로젝트에서 확인한 작업·매크로 한도와 같은 분석 경로에 결함이 존재한다는 근거다.

## 1. [P1] 매크로 대안 생략이 콜백의 완전성에 반영되지 않는다

관련 위치: `src/macro-expansion.ts:143`, `src/project-analysis.ts:335`, `src/project-analysis.ts:365`, `src/project-analysis.ts:438`.

서로 독립인 조건 6개로 0/1 매크로를 만들고, 토큰 결합으로 `target_000000`부터 `target_111111`까지 64개 중 하나를 선택한다. 이 값을 콜백에 넣어 호출하면:

- `Macro argument alternative limit: 32 candidates` 경고가 발생한다.
- 가능한 64개 대상 중 32개만 결과에 남는다.
- 해당 호출의 `incomplete`는 **false**다. 남은 추론 참조도 모두 `incomplete: false`다.
- 지역 변수 초기화, 전역 변수 초기화, getter의 출력 포인터를 거치는 경우에 모두 재현된다.
- 대조군인 조건 5개/후보 32개는 모든 대상을 얻고 완전한 상태로 남는다.

전개기는 한도 경고를 기록하지만, 생성한 initializer/program에는 생략된 대안의 불확실성을 전달하지 않는다. 후속 포인터 분석은 전달받은 대안만 보고 완전한 값으로 합친다. 파일 단위 Partial 경고가 있어도 특정 간선의 완전성 표시는 틀릴 수 있다.

**수정 요구:** 전개가 잘린 initializer/함수/호출 위치의 정보를 보존하고, 생략된 대안을 unknown으로 표현해 해당 값과 파생된 반환값·출력 포인터·전역 저장 위치에 전달한다. 이미 확인한 후보는 유지한다. 최종 화면의 같은 함수 참조에만 불완전 표시를 덧붙이는 방식은 getter를 통한 재현을 해결하지 못한다.

## 2. [P1] 함수 작업 한도가 호출자의 이전 콜백 값을 확정하게 만든다

관련 위치: `src/pointer-targets.ts:1048`, `src/pointer-targets.ts:1061`, `src/pointer-targets.ts:1229`, `src/pointer-targets.ts:1235`, `src/pointer-targets.ts:1321`.

재현 입력의 핵심은 다음과 같다. 반복 대입은 한도 소진을 일정하게 유발하기 위한 것이다.

```c
static CB cb = first, noise;
void setup(void) {
    noise = first;
    /* noise = noise; 를 50회 반복 */
    cb = second;
}
void run(void) {
    setup();
    cb();
}
```

- 함수 작업 한도 100: `setup`이 101회에서 중단되고, `run`의 콜백 대상은 `first`, `incomplete: false`다.
- 같은 소스에 한도 10,000: 경고가 사라지고 대상은 `second`, `incomplete: false`다.
- 이 소스의 정상 실행에서는 `setup`의 마지막 대입 후 `second`를 호출한다. 제한된 분석에서 `first`를 후보로 보존할 수는 있지만 완전한 결과라고 표시해서는 안 된다.
- 별도의 지역 콜백만 사용하는 `independent` 함수는 두 경우 모두 `second`로 완전하게 해결된다. 이 동작은 수정 후에도 유지해야 한다.

작업 한도 도달 시 함수의 반환값에 unknown을 합치고 `target.incomplete`를 기록한다. 그러나 이미 분석한 쓰기 효과와 생략 영역을 소비하는 호출 경로는 **중단 뒤에 실행될 저장 위치 변경**을 반영하지 못한다. 반환값을 사용하지 않는 `setup()` 호출에서는 반환값의 unknown만으로 `cb`가 무효화되지 않는다.

**수정 요구:** 작업 중단으로 생략된 쓰기의 영향 범위를 함수 요약에 남기고 호출자가 그 영향을 소비해야 한다. 원래 프로그램의 쓰기/호출 정보를 이용해 전역·인자 저장 위치를 식별할 수 있으면 해당 위치만 불확실하게 만든다. 쓰기 범위를 증명할 수 없으면 보수적인 불완전 결과로 처리해야 한다. 단순히 모든 `target.incomplete` 호출을 opaque 함수로 취급하면 기존의 영향 범위 제한과 무관한 인자 보존을 깨뜨릴 수 있으므로 별도 회귀 검증이 필요하다.

## 3. [P2] 고정 한도에 일괄적인 재시도 안내를 표시한다

관련 위치: `src/workspace.ts:118`, `src/workspace.ts:501`, `webview/local-progress.ts:31`, `webview/local-progress.ts:34`.

`limited`가 true이고 실행 중·일시정지가 아니면 모두 `Local analysis needs retry`가 된다. Retry는 같은 한도로 재분석하며 한도를 늘리거나 중단 지점부터 이어서 처리하지 않는다. 구조/매크로 한도 때문에 캐시된 결과를 그대로 반환하는 경우도 있다.

다만 **재시도가 항상 무효인 것은 아니다.** 실제 입력의 cold 분석에서는 매크로와 콜백 작업을 함께 누적해 함수 작업 경고가 2건이었고, 매크로 캐시 재사용 후에는 1건이었다. 이후 두 번의 warm 분석은 모두 같은 한도와 결과를 재현했다. 한도는 동일하지만 캐시 재사용이 작업량에 영향을 주므로 고정 한도와 일시적인 중단을 구분해서 설명해야 한다.

**수정 요구:** 고정 한도는 `Local analysis limited`처럼 표시하고 동일 한도로 다시 실행한다는 안내를 제공한다. 재실행을 유지한다면 `Re-run local`과 같은 동작 설명을 사용한다. 사용자 중지·일시적인 메모리 압박 등은 기존 Resume/Retry 흐름을 유지한다. 한도를 숨기거나 Partial을 무조건 Ready로 바꾸지 않는다.

## 실제 RBMS 입력의 재확인

소스 SHA-256이 현재 캐시의 147개 원문과 일치함을 다시 확인했다. 사용자 설정과 실제 VS Code를 변경하지 않고 매크로 캐시를 준비한 별도 프로세스에서 두 번 분석했다.

| 항목 | 결과 |
|---|---|
| 기본 입력 | 147개 파일, 원본 프로그램 1,677개 |
| 매크로 준비 작업 | 384,879 단위 |
| `product_safety_task_data_extra_measure` | 원본 프로그램 1개 → 전개 프로그램 25개 |
| 같은 함수의 매크로 준비 비용 | 19,257 단위 |
| warm 콜백 평가 작업 | 두 번 모두 618,091 단위 |
| 함수 작업 경고 | 두 번 모두 같은 함수 `product_safety_task_data.c:823`, 100,001 / 100,000 |
| 변경 추적 진단 | 두 번 모두 9건 |
| 영역 추적 진단 | 두 번 모두 11건 |
| warm 실행 시간 | 35,081ms / 36,611ms, 별도 Node 프로세스 기준 |

이 결과는 실행 중 캐시의 한도 위치와 일치한다. 별도 Node 실행 시간은 실제 VS Code UI의 시간과 직접 비교하지 않는다.

## 수정 접근 비교

| 접근 | 효과와 비용 | 판단 |
|---|---|---|
| **정확성 전파 수정 + 상태 안내 보완** | 생략된 후보/쓰기의 불확실성을 관련 결과에 전달하고 오해를 줄인다. 한도를 유지하므로 전체 분석이 완전해진다는 보장은 없다. | **권장** |
| 안내 문구만 수정 | 변경 범위는 작지만 두 정확성 결함은 남는다. | 단독 수정으로 불충분 |
| 100,000 / 256 / 32 상향 또는 제거 | 더 많은 작업을 허용할 수 있지만 다른 한도는 남고, 시간·메모리 상한과 취소 응답성 검증이 추가로 필요하다. | 이번 근본 수정안으로 채택하지 않음 |

성능 개선은 별도 단계로 진행한다. 조건별 프로그램이 25개로 증가하고 큰 진단 배열의 포인터 효과가 전달되는 비용을 프로파일링한다. 불변 IR 공유와 일부 영역 재사용은 이미 구현되어 있으므로 같은 개선을 다시 제안하지 않는다. 조건 간 상관관계·별칭·콜백 선택 인덱스를 유지하면서 중복 평가와 효과 집계를 줄일 수 있는지 검증한다.

## 권장 변경 범위와 수용 기준

1. **불완전성 전달:** `macro-expansion`/`project-analysis`/필요한 model 필드와 `pointer-targets`에서 생략 정보가 값·저장 위치·호출 결과로 전달되게 한다. 기존 unknown/reasons 표현과 영역 무효화 동작을 우선 재사용한다.
2. **캐시 갱신:** 분석 의미가 바뀌므로 `ANALYSIS_CACHE_VERSION`을 올린다. 현재 값은 16이다. 특히 매크로 제한만 있는 캐시는 `retryable: false`일 수 있으므로, 이전의 잘못된 완전성 결과가 새 분석기로 조용히 복원되면 안 된다. 버전 불일치 시 기존 Rebuild 안내를 유지한다.
3. **표시 보완:** `diagnostics`/`workspace`의 원인 정보와 `local-progress`를 이용해 고정 한도와 중단/재개를 구분한다. General Include, Smart Analysis 범위, AI 제공자/모델은 자동 변경하지 않는다.
4. **회귀 검증:** 32개 이내의 매크로 후보는 계속 완전해야 한다. 64개 중 일부가 생략되면 local/global/getter 경로 모두 불완전해야 한다. 작업 한도 뒤의 쓰기가 호출자의 완전성에 반영되어야 하며, 무관한 콜백은 완전하게 남아야 한다.
5. **통합 검증:** cold/warm/디스크 복원/Retry에서 대상 ID·호출 위치·근거·불완전성·이유를 비교한다. 기존 256/32/작업량 보호, Stop/Resume, 메모리 보호, 기본 탐색과 AI 후보 구분을 유지한다. 실제 147개 입력에서 누락 후보가 있어도 거짓 완전성이 생기지 않는지 확인한다.

## 검증 증거

기존 관련 테스트 **213개 통과 / 실패 0개**:

```sh
./node_modules/.bin/tsx --test test/analysis-budget.test.ts test/analysis-notices.test.ts test/macros.test.ts test/callback-uncertainty.test.ts test/callback-safety.test.ts test/callback-effects.test.ts
```

검토용 신규 회귀 테스트는 **7개 중 대조군 3개 통과, 원하는 동작 검사 4개 실패**했다. 네 실패 모두 환경 오류가 아니라 `incomplete`의 기대값 true / 실제값 false다. 제품 테스트 목록에 편입하거나 제품 코드를 수정하지 않았다.

```sh
./node_modules/.bin/tsx --test artifacts/partial-index-147/review-regressions.test.ts
```

증거 파일은 `artifacts/partial-index-147/`에 있다:

- `review-regressions.test.ts`, `review-regressions.log`: 실패 4개와 대조군.
- `macro-target-loss-probe.ts`, `macro-target-loss-probe.json`: 64개 중 32개 대상 누락.
- `function-work-probe.ts`, `function-work-probe.jsonl`: 한도만 바꾼 호출 대상 비교.
- `review-probes.ts`, `review-probes.json`, `review-probes.log`: 실제 147개 입력의 warm 분석과 프로그램 변형 수.
- `review-baseline-tests.log`: 기존 213개 테스트 결과.

수정 검토 완료. 두 정확성 결함과 표시 문제에 대한 권장 범위를 제시했으며, 실제 수정의 성공이나 전체 RBMS 호출 그래프의 완전성을 주장하지 않는다.
