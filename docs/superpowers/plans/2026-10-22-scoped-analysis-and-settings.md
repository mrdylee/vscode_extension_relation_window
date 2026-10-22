# Scoped Analysis, Callback Confirmation and Settings Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans by default for continuous inline implementation. Use superpowers:subagent-driven-development only when the user explicitly requested subagents or parallel agent work. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 영어 설정 순서를 정리하고 매크로·콜백 상세 분석을 폴더로 제한하며, 호출별 Copilot 조사와 User confirmed 지정, 고정된 중단 버튼과 함수명 복사를 제공한다.

**Architecture:** Keep the existing TypeScript/Tree-sitter Worker and build-free source-folder workflow. Resolve per-file macro/callback policy before collecting expensive flow facts, publish basic navigation independently of detailed completion, and retain bounded uncertainty at affected calls. Keep AI suggestions and user confirmations in separate presentation overlays, outside Worker analysis and its cache; expose explicit per-call actions through the existing VS Code webview bridge.

**Tech Stack:** TypeScript, VS Code Extension API and Copilot Language Model API, web-tree-sitter/tree-sitter-c, Node Worker and node:test, existing Playwright UI harness.

---

작성일: 2026-10-22 (Asia/Seoul). 기준 체크아웃: `81d26b2`, package version `0.1.71`.

저장소 루트: `/Users/james_black/work/project/vscode_extension`. 아래 파일 경로는 이 루트 기준이다.

설계 원문: [Scoped analysis and settings design](../specs/2026-10-22-scoped-analysis-and-settings-design.md).

**계획 작성 당시에는 코드 변경을 하지 않았다. 이후 사용자의 실행 승인에 따라 구현과 검증을 진행했다.** 실행 기준 HEAD는 `8160f3f`이며 기존 변경을 보존했다. 체크된 항목은 구현·검증했고, 전체 조합 시험·측정 방식의 조정·외부 환경 미검증 항목은 아래 실행 결과에서 구분한다.

실행 기록: [Scoped Analysis Implementation Results](2026-10-22-scoped-analysis-execution.md). 미체크 항목은 해당 항목의 모든 세부 조합을 실행했다는 뜻으로 표시하지 않기 위해 남겼다. 대체 검증과 남은 플랫폼·실제 모델 평가는 실행 기록을 따른다.

작성 중 작업 공간 변경: 시작 시 추적 파일 diff는 없었으나 마지막 확인 시 `src/analysis-cache.ts`, `src/analyzer.ts`, `src/flow-parser.ts`, `src/project-analysis.ts`, `src/type-info.ts`, `test/core.test.ts`에 변경이 감지됐다. 새 미추적 파일 `src/initializer-preprocessor.ts`도 확인됐다. 이 계획 작성 작업은 이 파일들을 생성·수정하지 않았다. 변경의 출처·완성도는 확인하지 않았으며 실행 전 현재 diff와 아래 계약을 대조해 기존 작업을 보존하고 중복 구현을 피한다.

## 1. 실행 범위와 작업 순서

하나의 변경으로 몰아넣지 않고 아래 순서의 검증 가능한 묶음으로 진행한다. 외부 분석 엔진 도입, AI 자동 일괄 실행, 토큰 계량, 함수 클릭별 지연 분석은 포함하지 않는다.

| 묶음 | 작업 | 완료 조건 | 선행 |
| --- | --- | --- | --- |
| A | 1–4: 정책·설정·Worker·기본 결과 공개 | 상세 OFF/일부/전체와 기존 설정 호환이 실제 분석량에 반영 | 없음 |
| B | 5–7: 작업량·불확실성·캐시 | 중단된 호출의 이유 보존, 범위 축소 시 자료 해제 | A |
| C | 8–9: 호출별 AI 조사·응답 | 자동 요청 0건, 해당 호출 재확인만 캐시 우회 | A, B |
| D | 10–12: 사용자 지정·표시·액션 | Set manually → User confirmed, AI 비교 후 명시적 적용 | C |
| E | 13–14: 고정 Stop·함수명 팝업 | 위치 안정, 스냅샷 이름 복사와 키보드 사용 | 기본 준비 상태 계약은 A, 나머지는 독립 |
| F | 15: 문서·회귀·성능 | 설계 검증표 전체 대응, 플랫폼별 증거와 한계 기록 | A–E |

각 작업 안에서는 실패 회귀 확인 → 최소 구현 → 해당 검증 순서로 진행한다. 한 변경이 안정된 뒤 다음 작업으로 이동한다. 실행 승인 전에는 다음 단계로 넘어가지 않는다. 구현 시 커밋을 만들더라도 각 묶음의 관련 파일만 명시적으로 stage하고 `git add .`로 기존 조사 파일을 포함하지 않는다. 커밋·PR·게시 자체는 이 계획의 완료 조건이 아니다.

## 2. 계획에서 사용하는 정책 결정

1. 새 설정 키는 **`dynsight.detailedAnalysisFolders`**, `resource` scope, 기본값 `[]`로 제안한다. 명시적 빈 목록과 설정 자체가 없는 상태를 구분한다.
2. 기존 작업 공간은 명시적 legacy 설정 또는 해당 작업 공간의 기존 분석 캐시 흔적으로만 식별한다. 기존 설정의 기본값을 읽었다는 이유로 새 프로젝트를 legacy 전체 분석으로 간주하지 않는다. 캐시를 새 버전으로 무효화하기 전에 legacy 여부를 한 번 보관한다.
3. 신규 통합 설정이 있으면 해당 루트에서 이를 우선하며, 없고 legacy로 확인된 루트만 기존 매크로 폴더와 `analyzeCallbacks`를 각각 해석한다. 기존 설정을 자동으로 덮어쓰지 않는다. 불명확한 새 작업 공간은 기본 분석부터 시작하고 범위를 선택할 수 있게 한다.
4. Copilot Include는 자동 복사·동기화하지 않는다. 기존 명시적 값은 보존하되 유효 호출 위치는 기본 ∩ 상세 ∩ Copilot Include − 각 Exclude로 제한한다. 참고 근거는 기본 색인 안의 다른 경로에서 수집할 수 있음을 영어로 설명한다.
5. `stable` 하나를 완화해 모든 동작을 허용하지 않는다. **저장된 기본 자료 준비**와 **상세 결과 동기화 완료**를 별도 조건으로 정의한다. 기본 자료가 유효하고 로컬 상세 분석이 한도·수동 중단된 경우에도 호출별 AI 조사를 허용한다. Worker 종료·소스 미저장·기본 파싱 실패는 별도로 막는다.
6. 사용자 대상은 실제 색인된 함수 정의를 선택한다. 설계의 ‘가시성’은 포인터로 가능한 대상인지 검증한다는 뜻이다. 다른 `.c`의 `static` 함수가 그 파일의 테이블에 등록되어 외부에서 포인터로 호출되는 합법 패턴을 직접 이름 조회 규칙으로 금지하지 않는다. 타입이 불명확하면 경고하며 정적 확정으로 승격하지 않는다.
7. 분석 한도의 실제 기본 숫자는 작업 1 기준 측정과 작업 5 회귀를 거쳐 작업 15에서 결정·기록한다. 테스트는 작은 주입 한도로 결정적 검증을 한다. 한도를 사용자 설정으로 추가하거나 메모리 경고를 피하려고 기존 안전 한도를 늘리지 않는다.
8. 사용자 UI는 영어다. 설계 설명과 이 계획은 한국어를 사용한다. 배지는 `AI candidate`, `User confirmed`; 버튼은 `Set manually`, `Recheck with AI`, `Apply`, `Cancel`, `Use this target`, `Remove manual override`다.

