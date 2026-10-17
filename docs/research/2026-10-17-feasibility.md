# Relation + Context 확장 구현 가능성 검토

검토일: 2026-10-17. 범위: 구현 전 기술 검토. 제품 확장은 작성하거나 실행하지 않았다.

## 결론

메인 코드의 함수 선택 → 관계 그래프 → 선택 위치의 Context 미리보기, 아이콘 구분, 단계 확장은 VS Code 공개 API로 구성할 수 있다. 소스 폴더만 열어 사용하는 C 구문 분석도 작은 예제에서 실행 확인했다. 그러나 다양한 C 컴파일러 문법, 파일 간 심볼 판별, 함수 포인터의 실제 대상까지 Source Insight와 같은 결과가 나온다고 검증한 것은 아니다.

현재 권고는 **Tree-sitter C 기반 구문 분석 + 직접 구현하는 심볼/참조 인덱스 + VS Code WebviewView**이다. 구문 분석과 관계 판별은 별개로 취급한다. 제품 구현에 앞서 대표 C 프로젝트로 심볼 판별 정확도를 검증해야 한다.

## 어떤 방식으로 검색하는가

1. VS Code 파일 API로 작업 폴더의 .c/.h 파일을 찾는다.
2. Tree-sitter C로 파일별 구문 구조를 읽는다. 함수·변수 선언, 실제 호출 구문, 식별자 참조, 파일·줄·문자 위치를 얻는다.
3. 별도 판별 로직으로 파일 범위, static, 지역 이름 가림, 선언 및 포함 관계를 고려해 후보를 연결한다. 모호한 후보는 확정 관계로 만들지 않는다.
4. 심볼 목록, 호출·참조 위치 목록, 심볼에서 해당 위치를 찾는 역방향 색인을 만든다. 첫 구현에서는 메모리 자료구조로 시작한다.
5. 함수 클릭 시 이름만 검색하지 않고 클릭 위치의 심볼을 찾고, 그 심볼에 대응하는 호출자·참조 위치를 색인에서 조회한다.
6. 노드를 펼칠 때 선택한 노드에서 요청한 깊이만큼 조회한다. Context는 선택한 참조의 파일·범위를 읽어 표시한다.
7. 파일 변경 시 해당 파일의 기록을 교체하고 관련 연결을 갱신한다. 이름·선언 변경은 다른 파일의 관계에도 영향을 줄 수 있다.

단순 문자열 검색은 조사와 후보 확인의 보조 수단이다. 문자열 검색 결과만으로 함수 호출이나 변수 종류를 결정하지 않는다. AI가 추정한 호출 관계를 확정 데이터로 사용하지 않는다.

## 실행 검증

환경: Node.js 25.9.0, macOS arm64. 실제 실행 환경은 [results.json](2026-10-17-feasibility-evidence/results.json)에 기록했다.

패키지: web-tree-sitter 0.27.1, tree-sitter-c 0.24.1. 패키지에 포함된 WebAssembly 파일을 사용했으며 설치 스크립트를 비활성화했다. 대상 C 예제의 컴파일, SDK 및 compile_commands.json은 사용하지 않았다. 이는 해당 macOS 환경의 검증이며 Windows·Linux 실행은 미검증이다.

총 8개의 구문 추출 검증을 실행하여 통과했다. 전체 콜트리 정확성 테스트 8개를 통과했다는 뜻은 아니다.

| 사례 | 실제 관찰 | 증명하지 않은 것 |
| --- | --- | --- |
| 같은 함수의 두 호출 | 각 호출의 코드와 정확한 줄 번호 추출 | 프로젝트 전체 호출 누락 여부 |
| 선언·주석·문자열·함수 주소 | 직접 호출 구문과 구별됨 | 모든 주소 참조의 대상 판별 |
| 동명 static 함수 두 파일 | 파일별 정의를 별도로 추출 | 호출을 올바른 정의에 연결하는 resolver |
| 조건부 컴파일 | 양쪽 분기 구문과 조건 구조가 보존됨 | 실제 빌드에서 활성화되는 분기 |
| 함수 포인터 호출 | handler()와 (*handler)() 구문 추출 | 실제 실행 대상 함수 |
| 함수 형태 매크로 | CHECK(1) 호출과 매크로 정의 추출 | 확장 후 fault(1) 관계 자동 생성 |
| 함수 포인터 테이블 | 포인터·배열 선언과 초기화 구문 추출 | typedef 등 모든 선언 형태의 종류 분류 |
| 위치와 이름 가림 | 한글·이모지 앞의 여러 줄 호출 위치, 같은 이름 매개변수 선언 보존 | 전체 스코프 해석 및 VS Code UI 이동 |

추가 관찰:

- `__interrupt void irq(void)`는 오류 노드가 생겼지만 본문의 fault()는 추출됐다.
- `void irq(void) __interrupt(1)`은 오류 표시 없이 선언부의 __interrupt(1)도 call_expression으로 나타났다. 호출 구문을 무조건 전부 수집하면 오탐이 생긴다. 본문과 선언부의 문맥을 구분해야 한다. 이 예제에서는 구문 트리에 본문 경계가 남아 있었다.
- 작성 중인 `void task(void) { fault(`는 오류 상태이며 호출 구문이 아직 추출되지 않았다. 미저장 편집 중의 불완전한 결과를 처리해야 한다.

