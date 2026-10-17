# C Relation Explorer

C 소스 폴더만 열어 함수의 호출·참조 관계, 변수의 읽기·쓰기 위치와 해당 코드를 함께 보는 VS Code 확장입니다. Source Insight의 Relation/Context 작업 흐름을 참고한 독립 구현입니다.

## 설치와 시작

1. [GitHub Releases](https://github.com/mrdylee/vscode_extension_relation_window/releases/latest)에서 Windows / macOS / WSL용 VSIX를 받고, VS Code 명령 팔레트의 **Extensions: Install from VSIX…**로 설치합니다. 세 파일은 동일한 범용 패키지이며 이름만 구분합니다.
2. C 소스가 있는 폴더를 엽니다. 빌드, SDK, clangd, `compile_commands.json`은 필요하지 않습니다.
3. **C Relations: Open Relation and Context**를 실행합니다.
4. 메인 편집기에서 함수나 변수 이름을 클릭합니다. 하단에 Context(왼쪽)와 Relation(오른쪽)이 표시됩니다.

VS Code 데스크톱 1.95 이상이 필요합니다. 분석은 로컬 WASM으로 수행하며 소스 코드를 외부로 전송하지 않습니다. 업데이트 확인을 켜면 GitHub에 릴리스 정보를 요청합니다. 릴리스 게시 전에 Windows/macOS/Ubuntu에서 단위 테스트와 Extension Host 통합 테스트를 실행합니다. WSL 원격 연결 및 원격 자동 설치는 실환경 미검증입니다. 웹 전용 VS Code는 지원하지 않습니다.

**WSL 설치:** Windows의 VS Code에서 Microsoft WSL 확장을 설치한 뒤 **WSL: Reopen Folder in WSL**로 C 소스 폴더를 엽니다. 그 창에서 VSIX를 설치하고 확장 목록의 **WSL: 배포판 이름**에 C Relation Explorer가 있는지 확인합니다. 필요하면 **Install in WSL**을 선택합니다. [VS Code WSL 안내](https://code.visualstudio.com/docs/remote/wsl#_managing-extensions)

## 함수 아이콘 (v0.1.24 이상)

기존 둥근 `ƒ` 모양을 유지하고, 함수 선언부는 테두리형, 구현부는 채움형으로 구분합니다. 16×16 크기를 유지하며, 팝업에 `Function declaration` / `Function definition`을 표시합니다. 선언·구현을 특정하지 못한 참조는 일반 테두리 `ƒ`를 사용하므로 팝업 설명으로 확인하세요. 점선 테두리는 별도로 조건부 코드·후보·재귀 상태를 뜻합니다. 변수 `v`, 타입 `T`, 매크로 `#`, 미확인 `?`와 R/W/RW/& 표시를 포함한 전체 범례는 확장의 **Help → Symbol icons and badges**에서 확인할 수 있습니다.

## 확장 안에서 설정과 사용법 열기 (v0.1.20 이상)

GitHub를 방문하지 않아도 C Relations 상단의 두 버튼으로 사용할 수 있습니다.

- **Settings**: 현재 프로젝트의 Include/Exclude 설정을 엽니다. 폴더를 열지 않은 경우 사용자 설정을 엽니다. 다중 폴더 워크스페이스에서는 설정 화면의 폴더 탭에서 개별 범위를 지정할 수 있습니다.
- **Help**: VSIX에 포함된 [사용 안내](USER_GUIDE.md)를 VS Code 문서 미리보기로 엽니다. 인터넷 연결 없이도 탐색 방법, 설정 예제, 비활성 코드 처리와 문제 해결을 읽을 수 있습니다. 현재 Relation은 유지됩니다.

명령 팔레트에서도 **C Relations: Configure Analysis Scope**, **C Relations: Open User Guide**를 실행할 수 있습니다. 버튼과 내장 안내는 영어로 표시합니다.

## 분석 범위 설정: Include / Exclude

Include는 v0.1.18부터 구현되었으며, 여러 패턴을 함께 사용할 때의 누락 수정까지 포함한 **v0.1.19 이상**을 권장합니다. Exclude는 v0.1.16 이상에서 사용할 수 있습니다. 분석할 폴더가 적으면 **Include**로 포함할 범위를 지정하고, 불필요한 도구·생성 코드 폴더는 **Exclude**로 제외하세요. 예를 들어 Polyspace 설치 파일이나 분석 결과가 소스 폴더 안에 있다면 해당 경로를 제외할 수 있습니다. 기본 사용자 제외 목록은 비어 있으므로 Polyspace나 SDK 폴더가 자동으로 제외되지는 않습니다.

1. C 소스 폴더를 연 VS Code 창에서 명령 팔레트의 **Preferences: Open Workspace Settings (JSON)**을 실행합니다. WSL 프로젝트라면 WSL에 연결된 창에서 설정합니다.
2. 설정 객체에 `cRelation.include`와 `cRelation.exclude`를 필요에 맞게 추가하고 저장합니다. 기존 설정이 있다면 다른 항목을 지우지 말고 이 항목을 합칩니다. 일반적인 단일 폴더 프로젝트에서는 `.vscode/settings.json`에 저장됩니다.

```json
{
  "cRelation.exclude": [
    "**/Tools/Polyspace/**",
    "**/build/**"
  ]
}
```

3. 저장하면 자동으로 다시 분석합니다. 하단 상태가 **Indexing C sources…**에서 **Index ready**로 바뀌는지 확인한 뒤 원본 `.c` / `.h`의 함수 이름을 클릭합니다. 필요할 때만 **Rebuild index**로 전체 분석을 다시 실행하세요.

위 예시는 전체 C/H 파일 중 Polyspace와 build만 제외합니다. **App과 Drivers만 분석하면서 그 안의 generated와 test는 제외**하려면 다음과 같이 설정합니다.

```json
{
  "cRelation.include": ["App/**", "Drivers/**"],
  "cRelation.exclude": ["**/generated/**", "**/test/**"]
}
```

| Include | Exclude | 분석 범위 |
| --- | --- | --- |
| 비어 있음 (`[]`) | 비어 있음 (`[]`) | 전체 C/H 파일 (기본 제외 폴더는 제외) |
| 설정 | 비어 있음 | Include에 일치하는 C/H 파일 |
| 비어 있음 | 설정 | 전체 C/H에서 Exclude를 제외 |
| 설정 | 설정 | Include에 일치하는 C/H에서 Exclude를 제외 |

**Exclude가 최종 우선**입니다. Include는 패턴 중 하나에 일치하면 포함하며, 겹치는 패턴으로 같은 파일을 중복 분석하지 않습니다. v0.1.19부터는 `App/**/*.{c,h}`와 `Drivers/**`처럼 중괄호 패턴과 다른 패턴을 함께 써도 각각의 의미를 유지합니다. Include가 설정되어 있지만 일치하는 파일이 없으면 분석 결과는 0개입니다. 전체 범위로 돌아가려면 Include를 `[]`로 비우세요.

Settings 화면에서는 `@id:cRelation.include` 또는 `@id:cRelation.exclude`를 검색하고 **Workspace** 범위에서 항목을 추가할 수 있습니다. 폴더 안의 모든 파일을 지정할 때는 `App` 대신 `App/**`처럼 작성하세요. 폴더 패턴에 다른 종류의 파일이 있어도 분석은 C/H 파일만 대상으로 합니다.

| 패턴 예시 | 일치 범위 (Include/Exclude 공통) |
| --- | --- |
| `**/Tools/Polyspace/**` | 어느 깊이에 있든 `Tools/Polyspace` 아래 파일 |
| `**/build/**` | 모든 `build` 폴더 아래 파일 |
| `generated/**` | 열린 워크스페이스 폴더 바로 아래의 `generated` 폴더 |
| `**/vendor/**` | 모든 `vendor` 폴더 아래 파일. 해당 라이브러리 관계가 필요 없는 경우에만 사용 |

- 패턴은 **열린 워크스페이스 폴더 기준**입니다. 실제 폴더 이름에 맞게 바꾸고 Windows에서도 경로 구분자는 `/`를 사용하세요. WSL에서는 경로의 대소문자가 일치해야 합니다. Windows에서 실행되는 확장은 대소문자를 구분하지 않습니다.
- 여러 폴더를 연 워크스페이스에서는 각 폴더를 기준으로 패턴을 적용하며, 폴더별 설정도 가능합니다.
- Include 밖에 있거나 Exclude에 해당하는 파일의 **정의와 참조는 Relation에 나오지 않습니다**. 필요한 공통 헤더나 라이브러리까지 제외하면 관계가 누락될 수 있습니다. Include를 넓히거나 Exclude에서 패턴을 제거하면 자동 재분석으로 다시 포함할 수 있습니다.
- Include/Exclude 설정은 초기 파일 수 제한 **이전**에 적용되며 이후 파일 생성·수정·미저장 편집에도 적용됩니다.
- `files.exclude`, `search.exclude`, `C_Cpp.files.exclude`는 이 확장의 분석 범위에 적용되지 않습니다. `cRelation.include`와 `cRelation.exclude`를 사용하세요.
- `node_modules`, `.git`, `.vscode-test`는 기본으로 제외합니다. 사용자 제외 후에도 초기 분석 대상이 10,000개를 넘으면 **Partial index**가 표시됩니다. 불필요한 경로를 더 제외하거나 필요한 소스 폴더를 별도로 여세요.

## 업데이트

확장이 실행되면 GitHub의 정식 릴리스를 자동 확인합니다. 마지막 성공한 확인 후 24시간 이내에는 반복 요청하지 않습니다. 확장이 실행 중이면 한 시간마다 확인 시각을 점검하므로, 다음 자동 확인은 마지막 성공 후 약 24~25시간 뒤에 실행됩니다. v0.1.22부터 네트워크 오류나 잘못된 릴리스 정보는 성공 시각을 갱신하지 않고 다음 시간에 재시도합니다. 개발·테스트 모드에서는 자동 확인하지 않습니다.

새 버전이 있으면 현재/새 버전과 변경 내역을 보여줍니다. **Update**를 선택한 경우에만 VSIX를 다운로드하고 설치합니다. **Later** 또는 창 닫기는 설치하지 않습니다. 설치 후에도 **Reload Window**를 선택해야 다시 로드합니다.

- 수동 검사: 명령 팔레트 → **C Relations: Check for Updates**.
- 새 릴리스가 게시돼도 즉시 알림이 오는 방식은 아닙니다. 바로 확인하려면 수동 검사를 실행하세요. 수동 검사는 24시간 제한을 건너뛰며, 현재 버전이 최신이면 안내만 표시합니다.
- 자동 검사 끄기: VS Code 사용자 설정의 **C Relation: Automatic Updates** 해제 (`cRelation.automaticUpdates`).
- 업데이트 소스: [GitHub Releases](https://github.com/mrdylee/vscode_extension_relation_window/releases). 커밋만 푸시한 버전과 시험판은 설치하지 않습니다.
- 릴리스가 없으면 수동 검사에서 안내합니다. 자동 검사 중 오프라인/요청 제한은 조용히 처리하며, 수동 검사 또는 동의 후 설치 실패는 오류를 표시합니다.
- 버전·릴리스 파일·크기 및 제공된 SHA-256 체크섬을 확인합니다. 자동으로 코드를 보안 심사하는 기능은 아닙니다. 로컬 데스크톱 배포를 대상으로 하며 원격 환경의 자동 설치는 미검증입니다.

### 새 버전 배포하기

1. `package.json`, `package-lock.json`의 버전 및 `package` 스크립트의 VSIX 이름을 함께 올리고 CHANGELOG를 작성합니다.
2. `docs/releases/<버전>.md`에 변경 사항과 설치 안내를 작성합니다.
3. 변경을 커밋·푸시한 뒤 `v0.1.10` 같은 버전 태그를 푸시합니다. 태그와 패키지 버전이 일치해야 합니다.
4. GitHub Actions가 Windows/macOS/Ubuntu 검증을 통과한 후 범용 VSIX를 만들고, Windows/macOS/WSL 이름의 사본과 SHA-256 목록을 정식 릴리스로 게시합니다. 접미사 없는 공통 VSIX 이름은 자동 업데이트가 사용하므로 유지합니다.
5. 이전 버전에서 **Check for Updates**를 실행해 확인합니다. 일반 커밋만으로는 릴리스가 생성되지 않습니다.

## 탐색

- **References**: 직접 호출, 함수 주소 참조, 함수 선언을 함께 표시합니다. 함수 포인터 테이블은 변수 아이콘으로 표시합니다.
- **Callers**: 직접 함수 호출만 표시합니다. 그래프는 선택한 함수에서 **호출하는 쪽으로** 펼쳐집니다.
- 함수 이름 선택: 해당 정의를 Context에서 미리 봅니다.
- Relation 노드는 **아이콘 + 심볼 이름 한 줄**로 표시합니다. 마우스를 같은 노드 위에서 500ms 동안 멈추거나 노드에 포커스를 두고 Space를 누르면 상세 팝업이 열립니다. Escape로 닫습니다.
- 상세 팝업의 `파일:줄:열` 선택: 그 호출/참조 위치를 Context에서 강조합니다. 같은 함수 안의 반복 호출도 각각 선택할 수 있습니다. 노드에서 Tab을 누르면 팝업의 버튼으로 이동합니다.
- **Relation 노드 한 번 클릭**은 Context를 바꾸고, 클릭한 심볼에서 상단 깊이만큼 호출·참조 관계를 펼칩니다(v0.1.17 이상). `1 level`이면 한 단계, `2 levels`이면 두 단계입니다. 기존 루트와 다른 가지는 유지하며 이미 더 깊게 펼친 가지는 접지 않습니다. 같은 노드를 반복 클릭해도 무한히 추가 확장하지 않습니다. **더블클릭/Enter**는 메인 편집기에서 해당 코드를 엽니다.
- **Context 코드 한 번 클릭**은 메인 편집기를 클릭한 줄·토큰의 시작으로 이동하고, 고정 해제 상태에서는 Relation도 클릭한 함수·변수로 바꿉니다. 고정 중에는 메인 코드만 이동합니다. 줄 번호나 빈 공간을 클릭하면 해당 줄 시작으로 이동합니다. 드래그로 텍스트를 선택하면 복사를 위해 이동하지 않습니다. 미리보기가 실제 편집 내용보다 오래된 경우에는 잘못된 위치로 이동하지 않습니다.
- 상단 **1 level ~ 8 levels**는 전체 기본 깊이, 상세 팝업의 **Levels…**는 그 노드에서 추가로 펼칠 깊이입니다.
- 노드 제목에 포커스를 두고 **→** 펼치기, **←** 접기, **Shift+→** 추가 깊이를 지정합니다. Tab으로 노드와 위치 사이를 이동합니다.
- 버튼은 현재 상태를 표시합니다. **Following selection**이면 메인 편집기와 Context에서 선택한 심볼을 따라 Relation이 바뀝니다. 버튼을 누르면 **Pinned · Follow paused**가 되어 Relation을 유지하며, 다시 누르면 자동 추적을 재개합니다. 고정 중에도 Context 클릭으로 메인 코드 위치는 이동합니다.
- 가운데 구분선을 드래그하거나 구분선에 포커스를 두고 좌우 키로 영역 너비를 조정합니다.
- `ƒ` 함수, `v` 변수, `T` 타입, `#` 매크로를 구분합니다. 타입 사용처와 구조체 멤버 참조는 아직 수집하지 않습니다.
- 점선 아이콘은 조건부·후보·재귀 상태가 있음을 나타냅니다. 정확한 상태는 상세 팝업에 표시합니다.
- Context에서 함수명, 기본 타입과 `_t` 타입 이름, 키워드, 변수, 숫자, 대문자 매크로/상수, 문자열, 주석, 전처리 지시자를 색으로 구별합니다. 밝은/어두운 VS Code 테마에 맞는 색을 사용합니다. 임의의 사용자 정의 타입과 매크로를 완전히 판별하는 의미 분석은 아닙니다.
- 미저장 편집과 파일 추가·변경·삭제를 자동 반영합니다. **Rebuild index**로 전체 색인을 갱신할 수 있습니다.

## 변수 읽기·쓰기 탐색

메인 편집기에서 변수를 선택하면 같은 Relation 창의 선택 메뉴가 **Variable · All uses / R · Read / W · Write / RW · Read/write / & · Address passed**로 바뀝니다. 사용한 함수별로 묶고, 한 줄 노드의 작은 색상 표시로 접근 종류를 구분합니다.

- **R**: 값 읽기. **W**: 직접 대입(`state = 1`)과 명시적 초기화(`int state = 0`). 초기값 없는 선언은 쓰기로 세지 않습니다.
- **RW**: 복합 대입(`+=` 등), 증가·감소(`++`, `--`). 읽기 필터와 쓰기 필터 양쪽에 포함됩니다. RW 필터는 RW만 표시합니다.
- **&**: 주소 사용(`&state`). 주소를 저장하거나 전달하는 위치를 표시하며, 이후 실제 변경 여부는 추론하지 않습니다.
- 사용 함수 노드를 클릭하면 **첫 번째 일치하는 사용 줄**을 Context에 표시합니다. 상세 팝업에서 같은 함수의 나머지 사용 위치도 선택할 수 있습니다.
- 단계를 늘리면 사용 함수의 상위 호출·참조 관계도 이어집니다. 함수 선택으로 돌아가면 기존 References/Callers 선택이 유지됩니다.
- 지역 변수·매개변수와 전역 변수의 이름 가림을 구분하며, 일반적인 `extern` 선언은 찾을 수 있는 정의에 연결합니다.

구문에 드러난 접근만 분류합니다. `*p = 1`은 포인터 `p`의 읽기이며 가리키는 대상의 쓰기는 추적하지 않습니다. 배열 요소·구조체 멤버의 쓰기와 포인터 별칭 추적은 지원하지 않습니다. `sizeof`/`_Alignof` 안의 식은 접근 목록에서 제외하며, 가변 길이 배열 때문에 평가되는 예외는 분석하지 않습니다. 매크로 인자 역시 확장 전 구문 기준이므로, 매크로가 실제로 수행하는 읽기·쓰기를 보증하지 않습니다.

## 비활성 코드 처리

**Skip inactive branches**는 기본으로 켜져 있습니다(`cRelation.skipInactive`). 리터럴 `0`/`1` 조건과 그 `#else`, `#elif`, 중첩을 처리합니다. 제외해도 Context의 원본 코드는 지우지 않습니다.

`#if BOARD_PRO`, `#ifdef`, `#ifndef`, `defined(...)`, 계산식 등은 빌드 설정 없이 참/거짓을 확정하지 않습니다. 양쪽의 가능한 코드를 남기고 **Conditional**로 표시합니다. `#define`·`#undef` 전파와 빌드 옵션을 반영한 전체 전처리기 계산은 지원하지 않습니다. 따라서 헤더 가드 안의 선언에도 조건부 표시가 붙을 수 있습니다. 옵션을 끄면 `#if 0` 영역도 관계 색인에 포함됩니다.

## 정확도와 범위

Tree-sitter C 구문 트리에서 심볼·위치를 수집하고 파일/지역 스코프를 이용해 연결합니다. 단순 문자열 검색보다 선언·문자열·주석을 구분하지만 컴파일러의 의미 분석을 완전히 대체하지 않습니다.

- 파일별 `static`과 지역 변수/매개변수의 이름 가림을 구분합니다. 여러 외부 정의는 후보 선택 목록과 **Candidate** 표시를 제공합니다.
- 함수 포인터의 주소 참조는 보이지만 실행 중 어느 함수를 호출하는지는 추론하지 않습니다.
- 매크로를 확장하지 않습니다. 매크로 안에 감춰진 함수 호출은 직접 호출로 만들어 내지 않습니다.
- 헤더의 `static`, 간접 include, 복잡한 변수 선언, 컴파일러 전용 문법은 불완전할 수 있습니다. 파서 오류는 하단 **Analysis notices**로 표시하지만 모든 의미 오류를 감지하지는 못합니다.
- `.c`, `.h` 파일을 대상으로 하며 `node_modules`, `.git`, `.vscode-test`와 `cRelation.exclude` 패턴에 맞는 파일을 제외합니다. `files.exclude`, `search.exclude`, `C_Cpp.files.exclude`는 이 확장의 분석 범위에 적용되지 않습니다.
- 초기 분석은 Include/Exclude 적용 후 최대 10,000개 파일, 파일당 2,000,000 UTF-16 코드 단위, 화면당 300개 노드로 제한합니다. 제한·분석 실패는 알림으로 표시합니다. 파일 변경은 해당 파일의 인덱스만 교체합니다.
- Context는 선택 위치 앞 80줄, 뒤 120줄 범위를 읽기 전용으로 보여줍니다. 간단한 구문 색상은 제공하지만 전체 C 의미 강조는 아닙니다.

## Relation이 바뀌지 않거나 느릴 때

1. **실행 중인 버전**을 Context 제목에서 확인합니다. 대규모 프로젝트의 반복 인덱스 갱신 병목은 v0.1.16에서 개선했습니다. 업데이트 후 **Reload Window**를 실행해야 새 버전이 적용됩니다. WSL에서는 확장이 해당 WSL 환경에 설치되어 있는지도 확인하세요.
2. **Following selection** 상태인지 확인합니다. **Pinned · Follow paused**는 선택 추적을 멈추고 현재 Relation을 유지하는 상태입니다. 버튼을 누르면 추적을 재개합니다.
3. 하단의 **분석 상태와 파일 수**를 확인합니다. 초기 분석 중에는 아직 처리하지 않은 파일의 관계가 빠질 수 있습니다. **Partial index: 10,000 file limit reached**이면 일부 파일이 초기 색인에서 빠졌으므로 제외 설정으로 범위를 줄이세요.
4. **Analysis notices**를 펼칩니다. `File exceeds the 2,000,000 character analysis limit`는 해당 파일의 크기 제한 안내입니다. 도구가 생성한 대형 파일이면 그 폴더를 제외하세요. 문법 분석 알림은 파일과 줄을 확인해야 하며, **Index ready**도 모든 파일에 분석 오류가 없다는 뜻은 아닙니다.
5. Include를 설정했다면 선택한 파일이 그 패턴에 일치하고, Exclude에는 일치하지 않는지 확인합니다. 0개로 표시되면 폴더 이름과 WSL 경로의 대소문자를 확인하세요. 같은 이름의 정의가 여럿이면 **Select definition**에서 원하는 파일의 정의를 선택합니다.

**Rebuild index**는 현재 범위로 분석을 다시 실행합니다. 제외 설정 없이 반복해서 눌러도 분석 대상이나 파일 수 제한이 달라지지는 않습니다. `Skip inactive branches`는 폴더 제외와 별개이며, 정의 여부가 불명확한 `#ifdef` 분기를 제거하는 옵션은 아닙니다.

## 개발과 검증

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run test:ui
npm run test:extension
npm run package
```

`test:ui`는 로컬 Google Chrome을 사용합니다. `test:extension`은 macOS의 설치된 VS Code를 우선 사용하며, 다른 실행 파일은 `VSCODE_EXECUTABLE`로 지정할 수 있습니다. 없으면 테스트 도구가 VS Code를 내려받습니다. 격리된 임시 프로필/예제 폴더를 사용하므로 평소 VS Code 설정은 변경하지 않습니다.

F5로 Extension Development Host를 실행할 수 있습니다. 예제는 `examples/demo`입니다. 자동 검증 범위는 분석 단위 테스트, 실제 Extension Host의 선택·옵션·편집·파일 변경, 브라우저의 그래프·Context·키보드 연결입니다. 사용자 실제 프로젝트 전체의 정확도를 보증하는 결과는 아닙니다.

설계와 실행 계획은 `docs/superpowers/`에 있습니다. 종속 컴포넌트 라이선스는 `THIRD_PARTY_NOTICES.txt`에 포함했습니다.