## 3. 파일 구조와 책임

아래 새 파일 이름은 구현 계약이다. 아직 생성하지 않는다. 기존 큰 파일은 필요한 연결부만 수정하고 전면 재배치하지 않는다.

| 파일 | 작업 | 책임 |
| --- | --- | --- |
| `src/analysis-policy.ts` | 신규 | explicit/legacy 정책 해석과 파일별 매크로·콜백 플래그. VS Code 없이 단위 검증 |
| `src/analysis-budget.ts` | 신규 | 함수·프로젝트 누적 작업량과 중단 상태. 테스트용 한도 주입 |
| `src/model.ts` | 수정 | 정책·간결한 기본 사실·호출별 분석 상태·user-confirmed 표현 |
| `src/macro-folders.ts` | 수정 | 기존 폴더 선택 UI를 통합 상세 폴더 선택에 재사용, legacy 명령 호환 |
| `src/extension.ts`, `package.json` | 수정 | 명령·설정 순서·서비스 연결·새 테스트 등록 |
| `src/workspace.ts`, `src/analysis-worker.ts` | 수정 | 정책 전달, 기본 준비/상세 진행, 취소·세대·메모리·파생 결과 적용 |
| `src/analyzer.ts`, `src/flow-parser.ts`, `src/explicit-callbacks.ts` | 수정 | 기본 사실과 전체 전파 자료 분리, 명시적 등록·안전한 단순 연결 보존 |
| `src/function-arguments.ts` | 수정 | 전체 Flow IR 없이 수집한 literal 인자 사실과 상세 alias 결과 병합 |
| `src/project-analysis.ts`, `src/macro-expansion.ts` | 수정 | 선택 범위 확장과 누적 작업량, 미확장 이유 |
| `src/pointer-targets.ts`, `src/partial-callbacks.ts` | 수정 | 선택 범위 전파, 외부 변경·생략 영향, 불확실성의 국소화 |
| `src/incremental-analysis.ts`, `src/analysis-cache.ts` | 수정 | 정책·부분 결과·세대별 재사용과 자료 해제 |
| `src/copilot-context.ts`, `src/copilot-callbacks.ts`, `src/copilot-service.ts` | 수정 | 한 호출 조사·재확인·3종 응답·명시적 실행·캐시 |
| `src/callback-overrides.ts` | 신규 | 호출별 사용자 선택·동일성·저장 레코드·재확인 상태. VS Code 비의존 |
| `src/copilot-relations.ts`, `src/relations.ts` | 수정 | 원본/AI/사용자 표시층과 우선순위. 상호 Callers/Callees 처리 |
| `src/view-state.ts`, `src/view.ts` | 수정 | 호출별 액션 데이터와 검증된 Host 메시지·검색·복사 |
| `webview/callback-actions.ts` | 신규 | 기존 관계 팝업 안의 수동 선택·재확인·결과 비교 UI |
| `webview/local-progress.ts` | 신규 | 고정 진행 UI와 전체 함수명 스냅샷·복사 팝업 |
| `webview/main.ts`, `webview/styles.css` | 수정 | 기존 화면에 위 두 UI 연결, 그래프/포커스 유지 |
| `src/diagnostics.ts`, `webview/diagnostics.ts`, `src/issue-report.ts`, `src/issue-report-service.ts` | 수정 | 기본/상세·호출별 한도·새 설정 진단. 사용자 저장 정보의 불필요한 노출 없음 |
| `test/analysis-policy.test.ts`, `test/scoped-analysis.test.ts`, `test/analysis-budget.test.ts` | 신규 | 정책·기본 사실·범위 경계·작업량 |
| `test/callback-overrides.test.ts` | 신규 | 수동 선택·우선순위·동일성·변경 취소 |
| `test/analysis-performance.ts` | 신규 | Worker 종단 단계별 측정. 기존 인덱스 미세 벤치마크와 구분 |
| 기존 `test/*`, `test/ui.mjs`, `test/create-ui-fixture.ts` | 수정 | 실제 통합 경로와 회귀·접근성·레이아웃 |
| `README.md`, `USER_GUIDE.md` | 수정 | 영어 UI·범위 경계·설정 이관·수동 Copilot·사용자 확인 설명 |

## 4. 공유 계약

구현 순서에서 아래 계약을 먼저 도입한 뒤 사용한다. 기존 ID와 원본 자료를 사용자 입력 문자열로 대신하지 않는다.

### 4.1 로컬 정책과 호출 상태

`src/model.ts`에 아래 타입을 추가한다. `FileAnalysis`에는 `analysisPolicy?: FileAnalysisPolicy`, 기본용 간결한 `registrationPrograms?: FlowProgram[]`와 `registrationInitializers?: GlobalInitializer[]`를 추가하고, `ReferenceRecord` 및 `CallbackTargets`에는 `analysis?: CallAnalysisState`를 추가한다. undefined는 기존 분석기 직접 호출의 호환 경로이며 새 Worker에서는 항상 명시적으로 전달한다.

```ts
export interface FileAnalysisPolicy {
  expandMacros: boolean;
  propagateCallbacks: boolean;
}
export type CallAnalysisState = {
  status: 'pending' | 'complete' | 'out-of-scope' | 'missing-definition' |
    'work-limit' | 'memory-limit' | 'cancelled' | 'unresolved';
  reasons: string[];
};
export interface AnalysisWorkLimits {
  functionWork: number;
  projectWork: number;
}
```

`propagateCallbacks=false` 파일의 `programs`와 `initializers`는 전체 전파 자료를 보관하지 않는다. `registrationPrograms`와 `registrationInitializers`는 명시적 등록·안전한 단순 지역 포인터 연결용으로만 사용하는 작은 사실 모음이다. 전체 FlowProgram을 생성한 뒤 복사·필터링하는 방식으로 메모리 절감을 주장하지 않는다. literal function arguments는 기본 파싱에서 직접 수집해 `functionArguments`로 보존한다.

### 4.2 호출별 액션

`src/view-state.ts`에 브라우저와 Host가 함께 사용할 아래 계약을 둔다. `requestId`는 응답의 상관관계, `actionId`는 Host가 현재 그래프/호출에 발행한 불투명 액션 식별자다. 파일 경로·offset을 Webview 입력만 믿고 조작하지 않는다.

```ts
export type CallbackActionRequest =
  | { type: 'callbackSearch'; requestId: string; actionId: string; query: string }
  | { type: 'callbackSetTarget'; requestId: string; actionId: string; targetId: string }
  | { type: 'callbackAnalyze'; requestId: string; actionId: string; recheck: boolean }
  | { type: 'callbackUseSuggestion'; requestId: string; actionId: string; targetId: string; suggestionId: string }
  | { type: 'callbackRemoveOverride'; requestId: string; actionId: string }
  | { type: 'callbackCancel'; requestId: string; actionId: string };
export interface CallbackTargetChoice {
  id: string;
  name: string;
  location: Location;
  compatibility: 'compatible' | 'unknown' | 'incompatible';
  reason?: string;
}
```

Host 응답은 `type: 'callbackActionResult'`, 대응 `requestId`/`actionId`, 상태와 자료를 포함한다. 선택지·요청·현재 사용자 선택 revision이 바뀌면 늦은 응답을 폐기한다. 검색 결과는 입력과 매칭되는 함수 정의만 제공하며 반환 수를 제한해 UI를 멈추지 않게 한다. UI는 문자열을 HTML로 삽입하지 않고 기존 `textContent` 방식으로 렌더링한다.

### 4.3 서비스 경계