재현용 파일은 [feasibility-evidence](2026-10-17-feasibility-evidence/)에 보관한다. 해당 폴더에서 `npm ci --ignore-scripts --no-audit --no-fund` 후 `node probe.mjs`로 실행할 수 있다. 실제 실험은 /tmp의 별도 폴더에서 실행했으며 프로젝트 루트에는 제품 의존성을 설치하지 않았다.

## 추가 검토: #if 0 영역 제외

`conditional-probe.mjs`에서 리터럴 0/1 조건만 판별하는 구문 탐색 실험을 실행했다. 네 사례 모두 기대 호출 목록과 일치했다.

1. #if 0 본문 제외, #else 보존.
2. 비활성 상위 분기 안의 #if 1도 제외.
3. #if 0 다음 #elif 1 선택, 이후 #else 제외.
4. 상태를 모르는 FEATURE 조건은 양쪽 후보를 유지하되 내부의 명확한 #if 0은 제외.

이는 분기 필터링의 가능성을 검증한 실험이며 전체 전처리기나 제품 기능 구현은 아니다. 매크로 확장과 복합 정수 조건 평가, 분석 오류가 있는 전처리 구문, 색인 갱신은 별도 검증 대상이다. 근거: [GCC #if 0 설명](https://gcc.gnu.org/onlinedocs/cpp/Deleted-Code.html), [조건식 규칙](https://gcc.gnu.org/onlinedocs/cpp/If.html).

증거: [conditional-results.json](2026-10-17-feasibility-evidence/conditional-results.json). 같은 실험 환경에서 `node conditional-probe.mjs`로 재현한다.

## 화면 구현 가능성

- `window.onDidChangeTextEditorSelection`으로 편집기의 선택 변경을 감지할 수 있다.
- `WebviewView`는 HTML을 렌더링할 수 있고 Panel 영역에 뷰 컨테이너를 추가할 수 있다.
- 권고 배치는 하단 WebviewView 내부를 Context 왼쪽, Relation 오른쪽으로 나누는 것이다. 두 영역은 동시에 보이고 폭을 조절하도록 한다. 원본과 동일한 독립 도킹·분리 창까지 자동으로 보장되는 것은 아니다.
- 노드 아이콘, 키보드 확장, 그래프 레이아웃, 읽기 전용 코드 강조는 확장이 구현한다.
- Context 갱신은 메인 편집기에 파일을 열거나 커서를 옮기는 작업과 분리할 수 있다.
- 위 사항은 공식 API에 따른 구현 가능성 판단이다. VS Code 안에서 실제 확장을 실행한 검증은 아직 없다.

## 대안 검토

| 방식 | 판단 |
| --- | --- |
| Tree-sitter C + 관계 인덱스 | 추천. 구문·위치 정보를 활용해 사용자 지정 탐색을 만들 수 있으며 내장 WASM 실행을 확인했다. 심볼 판별을 직접 구현해야 함 |
| clangd 호출 계층 | 빌드 정보가 있을 때 유용한 후보. 사용자가 원하는 무설정 폴더 분석의 유일한 수단으로는 채택하지 않음 |
| Universal Ctags | 종류·정의 위치를 찾는 대안. reference tags 지원이 모든 호출 위치 수집을 보장하지 않으므로 단독 콜트리 엔진으로 채택할 근거 부족 |
| 문자열 검색 | 빠른 후보 검색에 유용. 함수·변수·매크로와 실제 호출을 판별하는 주 엔진으로 사용하지 않음 |

## 남은 기술 검증

1. 파일 간 심볼 판별: 같은 이름의 외부 함수, static, 헤더 함수, 변수 이름 가림과 함수 포인터 테이블.
2. 대표 임베디드 프로젝트: 컴파일러 전용 선언, 매크로 중심 함수 선언, 조건부 컴파일과 인코딩.
3. 실제 VS Code 프로토타입: 선택 추적, 그래프 키보드 조작, Context 갱신, 메인 편집 위치 보존.
4. 대표 프로젝트 규모에서 최초 색인 시간·메모리·반복 조회 지연 측정.

위 검증 전에는 정확도 비율, 처리 속도, 모든 툴체인 호환성 및 Source Insight와의 완전 일치를 보장하지 않는다.

## 공식 자료

- [Tree-sitter 소개](https://tree-sitter.github.io/tree-sitter/)
- [Tree-sitter C 문법](https://github.com/tree-sitter/tree-sitter-c)
- [Web Tree-sitter 사용법](https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/README.md)
- [VS Code Webview](https://code.visualstudio.com/api/extension-guides/webview)
- [VS Code 뷰 등록](https://code.visualstudio.com/api/references/contribution-points#contributes.views)
- [VS Code 선택 변경 이벤트](https://code.visualstudio.com/api/references/vscode-api#window.onDidChangeTextEditorSelection)
- [Universal Ctags 참조 태그와 심볼 종류](https://docs.ctags.io/en/latest/output-tags.html)
- [clangd 프로젝트 참조와 설정](https://clangd.llvm.org/faq)