`registerCopilotCallbacks(context, workspace)`의 반환에 `actions`를 추가하고 `extension.ts`에서 `RelationView`에 전달한다. `actions`의 공개 메서드는 `search(actionId, query)`, `setTarget(actionId, targetId)`, `analyze(actionId, recheck)`, `useSuggestion(actionId, suggestionId, targetId)`, `removeOverride(actionId)`, `cancel(actionId)`다. 실제 반환 타입은 `src/copilot-service.ts`에서 export하고 위 요청·선택지 타입을 사용한다.

저장소는 `callback-overrides.ts`, VS Code 파일·설정·계정 I/O는 `copilot-service.ts`, 표시용 투영은 `copilot-relations.ts`, 메시지 검증·전달은 `view.ts`가 담당한다. 별도 전역 이벤트 버스나 새 IPC를 만들지 않는다.

## Task 1: 기준선과 결정적 재현 자료 확보

**Files:** 신규 `test/analysis-performance.ts`; 수정 `package.json`의 `scripts`; 참조 `test/analysis-worker.test.mjs`, `test/index-performance.ts`, 기존 `docs/reviews/2026-10-21-*.md`.

- [x] 기준 HEAD·Node·OS·소스 목록·설정·캐시 상태를 기록한다. 기존 미추적 조사/설계 파일은 그대로 둔다.
- [x] `test/analysis-performance.ts`를 Worker 종단 측정기로 작성한다. 입력은 CLI의 corpus 경로 하나, 출력은 `test-results/analysis-baseline.json`이다. 실패·한도·Worker 종료도 결과로 기록하고 성공처럼 종료하지 않는다. 이 측정기는 VS Code 사용자 설정을 수정하지 않는다.
- [x] 기존 Worker 테스트의 analyze/derive 프로토콜을 사용해 기본 자료 수신 시각, 매크로/콜백/transfer 시간, 최대 heap·external, 파일·함수·program·참조·후보·경고 수를 수집한다. Host는 받는 자료 보관량을 따로 기록한다. 기존 `index-performance.ts`는 관계 인덱스만 재므로 이 결과로 분석기 성능을 대신하지 않는다.
- [x] 동일 입력으로 legacy callbacks OFF/ON·매크로 전체/부분을 측정한다. 실행: `npx tsx test/analysis-performance.ts test-sources/FreeRTOS-Kernel`. 전체 입력의 Cold/Warm/1-file-save는 각각 새 실행으로 구분하고 수정 시험은 임시 복제본에서만 한다.
- [x] 일반 데이터와 독립적인 콜백, 다른 객체의 같은 멤버명, getter→3번째 인자→전역 저장→멤버 호출, callback array selector를 포함한 작은 C 재현을 측정기 안에 고정 fixture로 둔다. 기존 조사 파일의 과거 결과를 현재 측정값으로 복사하지 않는다.
- [x] `package.json`에 `test:analysis-performance` 명령을 추가한다. 출력에 환경·설정 fingerprint가 없거나 실패를 완전 결과로 보고하면 측정기 작업을 완료하지 않는다.

## Task 2: 순수 분석 정책과 설정 호환 계약

**Files:** 신규 `src/analysis-policy.ts`, `test/analysis-policy.test.ts`; 수정 `src/model.ts`.

- [x] `FileAnalysisPolicy`를 도입하고 `resolveAnalysisPolicy(relativePath, detailedFolders, legacy, nocase)`를 export한다. `detailedFolders`의 undefined는 미설정, `[]`는 명시적 OFF다. `legacy`는 `undefined` 또는 `{ macroFolders: readonly string[]; analyzeCallbacks: boolean }`다.
- [x] 다음 실패 테스트를 작성한다. 경로 패턴은 현재와 같은 minimatch 옵션(`dot`, `nonegate`, `nocomment`, `noext`, Windows `nocase`)을 사용한다.

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAnalysisPolicy } from '../src/analysis-policy';

test('explicit empty detailed folders overrides legacy all-on', () => {
  assert.deepEqual(resolveAnalysisPolicy('App/main.c', [],
    { macroFolders: ['**'], analyzeCallbacks: true }, false),
    { expandMacros: false, propagateCallbacks: false });
});
test('selected folder controls both expensive stages', () => {
  assert.deepEqual(resolveAnalysisPolicy('App/main.c', ['App/**'], undefined, false),
    { expandMacros: true, propagateCallbacks: true });
  assert.deepEqual(resolveAnalysisPolicy('SDK/main.c', ['App/**'], undefined, false),
    { expandMacros: false, propagateCallbacks: false });
});
test('legacy policies remain independent until a unified choice is saved', () => {
  assert.deepEqual(resolveAnalysisPolicy('SDK/main.c', undefined,
    { macroFolders: ['App/**'], analyzeCallbacks: true }, false),
    { expandMacros: false, propagateCallbacks: true });
  assert.deepEqual(resolveAnalysisPolicy('App/main.c', undefined, undefined, false),
    { expandMacros: false, propagateCallbacks: false });
});
```

- [x] 실행: `npx tsx --test test/analysis-policy.test.ts`. 새 모듈/기능 부재로 실패하는 것을 확인한다. 순수 함수를 최소 구현한 뒤 같은 명령과 `npm run typecheck`가 통과해야 한다.
- [x] 같은 파일에 Windows 경로 정규화·대소문자, `**`, 중첩 폴더, 서로 다른 multi-root 정책을 추가한다. Include/Exclude로 제외된 파일을 이 함수에 넘겨 다시 되살리는 경로를 만들지 않는다.

## Task 3: 영어 설정 순서와 상세 폴더 선택 UI 연결

**Files:** 수정 `package.json`, `src/macro-folders.ts`, `src/extension.ts`, `src/workspace.ts`; 신규 정책 테스트 확장; 수정 `test/extension.test.ts`, `test/workspace.test.mjs`, `test/branding-migration.test.ts`.

- [x] manifest 회귀로 `order`를 View(10–19), Include(20), Exclude(21), Detailed Analysis Folders(30), Analysis Options(40–49), Relation Display(50–59), Copilot(60–69), Updates(90) 순으로 검증한다. 기존 `automaticUpdates`는 제거하지 않고 마지막 Maintenance 항목으로 둔다. JSON 프로퍼티 순서만 바꾸고 UI 순서가 보장된다고 가정하지 않는다.
- [x] `dynsight.detailedAnalysisFolders`의 `scope: 'resource'`, `default: []`, `order: 30`과 영어 설명을 추가한다. `dynsight.selectDetailedAnalysisFolders` 명령은 `Dynsight: Select Detailed Analysis Folders`다. legacy 두 설정은 deprecated로 표시하고 하단 호환 항목으로 두며 새 사용자에게 중복된 기본 옵션처럼 안내하지 않는다.
- [x] 기존 파일의 폴더 선택 코드를 재사용해 체크 해제 전체는 `[]`, 전체 선택은 `['**']`, 취소는 미변경이 되게 한다. multi-root에서는 먼저 루트를 선택하고 그 루트의 설정에 저장한다. legacy 매크로 명령도 새 선택기로 연결하되 새 범위 적용 시 두 단계가 같이 바뀐다는 설명을 표시한다.
- [x] `workspace.ts`에서 `config.inspect()`로 새 설정 명시 여부와 legacy 명시값을 확인한다. legacy 캐시 증거는 기존 manifest를 읽어 작업 공간 상태로 남긴 뒤 새 캐시 버전을 초기화한다. 일반 파일·코드 내용으로 legacy 여부를 추측하지 않는다.
- [x] 정책 선택은 `analysis-policy.ts`에 위임하고 기본 Include/Exclude, `skipInactive`, 다중 루트 규칙을 유지한다. 새 설정 적용 시 active analysis 취소·revision 증가·범위 재조정·cache key 갱신을 연결한다. 다른 폴더의 사용자 설정을 전역으로 변경하지 않는다.
- [x] 실행: `npx tsx --test test/analysis-policy.test.ts test/branding-migration.test.ts` → `npm run test:worker` → `npm run test:extension`. 새 키 없는 신규/legacy/명시적 빈 목록/중간 설정 변경 모두 기대 정책이어야 한다.

## Task 4: 기본 사실과 전체 Flow IR 분리, 기본 탐색 먼저 공개

**Files:** 수정 `src/analyzer.ts`, `src/flow-parser.ts`, `src/explicit-callbacks.ts`, `src/function-arguments.ts`, `src/model.ts`, `src/workspace.ts`, `src/analysis-worker.ts`, `src/diagnostics.ts`, `src/view.ts`; 신규 `test/scoped-analysis.test.ts`; 수정 Worker/workspace 테스트.

- [x] `createAnalyzer().analyze(uri, text, skipInactive, policy?)`의 마지막 인자로 4.1 정책을 추가한다. 기존 직접 호출의 undefined 정책은 legacy 호환을 유지하고 새 Worker는 정책을 필수 전달한다. `FileAnalysis.analysisPolicy`와 Worker raw 레코드가 같은 정책을 보관하게 한다.
- [x] 기본 모드에서 매크로 정의·함수 본문 범위·직접 호출·literal function arguments·명시적 등록·안전한 단순 지역 연결을 수집하는 테스트를 먼저 추가한다. 예제:

```c
typedef void (*CB)(void);
void target(void) {}
void direct(void) {}
void accept(CB cb);
void run(void) { CB fp = target; direct(); accept(target); fp(); }
```

`run→direct`는 직접 호출, `target` 대입은 Registration, `accept(target)`은 인자 전달 사실, `fp()`는 지원되는 단순 후보로 남아야 한다. `accept`가 `fp` 주소를 받은 뒤 호출하거나 중간에 `fp=other`/조건부 쓰기가 있으면 이전 대상을 확정하지 않는 실패 회귀도 작성한다.

- [x] `flow-parser.ts`의 수집 모드에 따라 처음부터 간결한 등록 프로그램 또는 전체 프로그램을 만든다. 기본 모드에서 전체 Flow IR 생성 후 폐기하는 구현은 거부한다. 명시적 추출에 필요한 scope·조건·unknown overwrite를 유지하고 큰 일반 데이터 초기화를 무조건 펼치지 않는다.
- [x] `explicit-callbacks.ts`는 기본 모드의 `registrationPrograms/registrationInitializers`를 사용하고 전체 전파기는 이를 소비하지 않게 한다. 기본 추출은 큰 정수 배열 초기화 IR을 보관하지 않되 초기화에 콜백 등록이 포함된 경우 해당 사실을 유지한다. `FunctionArguments`는 새 literal 사실을 기존 IR 재순회로 지우지 않고 상세 alias 결과와 중복 없이 병합한다. alias-derived 인자는 상세 분석이 필요함을 표시한다.
- [x] 저장된 기본 파일 목록과 원본 사실이 준비되면 `basicReady` 상태/이벤트를 공개한다. 상세 진행에는 별도 단계·완료 세대를 둔다. 기본 준비가 부분 파싱 실패와 완전 성공을 구분하도록 하고 `stable`의 기존 캐시·파생 일치 의미는 유지한다.
- [x] `copilotSnapshotReady`는 저장된 기본 사실·유효 revision을 검사한다. 상세 분석 중/중단/부분 상태는 허용하고, dirty source·기본 작업 중·Worker 중단·인덱스 손상은 구분해 막는다. 아직 이 단계에서는 네트워크 요청을 만들지 않는다.
- [x] 검증: `npx tsx --test test/scoped-analysis.test.ts test/explicit-callbacks.test.ts test/function-arguments.test.ts`와 `npm run test:worker`. 상세 결과를 지연시키는 Worker fixture에서 기본 탐색이 먼저 되고 Stop 후에도 기본 결과가 보존되어야 한다.

## Task 5: 실제 상세 범위와 외부 효과 경계 적용

**Files:** 수정 `src/analyzer.ts`, `src/project-analysis.ts`, `src/pointer-targets.ts`, `src/partial-callbacks.ts`, `src/incremental-analysis.ts`; `test/scoped-analysis.test.ts`, `test/callback-safety.test.ts`, `test/macros.test.ts` 확장.

- [x] `analyzer.derive()`의 기존 boolean 호환은 유지하되 파일별 `analysisPolicy`가 설정된 입력에서는 매크로와 콜백 각각 해당 플래그만 적용한다. `programs`, `initializers`, reference flowKey를 한꺼번에 모든 파일에서 펼치는 현재 경로를 정책별로 분리한다.
- [x] 선택 밖 헤더의 정의로 선택 안의 `#define RUN() target()`을 확장하는 회귀를 추가한다. 선택 밖 함수의 매크로 본문은 확장하지 않아야 한다. literal header가 Exclude로 빠지면 정의 누락 이유를 남겨야 한다.
- [x] 선택 안 호출에 필요한 외부 타입·등록 사실은 참조하되 외부 함수의 전체 요약을 생성하지 않는다. 외부 함수 호출이 관련 객체/전역 콜백을 쓸 수 있으면 불확실성을 남긴다. 이름이 같은 외부 멤버와 함수를 무조건 붙이지 않는다.
- [x] 다음 경계 fixture를 검증한다: 외부 getter 본문이 필요하면 `out-of-scope`; 선택 안으로 getter 폴더를 추가하면 기존 getter→인자→전역 호출 연결 복원; 외부 unknown helper가 전역 cb를 바꾸는 경우 이전 대상을 complete로 유지하지 않음; 다른 객체와 무관한 정수 쓰기는 별도.
- [x] `partial-callbacks.ts`도 상세 범위와 제한 상태를 따라야 한다. full propagation을 건너뛴 뒤 부분 후보 경로가 같은 무거운 전파를 다시 수행하지 않게 한다. 기본 명시적 등록 투영은 전체 기본 범위에서 유지한다.
- [x] 검증: `npx tsx --test test/scoped-analysis.test.ts test/macros.test.ts test/pointer-calls.test.ts test/callback-safety.test.ts test/callback-uncertainty.test.ts`. 정책 교체 후 scope 밖 참조가 오래된 inferred call로 남지 않아야 한다.

## Task 6: 누적 작업량과 호출별 불확실성 보존

**Files:** 신규 `src/analysis-budget.ts`, `test/analysis-budget.test.ts`; 수정 `src/model.ts`, `src/macro-expansion.ts`, `src/project-analysis.ts`, `src/pointer-targets.ts`, `src/analysis-notices.ts`, `src/diagnostics.ts`, `webview/diagnostics.ts`.

- [x] `AnalysisWorkBudget`는 생성 시 `AnalysisWorkLimits`를 받고 `consume(functionId, units)`가 `'ok' | 'function-limit' | 'project-limit'`를 반환하게 한다. 함수 ID별 수치는 동일 derive의 여러 라운드에 누적하고 global 비용도 포함한다. 소수·음수 비용은 내부 호출에서 생성하지 않는다. 이 유틸을 통해 메모리·취소와 작업량 판단을 혼동하지 않는다.
- [x] 다음 실패 테스트를 작성하고 `npx tsx --test test/analysis-budget.test.ts`로 red→green을 확인한다.

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisWorkBudget } from '../src/analysis-budget';
test('per-function work does not reset between propagation rounds', () => {
  const budget = new AnalysisWorkBudget({ functionWork: 3, projectWork: 20 });
  assert.equal(budget.consume('run', 2), 'ok');
  assert.equal(budget.consume('other', 1), 'ok');
  assert.equal(budget.consume('run', 2), 'function-limit');
});
test('many small functions still hit the project work bound', () => {
  const budget = new AnalysisWorkBudget({ functionWork: 10, projectWork: 3 });
  assert.equal(budget.consume('a', 2), 'ok');
  assert.equal(budget.consume('b', 2), 'project-limit');
});
```

- [x] `CallbackAnalysisOptions`에 `workLimits?: AnalysisWorkLimits`를 추가한다. 테스트와 엔진 내부 한도 조정용이며 사용자 설정으로 공개하지 않는다. Worker는 제품 기본값을 전달하고 예산은 derive 실행 하나에 하나만 둔다. incremental component마다 한도를 초기화하지 않는다.
- [x] 매크로의 token/substitute/variant/include 반복과 콜백 eval/summary 반복에 비용을 연결한다. 지출 한도는 AST 크기 등으로 실제 작업과 비례하게 센다. 단일 함수 한도는 해당 요약을 불완전으로 만들고, 전체·메모리·수동 취소는 실행 전체 추가 작업을 중단한다. tree-sitter parse처럼 동기적으로 중간 취소할 수 없는 구간은 확장 토큰 상한으로 입력을 먼저 제한하고 이 한계를 진단에 기록한다.
- [x] `projectIncomplete`를 단순 제거하지 않는다. 생략 객체/효과가 연결된 호출에는 이유를 전달한다. 관련 저장소를 추적할 수 없는 전역 변경·생략 bookkeeping 한도는 보수적인 넓은 불확실성을 유지한다. 아직 관측하지 못한 raw indirect call에도 `analysis.status`와 이유를 남긴다.
- [x] callback relevance 최적화는 기존 엔진에서 확인된 동작만 활용한다. 해당 fixture가 실패할 때만 최소 보완한다. scalar logger·array selector·guard copy·struct callback copy·두 객체 같은 필드·no-argument global writer를 회귀로 검증한다. 이미 작동하는 scalar 의존성 알고리즘을 재작성하지 않는다.
- [x] 검증: `npx tsx --test test/analysis-budget.test.ts test/callback-effects.test.ts test/callback-uncertainty.test.ts test/callback-safety.test.ts test/analysis-notices.test.ts test/macros.test.ts`. 낮은 주입 한도에서 영향을 안 받는 콜백은 보존되고 실제 영향은 불확실해야 한다. 경고가 단순히 사라졌다는 사실로 성공을 판단하지 않는다.

## Task 7: 범위·중단·버전별 Worker 캐시와 자료 해제

**Files:** 수정 `src/analysis-worker.ts`, `src/workspace.ts`, `src/incremental-analysis.ts`, `src/analysis-cache.ts`, `test/analysis-cache.test.ts`, `test/incremental-analysis.test.ts`, `test/analysis-cache-worker.test.mjs`, `test/workspace.test.mjs`, `test/analysis-memory.test.ts`.

- [x] Worker analyze/cache-restore/raw 레코드와 cache manifest의 `expandMacros`만 있던 정책을 두 플래그로 확장한다. `analysisKey`, incremental seed/derive 키에 루트별 정책·분석 계약 버전을 포함한다. 계획 작성 시 캐시 버전은 3이었으나 실행 시작 시 기존 변경으로 4였다. 새 형식은 **5**로 올리고 기존 파일을 추측 변환하지 않는다. 패키지 버전과 혼동하지 않는다.
- [x] 분석 자료 범위가 변하면 관련 raw/derived 프로그램·매크로 캐시·함수 요약을 해제한다. scope shrink 뒤에도 이전 프로그램이 WeakMap/closure/derivedSnapshot/Host snapshot에 계속 붙잡히지 않게 한다. Worker의 `forIndex`와 캐시의 `workerFields`에 새 기본용 IR 필드도 반영해 Host에는 최종 기본 참조·등록만 전달한다. AI와 사용자 오버레이는 Worker 저장 대상이 아니다.
- [x] complete/partial/pending 상태를 저장한다. 한도·취소 결과를 완전 결과로 seed하지 않으며 부분 캐시 복원은 불완전 표시와 명시적 Retry 경로를 유지한다. 자동 무한 derive/retry를 만들지 않는다.
- [x] 세대 변화·범위 축소·저장 중·cache read I/O 뒤·Worker 응답 적용 직전의 revision/epoch/policy fingerprint를 확인한다. 구세대 응답·캐시 완료가 새 설정의 후보나 자료를 복원하지 못하게 한다.
- [x] 검증: `npm run test:worker`와 `npm run test:memory`. full→small→empty→full, 설정 변경 중 활성 Worker, 오래된 disk read, 캐시 손상/버전 차이, 취소 뒤 재시작, 여러 루트 각각의 정책을 확인한다. GC 검증은 기존 테스트처럼 job 경계와 `WeakRef`를 사용하고 임의의 heap byte 합격선을 단위 테스트에 넣지 않는다.

## Task 8: 호출별 Copilot 컨트롤러와 응답 계약

**Files:** 수정 `src/copilot-callbacks.ts`, `src/copilot-context.ts`, `test/copilot-callbacks.test.ts`, `test/copilot-progress.test.ts`.

- [x] `CopilotCallbackController`에 `analyzeSite(snapshot, siteKey, { recheck: boolean })`를 추가하고 startup `restore()`는 캐시 조회만 하게 한다. `recheck=false`는 유효한 해당 cache 사용, true는 해당 site만 우회한다. 전체 force 삭제 경로로 재확인을 구현하지 않는다.
- [x] `siteKey`가 실제 snapshot의 호출이고 허용 URI에 속하는지 먼저 검사한다. 한 호출의 문맥만 구성하고 해당 결과를 기존 다른 hint Map에 merge한다. 단건 업데이트가 모든 파일의 AI 후보를 지우는 현재 `onHints`/projection 사용 실수를 회귀로 막는다.
- [x] 응답 스키마를 versioned JSON으로 확정한다. 상태는 `candidates | insufficient-context | not-found`, 후보는 기존 offered `targetId/evidenceIds/reason` 및 `conditions: string[]`, `uncertainties: string[]`, 추가 필요 정보는 `missing: string[]`다. 상태별 후보 배열의 일관성과 현재 크기 제한을 검증한다. 모델에 임의 경로·새 심볼을 생성하게 하지 않는다.
- [x] source prompt를 설계 7.4의 계약으로 갱신한다. 사용자 선택은 검증 대상 자료로 전달하고 정답으로 가정하지 않는다. source comments/strings는 비신뢰 자료다. user-confirmed·AI overlay를 근거로 다시 수집하지 않는다.
- [x] cache version과 digest에 새 schema/prompt·model/version·소스 검색 dependencies와 negative lookup inventory를 포함한다. 후보가 없던 이름의 새 파일/등록이 추가됐을 때도 이전 `not-found`를 최신으로 재사용하지 않는다. 모델 변경은 그 모델 캐시만 사용한다.
- [x] 실패 회귀를 작성한다: 8 sites에서 한 site만 요청하면 provider 1회; 유효 캐시 재사용은 0회; recheck는 같은 site 1회; 다른 7개 hint 유지; 잘못된 evidence ID 거부; insufficient-context 구분; Stop/소스 변경 뒤 응답 무효화; 응답 스키마 버전 차이.
- [x] 검증: `npx tsx --test test/copilot-callbacks.test.ts test/copilot-progress.test.ts`. 기존 ‘38개 전체 자동 처리’ 테스트는 새 수동 정책에 맞춰 대체하고 캐시·취소·누적 보존의 실질적 검증은 유지한다.

## Task 9: Copilot Host의 자동 실행 제거와 액션 진입점

**Files:** 수정 `src/copilot-service.ts`, `src/extension.ts`, `src/diagnostics.ts`, `webview/diagnostics.ts`, `package.json`, `test/copilot-service.test.ts`, `test/extension.test.ts`.

- [x] `automatic/deferredReason/pendingChange`가 저장·설정·settled 이벤트로 새 provider 요청을 만드는 경로를 제거한다. Include 자동 복사와 모델 선택 시 분석 시작도 제거한다. 기존 기본 범위 밖 파일은 snapshot 자료로 넣지 않는다.
- [x] 반환 `actions` 계약을 도입한다. 처음 `Find target with AI`와 `Recheck with AI`는 계정·모델·허용 범위를 확인한 뒤 단건 controller를 호출한다. 서비스의 startup/settings/save/rebuild 이벤트는 취소·cache restore만 한다.
- [x] 기존 명령 `analyzeCallbacksWithCopilot`/`reanalyzeCallbacksWithCopilot`는 전역 일괄 요청을 하지 않는다. 현재 호출 컨텍스트를 받거나 eligible call 목록을 QuickPick으로 하나 선택하게 하고, 명확히 선택된 site 하나만 처리한다. 모델 선택·설정 열기만으로 Copilot을 활성화하지 않는다. 첫 명시적 분석 요청의 기존 접근 허가 흐름은 유지한다.
- [x] `copilotSnapshotReady`를 사용해 저장된 기본 인덱스가 유효하면 local paused/limited 상태에서도 요청할 수 있게 한다. 메모리가 부족하면 Host 문맥 구성에서 크기를 제한하고 실패 이유를 표시한다. Worker 종료·dirty input은 요청을 만들지 않는다.
- [x] `test/copilot-service.test.ts`의 기존 harness를 확장한다. 시작·enable·모델 변경·Include 변경·저장·rebuild 각각 calls=0; 한 site 요청 calls=1; 다른 site 부수 요청=0; 범위 제외·미저장·Stop 중 picker·활성 요청 모델 변경·timeout의 지연 응답 무효화를 검증한다. 자료가 유효한 local Stop 후 단건 조사 성공도 별도 검증한다.
- [x] 검증: `npx tsx --test test/copilot-service.test.ts test/copilot-callbacks.test.ts`와 `npm run typecheck`. `copyIncludeScopes()` 같은 자동 범위 변경이 잔존하지 않는지 검색하고 명령 제목·영어 설정 설명의 ‘batches of 5’를 제거한다.

## Task 10: 사용자 선택 레코드와 동일성 검증

**Files:** 신규 `src/callback-overrides.ts`, `test/callback-overrides.test.ts`; 수정 `src/model.ts`, `src/copilot-service.ts`, `src/type-info.ts` 및 관련 타입 추출 테스트.

- [x] `CallbackOverrideStore`를 VS Code 비의존 순수 모델로 만든다. `set(record)`, `remove(key)`, `records()`, `revision(key)`를 제공하고 직렬화 레코드는 `version:1`, root+relative source URI, owner/표현식/주변 토큰 anchor, 원래 AI target, 선택 target anchor, dependency digests, 검토 상태를 포함한다. 함수명이나 offset 하나만을 키로 삼지 않는다.
- [x] 모델은 실시간 `targetId`와 offset을 재계산해 표시한다. 앞쪽 공백·주석·줄 삽입으로 위치만 옮겨도 유일한 소유 함수·call anchor·정의 지문이 같을 때만 복원한다. 같은 호출식 여러 개·owner/body 변경·의존 정의 변경·삭제·다른 루트·target 이름 재사용은 `needs-review` 또는 inactive로 보관하고 연결하지 않는다.
- [x] 저장은 기존 `ExtensionContext.workspaceState`의 단일 versioned 키에 맡긴다. AI 캐시 디렉터리·`.vscode/settings.json`·원본 소스에 쓰지 않는다. write는 직렬화하고 `await update()` 성공 뒤 적용 완료를 표시한다. 실패하면 기존 유효 선택을 보존하고 사용자에게 실패를 알린다. Rebuild와 model reset으로 삭제하지 않는다.
- [x] 검색은 새 문자열 함수를 만들지 않고 실제 정의 목록에서 선택한다. 이름·경로로 동명 구분한다. 타입 검증은 현재 자료로 증명할 수 있는 반환/매개변수/variadic 정보만 비교한다. 필요한 함수 서명 자료를 `SymbolRecord`에 optional로 추가하고 기존 typedef 타입 해석을 재사용한다. 알 수 없는 ABI·임의 typedef 이름 비교로 호환성을 확정하지 않는다.
- [x] 회귀 fixture는 두 파일을 사용한다. `table.c`의 `static void handler(void)`를 공개 getter가 반환한 테이블에 넣고 `run.c`에서 포인터 호출한다. manual target으로 handler 선택은 허용되어야 한다. 선언/정의 ID 통합·다른 파일의 동명 static 구분·명백한 함수 매개변수 수 차이는 별도 검증한다.
- [x] `CallbackOverrideStore` 단위 테스트는 set/remove serialize-reload, 충돌 없는 두 sites, 선택 revision 증가, 줄 이동/중복 anchor/정의 변경/의존성 변경을 확인한다. 단순 수동 선택에서 provider 호출은 0회다.
- [x] 검증: `npx tsx --test test/callback-overrides.test.ts test/members.test.ts test/copilot-service.test.ts`.

## Task 11: AI/사용자 표시 오버레이와 탐색 일관성

**Files:** 수정 `src/copilot-relations.ts`, `src/relations.ts`, `src/model.ts`, `src/view-state.ts`, `src/workspace.ts`, `src/copilot-service.ts`; 수정 `test/copilot-relations.test.ts`, `test/core.test.ts`, `test/analysis-cache-worker.test.mjs`.

- [x] `CallKind`에 `'user-confirmed'`를 추가한다. `ReferenceRecord`의 사용자 표시 메타데이터는 `manual?: { overrideKey: string; originalTargetId: string }`로 둔다. Badge는 CallKind, 근거는 provenance에 의해 결정하며 `inference.incomplete=true`를 유지한다.
- [x] `rg -n 'ai-candidate|CallKind' src webview test`로 후보 특수처리 목록을 확인한다. `resolveAt`, `callbackAt`, `aiReplacements`, preview·확장·context 문맥 수집·UI badge를 포함해 user-confirmed 분기를 빠짐없이 추가한다. 새 kind를 source fact로 오인하지 않는 회귀를 둔다.
- [x] 현재 `applyCallbackHints()`를 기본/파생 사실의 원본을 보존한 표시 투영으로 확장한다. Worker와 AI snapshot을 만들 때 `ai-candidate`와 `user-confirmed`를 둘 다 제외한다. 같은 Host에 전체 두 번째 인덱스를 만들지 않고 base file/reference identity를 재사용한다. clear/model reset은 AI 층만 갱신하고 active override는 다시 투영한다.
- [x] 선택한 `(call anchor, original AI target)`만 교체한다. Callers/Callees/References/combined/cursor callbackAt/Context 이동/확장/nodePreviewId/canExpandNode 모두 같은 새 target을 사용한다. graph snapshot key에 overlay revision을 포함한다. 다른 호출, 등록 사실, 독립적인 로컬 후보를 삭제하지 않는다.
- [x] 기존 local partial과 같은 AI 후보를 가리는 `relations.ts` 로직도 새 provenance를 구분하게 한다. 후보 그룹 하나에 AI·User·local sites가 섞이면 각 site의 배지를 보존한다. 모든 sites가 User confirmed인 것처럼 묶지 않는다. 이미 있는 target과 수동 결과가 같으면 duplicate node/site를 만들지 않는다.
- [x] 회귀를 먼저 추가한다: wrong AI→manual correct에서 해당 AI call은 wrong의 Callers에서 없어지고 correct의 Callers에 1개; 다른 caller의 wrong AI와 독립적인 direct wrong은 유지; callbacks OFF/Copilot OFF에도 유효 manual 표시; model reset/rebuild 후 manual 유지; remove만 하면 현재 유효 AI 또는 unresolved 복귀; Worker cache에 overlay가 없음.
- [x] 검증: `npx tsx --test test/copilot-relations.test.ts test/callback-overrides.test.ts test/core.test.ts test/function-arguments.test.ts`와 `npm run test:worker`.

## Task 12: 두 팝업의 수동 지정·AI 재확인·결과 비교

**Files:** 신규 `webview/callback-actions.ts`; 수정 `src/view-state.ts`, `src/view.ts`, `src/copilot-service.ts`, `src/extension.ts`, `webview/main.ts`, `webview/styles.css`, `test/create-ui-fixture.ts`, `test/ui.mjs`, `test/extension.test.ts`, `test/copilot-service.test.ts`.

- [x] 4.2 메시지를 `RelationView.handleMessage()`에 연결한다. `requestId/actionId/query/targetId` 타입·길이·존재를 검사하고 Host가 발행한 현재 site를 해석한다. 그래프의 합쳐진 node key만으로 호출을 추정하지 않는다. 여러 sites면 파일·줄·표현식으로 먼저 호출 선택을 요구한다.
- [x] `callback-actions.ts`는 기존 `showDetails()` 안에 액션 구역을 붙인다. AI candidate와 User confirmed 두 상태에 `[Set manually] [Recheck with AI]`를 표시한다. host가 eligible하지 않다고 응답하면 이유를 표시하고 AI 설정을 몰래 켜지 않는다.
- [x] Set manually는 현재 이름을 채운 입력, bounded indexed-function 결과, 경로·위치, Apply/Cancel을 제공한다. 키보드 검색·방향키·Enter 선택·Tab 적용·Esc 취소를 지원한다. unknown/incompatible 표시를 유지한다. 실제 source rename 동작과 연결하지 않는다.
- [x] 수동 편집·검색 결과·미선택 AI 제안은 popup state로 유지한다. diagnostics tick/graph refresh가 focus/input을 초기화하지 않도록 DOM identity를 보존한다. anchor가 사라져도 편집 중에는 popup을 임시 고정하고, stale save는 막는다. 종료 후 존재하는 anchor에만 focus를 돌려준다.
- [x] 재확인은 원래 AI candidate면 새 검증된 hint로 해당 site만 갱신한다. User confirmed면 같은 결과는 `AI agrees`, 다른 결과는 `AI suggests a different target`과 `Use this target`으로 비교한다. 클릭 시 suggestionId/targetId와 override revision을 재검증해 user-confirmed로 저장한다. 실패·취소·자료 부족은 manual을 유지한다.
- [x] 기존 fixture에 AI 후보 두 개·두 호출 site·수동 결과·같은/다른 AI 응답·자료 부족·stale 응답을 추가한다. UI bridge에서 단건 요청과 Host 응답을 모의한다. 실제 Copilot 계정을 UI 자동 테스트에 연결하지 않는다.
- [x] Playwright 회귀: 두 상태의 버튼 존재, 직접 입력 저장 뒤 그래프·badge 변화, Cancel/Esc 무변경, 동명 선택, 다른 AI 제안 명시 적용, AI 기다리는 중 manual 변경 후 응답 무효화, popup 키보드·마우스 유지, 클릭이 graph drag/double-open으로 전파되지 않음.
- [x] 검증: `npm run test:ui`, `npm run test:extension`, `npx tsx --test test/copilot-service.test.ts test/copilot-relations.test.ts`. 테스트는 CSS 문자열만 확인하지 않고 실제 user interaction과 전송된 메시지·표시 관계를 확인한다.

## Task 13: Stop local 고정 배치와 단계 표시

**Files:** 신규 `webview/local-progress.ts`; 수정 `webview/main.ts`, `webview/styles.css`, `src/diagnostics.ts`, `src/view-state.ts`, `test/ui.mjs`.

- [x] 기존 `renderLocal()`를 새 progress UI로 옮기되 DOM 노드는 한 번 생성한다. 텍스트 영역, 함수명 trigger, 액션 영역을 분리한다. diagnostics 갱신마다 `replaceChildren()`로 버튼을 새로 만들지 않는다.
- [x] container grid를 `minmax(0, 1fr) <fixed-action-width>`로 구성하고 텍스트는 `min-width:0; overflow:hidden; text-overflow:ellipsis`를 적용한다. 액션 폭은 Stop local/Stopping…/Retry local 중 가장 긴 라벨을 담게 정한다. 좁은 패널은 container width 기준으로 액션을 고정 별도 행에 배치한다. 본문 길이에 따른 wrap을 금지한다.
- [x] 기본 준비·상세 진행과 단계·부분 결과를 영어로 표시한다. 기존 round/function/elapsed/diagnostic 정보는 별도 상세 설명에 유지한다. Stop 클릭 즉시 해당 버튼을 같은 크기의 `Stopping…`으로 비활성화하고 Host 취소 상태로 마무리한다. 실제 running 완료 전 중단됐다고 표시하지 않는다.
- [x] UI 테스트에서 900/600/320px 패널을 만들고 `.local-progress`의 Stop boundingBox를 짧은 이름·긴 이름·큰 숫자·stage 변화·Stopping…에서 비교한다. 동일 패널 너비에서 좌표/크기는 CSS 픽셀 반올림 허용오차 1px 이내여야 한다. body overflow와 hidden action도 검사한다.
- [x] 검증: `npm run test:ui`. 기존 graph node DOM identity와 포커스 보존 검증도 통과해야 한다. 이 UI가 `Stop Copilot` 요청을 보내지 않는지 메시지 종류를 확인한다.

## Task 14: 전체 함수명 팝업·선택·복사

**Files:** 수정 `webview/local-progress.ts`, `webview/main.ts`, `webview/styles.css`, `src/view.ts`, `test/ui.mjs`, `test/extension.test.ts`.

- [x] 함수 trigger의 hover/focus에 selectable dialog를 열고 전체 이름을 plain text로 넣는다. 현재 함수 이름의 snapshot을 열 때 한 번 잡고 진행 갱신이 열린 popup을 바꾸지 않게 한다. 긴 이름은 wrap하고 패널 경계에 맞춰 위치만 조정한다.
- [x] trigger→popup 이동·드래그 선택·Copy 버튼·Tab 순서를 지원한다. popup 내부에 pointer/focus가 있는 동안 닫지 않고 Esc는 닫기와 focus 복귀다. 이 팝업이 열린 상태에서 관계 팝업을 열면 입력·선택 상태를 확인한 뒤 기존 공통 dismiss 규칙으로 하나만 유지한다.
- [x] Copy는 snapshot 문자열만 Host로 보내고 `vscode.env.clipboard.writeText()`의 성공 응답 후 `Copied`를 표시한다. 메시지는 `{ type:'copyFunctionName', requestId, name }`, 응답은 `{ type:'copyFunctionNameResult', requestId, ok }`다. Host는 짧은 문자열 타입·상한을 확인한다. 성공 전에 clipboard를 읽어 되돌려 보내거나 임의 명령을 실행하지 않는다.
- [x] 실패는 `Could not copy. Select the name and copy it manually.`로 표시하고 수동 선택을 유지한다. 실패·늦은 응답은 다른 popup에 Copied를 표시하지 않는다. Copy로 인한 새 분석이나 graph navigation은 없어야 한다.
- [x] Playwright bridge에 clipboard stub을 넣어 A 이름 popup을 연 뒤 B 진행 갱신에도 Copy 값이 A인지 검사한다. 닫고 다시 열면 B, mouse selection 가능, 키보드 열기/Tab/Enter/Esc, 실패 표시, panel edge positioning을 검증한다. native extension 시험에서 실제 clipboard API에 snapshot이 전달되는지도 확인한다.
- [x] 검증: `npm run test:ui`와 `npm run test:extension`. 반복 progress tick이 Stop 버튼과 열린 popup의 내용을 교체하지 않아야 한다.

## Task 15: 문서·진단·전체 회귀와 성능 판단

**Files:** 수정 `README.md`, `USER_GUIDE.md`, `package.json`, `src/issue-report.ts`, `src/issue-report-service.ts`, 관련 진단 테스트; 실행 산출물 `test-results/`.

- [x] 새 unit test 파일을 `npm test`의 명시적 목록에 등록한다. manifest 영어 문구와 USER_GUIDE의 설정 순서·legacy 이관·빈 목록·AI 수동 정책·버튼 의미를 함께 갱신한다. 기존 ‘5개씩 자동’, 저장 후 자동 요청, 단순 `Index ready`로 전체 완전성을 암시하는 안내를 고친다.
- [x] issue-report의 설정 allowlist에 detailed 폴더와 새 정책 상태를 추가한다. 사용자 override 전체 저장소·clipboard·Copilot prompt를 자동 첨부하지 않는다. 기존 진단의 rebuild reason·callback counts·Worker 오류 보존 회귀를 유지한다.
- [x] 실행 순서: `npm run typecheck` → `npm test` → `npm run test:worker` → `npm run test:memory` → `npm run test:ui` → `npm run test:extension`. 처음부터 모든 장시간 시험을 반복하지 말고 앞 단계 실패를 먼저 고친다. 통과 수치는 실제 실행 결과만 기록한다.
- [x] corpus 검증: `npm run test:freertos`, `npm run test:large`를 실행하되 기존 native runner의 환경 경로가 플랫폼에 맞는지 먼저 확인한다. FreeRTOS는 새로운 상세 기본값 때문에 propagation이 OFF인 실행과 full 상세 실행을 구분한다. 기본 탐색 PASS로 전체 콜백 동등성을 주장하지 않는다.
- [x] 작업 1 측정기를 동일 입력·동일 환경에서 다시 실행한다. basic/partial/full에 대해 Cold/Warm/1-file-save, 기본 준비 시간, macro/callback/transfer, 최대 Worker/Host heap·external, retained full programs, 후보·누락·경고·Stop 응답을 비교한다. 설정 변경으로 제외된 관계는 정확도 향상/회귀와 구분한다.
- [x] 합격 판단: basic 범위에서 full propagation IR이 남지 않음; 범위 축소에 따라 full-program 수와 retained 자료가 실제 감소; 기본 탐색이 상세 종료보다 먼저 준비; Stop/한도에서 유효 기본 관계 유지; 알려진 직접 호출·등록 fixture 누락 0; 잘못된 새 확정 연결 0; 새 자동 AI 요청 0. 실제 시간·메모리 목표 수치는 기준선 표와 함께 기록하고 측정 전 보장하지 않는다.
- [ ] Windows SafeRTOS/Wind River 사용 환경에서 소스 폴더만 열기, 경로·multi-root, 기본/상세 범위, 팝업/Copy/Set manually를 확인한다. 해당 환경이 없으면 미검증으로 남기고 macOS 결과로 대체하지 않는다. 빌드 툴체인을 설치하거나 소스 컴파일을 요구하지 않는다.
- [ ] LLM 20–30개 실제 콜백 평가는 사용자에게 허용된 자료·계정에서만 명시적으로 실행한다. 로컬 mock 통과는 모델 정확도 검증이 아니다. 정답 후보·오연결·누락·판단 보류·응답 시간을 분리해 기록한다. 이 평가 전에도 manual confirm 동작은 mock으로 기능 검증할 수 있다.
- [x] 마지막으로 `git diff --check`, `git diff --stat`, `git status --short`를 확인하고 설계 요구사항과 실제 파일 변경을 대조한다. 버전 증가·VSIX 생성·설치·push·배포는 별도 요청 전에는 진행하지 않는다.

## 5. 상태·회귀 검증 매트릭스

| 조건 | 기본 관계 | 상세/AI/사용자 결과 |
| --- | --- | --- |
| 새 작업 공간, 상세 `[]` | 직접 호출·literal arguments·등록·안전한 단순 연결 | 상세 대상 없음, 자동 AI 없음 |
| 상세 `App/**`, SDK 정의 있음 | 양쪽 기본 사실 유지 | App만 상세, 외부 정의 참고, 외부 본문 필요 시 out-of-scope |
| legacy 매크로 일부·callback ON | 기존 범위 유지 | unified 적용 전 각 플래그 독립 |
| 전체 함수 한도·메모리·Stop | 완료 기본 결과 유지 | 원인별 partial state, 수동 AI는 유효 snapshot에서만 |
| AI candidate 팝업 | source call/evidence 유지 | Set manually + Recheck with AI |
| 직접 target 적용 | 기존 독립 local 관계 유지 | 해당 candidate만 User confirmed, 상호 탐색·Context 일치 |
| User confirmed에서 AI 다른 후보 | 기존 사용자 연결 유지 | 비교와 Use this target, 적용 후에도 User confirmed |
| Rebuild·모델 변경·Copilot OFF | 새로운 current base 반영 | valid override 유지, 새 자동 AI 없음 |
| 호출/target/의존 코드 변경 | 최신 기본 관계 | stale overlay 미적용, Needs review |
| 긴 함수명·진행 갱신 | 그래프/포커스 유지 | Stop 고정, 열린 이름 snapshot·Copy 고정 |

## 6. 설계 요구사항 대응표와 실행 종료점

| 설계 구역 | 구현 작업 |
| --- | --- |
| 1–3 목표·근거·비교안 | 작업 1 기준선, 정책 결정 1–8, 작업 15 환경 한계 |
| 4 설정 순서·영어 UI | 작업 2–3, 12–15 |
| 5 기본·상세·외부 경계·자료 | 작업 4–5, 7 |
| 6 작업량·불확실성 | 작업 6–7 |
| 7.1–7.5 호출별 Copilot·프롬프트·캐시 | 작업 8–9, 15 |
| 7.6 User confirmed·재확인·보존 | 작업 10–12 |
| 8 Stop 고정·전체 이름 복사 | 작업 13–14 |
| 9 설정 이관·진행 상태 | 작업 3–4, 7, 13 |
| 10 검증 | 각 작업의 focused checks + 작업 15 + 상태 매트릭스 |
| 11 후속 범위 | 작업 범위 표의 제외 사항 유지 |

계획 작성의 종료점은 문서 완성과 자체 검토다. 설계서와 비교해 기능 누락·UI 영어 문구·정책 모순·새 파일 책임·명령의 존재를 확인한다. **이 문단은 계획 작성 당시의 종료점이며 이후 실행 승인을 받았다.** 구현 전에는 실제 HEAD·로컬 지침·미추적 파일과 기준선을 다시 확인하며, 이 문서의 체크박스는 실행한 항목만 완료 처리한다.
