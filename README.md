# Dynsight — C Code Explorer

제작자 **dylee**, 확장 ID **`dylee.dynsight`**입니다. 설정과 명령은 `dynsight.*`를 사용합니다.

C 소스 폴더만 열어 함수의 호출·참조 관계, 변수의 읽기·쓰기 위치와 해당 코드를 함께 보는 VS Code 확장입니다. Source Insight의 Relation/Context 작업 흐름을 참고한 독립 구현입니다.

구현 구조는 [Tree-sitter·관계·콜백·캐시 알고리즘 설명](docs/architecture/2026-10-21-dynsight-analysis-algorithm.md)에 정리했습니다. [Python 최적화 설계 검토](docs/superpowers/specs/2026-10-21-python-analysis-optimization-design.md)는 아직 구현하지 않은 비교 제안입니다.

## 설치와 시작

1. [GitHub Releases](https://github.com/mrdylee/vscode_extension_relation_window/releases/latest)에서 사용 환경에 맞는 VSIX(`dynsight-<version>-windows.vsix`, `-macos.vsix`, `-wsl.vsix`)를 받고, VS Code 명령 팔레트의 **Extensions: Install from VSIX…**로 설치합니다. 플랫폼별 파일과 자동 업데이트용 공통 파일은 동일한 JavaScript/WASM 패키지입니다.
2. C 소스가 있는 폴더를 엽니다. 빌드, SDK, clangd, `compile_commands.json`은 필요하지 않습니다.
3. **Dynsight: Open Relation and Context**를 실행합니다.
4. 메인 편집기에서 함수나 변수 이름을 클릭합니다. 하단에 Context(왼쪽)와 Relation(오른쪽)이 표시됩니다.

VS Code 데스크톱 1.95 이상이 필요합니다. 기본 분석은 로컬 WASM으로 수행합니다. 선택 기능인 **AI 콜백 분석**을 켜면 관련 소스 일부를 선택한 Copilot·Claude Code·Codex 계정으로 전송하며 계정 사용량 한도가 적용됩니다. 업데이트 확인을 켜면 GitHub에 릴리스 정보를 요청합니다. 릴리스 게시 전 검증은 Windows·macOS·Ubuntu에서 단위 테스트와 Extension Host 통합 테스트를 실행합니다. WSL 원격 연결 및 원격 자동 설치는 실환경 미검증입니다. 웹 전용 VS Code는 지원하지 않습니다.

## 상세 분석과 AI 콜백 후보

**Settings → Smart Analysis: AI**를 켜면 VS Code에 설치된 **Copilot / Claude Code / Codex** 중 하나를 사용합니다. 하나만 설치돼 있으면 자동 선택하고, 여러 개면 한 번 선택해 저장합니다. **Dynsight: Select AI Extension**에서 바꿀 수 있습니다. **선택한 하나만 요청을 처리하며 다른 제공자로 자동 전환하지 않습니다.** 별도 CLI 설치나 실행 파일 경로 입력은 필요하지 않습니다. 선택한 확장을 열어 로그인하세요. Claude Code·Codex는 모델 ID 입력 없이 기본 모델을 바로 사용합니다. Copilot만 **Select AI Model**의 목록에서 고릅니다.

Copilot은 VS Code 모델 API를 사용하고, Claude Code·Codex는 설치된 확장에 포함된 실행 엔진을 자동으로 찾아 기존 로그인을 사용합니다. 기존 채팅창에 메시지를 입력하는 방식은 아닙니다. 제공자를 바꾸면 이전 요청이 끝난 뒤 새 요청을 시작합니다. WSL·SSH에서는 해당 환경에서 사용할 수 있는 확장이 필요합니다. 실패하면 선택한 확장의 로그인·업데이트 상태를 확인한 뒤 **Analyze Callbacks with AI**로 재개하세요. 기존 Copilot 사용 여부는 새 AI 설정을 명시적으로 저장하기 전까지 적용됩니다.

설정은 **보기 → Include → Exclude → Smart Analysis Include / Exclude →
Smart Analysis Macro / AI / Provider → 기타 옵션** 순서입니다. UI 문구는 영어로 제공합니다.

경로는 일반 **Include / Exclude**와 **Smart Analysis Include / Exclude** 네 개만
사용합니다. 일반 범위는 기본 색인을 정하며, Smart Analysis 범위는 그 안에서 추가
분석할 파일을 정합니다. **Macro**는 로컬 매크로 확장과 콜백 전파를 함께 켜고 끕니다.
**AI**는 미해결 콜백의 AI 후보 분석이며 Macro와 독립적으로 켤 수 있습니다.
새 프로젝트의 Smart Analysis Include는 비어 있으므로 기본 탐색부터 시작합니다.
`["**"]`는 모든 색인 파일을 선택하며 Smart Analysis Exclude가 우선합니다.
기존 경로 설정은 화면에서 숨기고, 새 Include를 명시적으로 저장하기 전까지 기존
분석 범위와 AI 허용 범위를 유지합니다. 새 Include를 저장하면 두 기능이 이 범위를
공유합니다. 색인된 외부 헤더 정의는 참조하지만 외부 함수 본문을 자동으로 추적하지 않습니다.

AI 사용 여부·제공자·모델·허용 경로를 지정하면 저장된 색인이 준비된 뒤 미해결 콜백을
자동으로 하나씩 분석합니다. 기존 유효 캐시는 재사용하며 5개 뒤에도 이어서 처리합니다.
호출 팝업의 **Find target with AI**로 한 호출만 조사할 수도 있습니다.
**AI candidate** 팝업에는 **Set manually / Recheck with AI**가
있습니다. Set manually에서 실제 함수를 선택하고 Apply하면 그래프와 소스 이동 대상이
바뀌고 **User confirmed**로 표시됩니다. C 소스를 바꾸거나 함수를 생성하지 않습니다.

User confirmed에서도 AI로 재확인할 수 있습니다. 다른 후보는 비교해서 보여주고
**Use this target**을 누를 때만 교체합니다. 사용자 선택은 AI 캐시와 별도로 저장하며
재시작·재색인·모델 변경으로 덮어쓰지 않습니다. 코드가 바뀌어 동일성을 확인할 수 없으면
재확인이 필요합니다. AI 후보와 사용자 확인 모두 실행을 증명한 정적 호출과 구분합니다.

활성화·시작·파일 저장·재색인과 모델/범위 변경은 설정된 범위의 누락된 결과를 자동으로
분석합니다. **Stop analysis**는 완료 결과를 유지하고 이 세션의 자동 요청을 멈춥니다.
**Analyze Callbacks with AI** 명령, 설정 다시 켜기, 모델/범위 변경으로 재개합니다.
요청 실패도 자동 반복하지 않고 일시 중단합니다. User confirmed는 자동 분석에서 제외합니다.
Smart Analysis Include는 일반 Include에서 자동 복사되지 않으며 빈 목록은 요청을 허용하지 않습니다.
호출 위치는 공유 Smart Analysis 범위에 들어가야 합니다. 근거 소스는 다른 기본 색인 경로에서 수집될 수 있습니다.

**Stop local**은 함수명 길이가 바뀌어도 고정된 위치를 유지합니다. 말줄임 함수명에
마우스를 올리거나 키보드로 포커스하면 전체 이름이 나오며 **Copy**로 복사할 수 있습니다.
열린 팝업의 이름과 복사 대상은 분석 함수가 바뀌어도 유지됩니다.

[전체 사용법](USER_GUIDE.md)을 참고하세요. 로컬 캐시에는 소스·분석 자료가, AI 캐시에는
결과 식별자와 해시가 들어갑니다. 캐시와 사용자 선택은 저장소 밖의 확장 작업 공간에 보관합니다.

## v0.1.43 이하에서 업그레이드

이전 확장(C Relation Explorer / James Black)은 `local-james-black.c-relation-explorer`라는 별도 ID입니다. v0.1.44부터 제작자와 설정 화면까지 새 이름으로 통일했습니다.

1. 새 `dynsight-<version>.vsix`를 설치하고 C 파일을 엽니다.
2. **Remove previous extension and reload** 안내를 선택합니다. 새 확장은 이전 확장이 활성화된 동안 분석을 시작하지 않습니다.
3. 안내를 닫았다면 Extensions에서 이전 확장을 제거하고 **Developer: Reload Window**를 실행하세요. WSL은 프로젝트가 열린 WSL 쪽 확장 목록에서 확인하세요.
4. 다시 활성화되면 기존 `cRelation.*` 설정을 사용자·현재 작업공간·현재 폴더 범위의 `dynsight.*`로 이전합니다. 새 키가 이미 있으면 새 값을 유지하며, 이전이 끝난 옛 키는 제거합니다. 나중에 연 다른 프로젝트는 그때 이전됩니다. 열린 작업공간에 기존 설정이 있는 폴더를 추가했다면 창을 다시 로드하세요.

기존 사용자 단축키의 명령은 호환용으로 연결합니다. 패널 ID가 바뀌므로 위치는 다시 배치해야 할 수 있습니다. 비활성화된 이전 확장은 자동 감지되지 않을 수 있으니 남아 있으면 직접 제거하세요. 업데이트 목록의 `c-relation-explorer-<version>.vsix`는 이전 자동 업데이터를 위한 동일한 새 패키지입니다.

## 함수 아이콘 (v0.1.24 이상)

기존 둥근 `ƒ` 모양을 유지하고, 함수 선언부는 테두리형, 구현부는 채움형으로 구분합니다. 16×16 크기를 유지하며, 팝업에 `Function declaration` / `Function definition`을 표시합니다. 선언·구현을 특정하지 못한 참조는 일반 테두리 `ƒ`를 사용하므로 팝업 설명으로 확인하세요. 점선 테두리는 별도로 조건부 코드·후보·재귀 상태를 뜻합니다. 변수 `v`, 타입 `T`, 매크로 `#`, 미확인 `?`와 R/W/RW/& 표시를 포함한 전체 범례는 확장의 **Help → Symbol icons and badges**에서 확인할 수 있습니다.

## 확장 안에서 설정과 사용법 열기 (v0.1.20 이상)

GitHub를 방문하지 않아도 Dynsight 상단의 두 버튼으로 사용할 수 있습니다.

- **Settings**: 정렬·Context 레이아웃·Callers/Callees 좌우 배치와 Include/Exclude 등 확장의 모든 설정을 엽니다. 폴더를 열지 않은 경우 사용자 설정을 엽니다. 다중 폴더 워크스페이스에서는 설정 화면의 폴더 탭에서 개별 분석 범위를 지정할 수 있습니다.
- **Help · 사용법**: VSIX에 포함된 [한국어 설명서](USER_GUIDE.ko.md) / [English User Guide](USER_GUIDE.md)를 엽니다. VS Code 표시 언어에 맞춰 열리며 문서 맨 위에서 언어를 바꿀 수 있습니다. 빠른 시작, Settings 단계별 사용법, 설정 기본값 표와 문제 해결을 인터넷 없이 읽을 수 있습니다. 현재 Relation은 유지됩니다.

명령 팔레트에서도 **Dynsight: Open Settings**, **Dynsight: Open User Guide**를 실행할 수 있습니다. 언어를 직접 고르려면 **Dynsight: 사용 설명서 열기 (한국어)** 또는 **Dynsight: Open User Guide (English)**를 실행하세요. Settings 맨 위의 Context Layout 설명에도 두 언어 사용법 링크가 있습니다.

## 분석 범위 설정: Include / Exclude

Include는 v0.1.18부터 구현되었으며, 여러 패턴을 함께 사용할 때의 누락 수정까지 포함한 **v0.1.19 이상**을 권장합니다. Exclude는 v0.1.16 이상에서 사용할 수 있습니다. 분석할 폴더가 적으면 **Include**로 포함할 범위를 지정하고, 불필요한 도구·생성 코드 폴더는 **Exclude**로 제외하세요. 기본 Exclude는 모든 깊이의 테스트 폴더(`unit_test*`, `unit-test*`, `unittest*`, `test`, `tests`, `mock*`), 외부 코드 폴더(`third*`), 빌드·측정 산출물 폴더(`build`, `CMakeFiles`, `cmake-build-*`, `coverage`)를 제외합니다. 각 이름은 `**/test/**`처럼 폴더 하위 전체를 제외하는 패턴으로 적용됩니다. 직접 저장한 Exclude 목록은 이 기본값을 대체하며, `[]`로 저장하면 이 기본 제외를 해제할 수 있습니다. Polyspace 계열 폴더와 펌웨어 도구 출력도 기본 제외에 포함됩니다. SDK·HAL·BSP·RTOS 소스는 기본 제외에 추가하지 않습니다.

펌웨어 도구용 기본 제외는 다음과 같습니다. 폴더 이름에 따른 기본 규칙이므로 실제 소스가 같은 이름을 사용한다면 해당 규칙을 제거하세요.

| 용도 | 추가 기본 패턴 |
| --- | --- |
| Polyspace 도구·분석 생성물 | `**/[Pp]oly[Ss]pace*/**`, `**/POLYSPACE*/**` |
| 테스트 프레임워크 | `**/[Uu]nity/**`, `**/[Cc][Mm]ock*/**`, `**/[Cc]pp[Uu][Tt]est/**` |
| 컴파일·목록 출력 | `**/[Oo]bj/**`, `**/[Oo]bjects/**`, `**/[Ll]istings/**` |
| IAR 탐색·정적 분석 정보 | `**/BrowseInfo/**`, `**/C-STAT/**` |
| IAR 출력 중 일반적인 이름 | `**/EWARM/**/List/**`, `**/EWARM/**/Exe/**` |

`Debug`, `Release`, `generated`, `MDK-ARM`, `EWARM` 전체는 자동 제외하지 않습니다. PlatformIO의 `.pio/build`는 기존 `**/build/**`로 제외하고, 의존 소스가 있는 `.pio/libdeps`는 유지합니다.

1. C 소스 폴더를 연 VS Code 창에서 명령 팔레트의 **Preferences: Open Workspace Settings (JSON)**을 실행합니다. WSL 프로젝트라면 WSL에 연결된 창에서 설정합니다.
2. 설정 객체에 `dynsight.include`와 `dynsight.exclude`를 필요에 맞게 추가하고 저장합니다. 기존 설정이 있다면 다른 항목을 지우지 말고 이 항목을 합칩니다. 일반적인 단일 폴더 프로젝트에서는 `.vscode/settings.json`에 저장됩니다.

```json
{
  "dynsight.exclude": [
    "**/Tools/Polyspace/**",
    "**/build/**"
  ]
}
```

3. 저장하면 자동으로 다시 분석합니다. 하단 상태가 **Indexing C sources…**에서 **Index ready**로 바뀌는지 확인한 뒤 원본 `.c` / `.h`의 함수 이름을 클릭합니다. 필요할 때만 **Rebuild index**로 전체 분석을 다시 실행하세요.

위 예시는 전체 C/H 파일 중 Polyspace와 build만 제외합니다. **App과 Drivers만 분석하면서 그 안의 generated와 test는 제외**하려면 다음과 같이 설정합니다.

```json
{
  "dynsight.include": ["App/**", "Drivers/**"],
  "dynsight.exclude": ["**/generated/**", "**/test/**"]
}
```

| Include | Exclude | 분석 범위 |
| --- | --- | --- |
| 비어 있음 (`[]`) | 비어 있음 (`[]`) | 전체 C/H 파일 (기본 제외 폴더는 제외) |
| 설정 | 비어 있음 | Include에 일치하는 C/H 파일 |
| 비어 있음 | 설정 | 전체 C/H에서 Exclude를 제외 |
| 설정 | 설정 | Include에 일치하는 C/H에서 Exclude를 제외 |

**Exclude가 최종 우선**입니다. Include는 패턴 중 하나에 일치하면 포함하며, 겹치는 패턴으로 같은 파일을 중복 분석하지 않습니다. v0.1.19부터는 `App/**/*.{c,h}`와 `Drivers/**`처럼 중괄호 패턴과 다른 패턴을 함께 써도 각각의 의미를 유지합니다. Include가 설정되어 있지만 일치하는 파일이 없으면 분석 결과는 0개입니다. 전체 범위로 돌아가려면 Include를 `[]`로 비우세요.

Settings 화면에서는 `@id:dynsight.include` 또는 `@id:dynsight.exclude`를 검색하고 **Workspace** 범위에서 항목을 추가할 수 있습니다. 폴더 안의 모든 파일을 지정할 때는 `App` 대신 `App/**`처럼 작성하세요. 폴더 패턴에 다른 종류의 파일이 있어도 분석은 C/H 파일만 대상으로 합니다.

패턴을 직접 입력하지 않으려면 Include/Exclude 설명의 **Select folders…**를 누르세요. **Add folders…**에서 하위 폴더를 여러 개 선택하고, 목록에서 불필요한 규칙을 선택해 제거한 뒤 **Apply**로 한 번에 저장합니다. **Esc**로 닫으면 변경을 버립니다. Include의 **Analyze all C/H files**는 전체 분석으로 돌아가며, Include가 비어 있을 때 폴더를 추가하면 선택한 경로만 분석합니다. 기존 `**` 같은 광범위한 glob은 보존하므로 범위를 좁히려면 목록에서 해당 규칙을 제거하세요. Exclude에 걸리는 폴더에는 일치하는 폴더 제외 규칙을 표시합니다. 기본 제외 복원과 기존 glob 직접 편집도 가능합니다. 설정 편집으로 이동하면 선택기의 미적용 변경은 버립니다.

탐색기에서도 폴더를 여러 개 선택한 뒤 우클릭 → **Dynsight → Add to Analysis Include / Exclude from Analysis**로 같은 검토 목록을 열 수 있습니다. 여러 루트를 연 경우 각 루트의 설정으로 저장하며, 기본 Exclude와 직접 작성한 기존 패턴은 추가 시 유지합니다. 이 선택기는 일반 분석 범위용이며 **Smart Analysis**의 Macro/AI 범위와는 별개입니다.

워크스페이스 루트를 Include로 선택하면 기존 Include를 비워 검색 제한이 적용되는 전체 C/H 분석으로 돌아갑니다. 루트를 Exclude로 선택하면 전체 파일을 제외합니다. 폴더별 설정이 적용되는 경우 설정 편집은 선택한 루트의 설정을 엽니다. `node_modules`, `.git`, `.vscode-test`에는 설정으로 해제할 수 없는 고정 제외라는 안내를 표시합니다.

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
- `files.exclude`, `search.exclude`, `C_Cpp.files.exclude`는 이 확장의 분석 범위에 적용되지 않습니다. `dynsight.include`와 `dynsight.exclude`를 사용하세요.
- `node_modules`, `.git`, `.vscode-test`는 기본으로 제외합니다. 사용자 제외 후에도 초기 분석 대상이 10,000개를 넘으면 **Partial index**가 표시됩니다. 불필요한 경로를 더 제외하거나 필요한 소스 폴더를 별도로 여세요.

## Smart Analysis 범위 선택

**Settings → Smart Analysis: Include → Select folders…**에서 매크로 확장과 콜백 추론을
수행할 폴더를 함께 선택합니다. Include/Exclude는 기본 색인 범위를 정하며 Exclude가
우선합니다. 상세 범위를 줄이면 본격적인 전파 자료와 작업량도 줄입니다.

```json
{
  "dynsight.include": ["App/**", "SDK/**"],
  "dynsight.smartAnalysis.include": ["App/control/**"],
  "dynsight.smartAnalysis.exclude": ["App/control/generated/**"],
  "dynsight.smartAnalysis.macro": true,
  "dynsight.smartAnalysis.ai": false
}
```

기본 탐색이 먼저 준비되고 상세 결과는 추가됩니다. 전체 작업량은 배치 단위로 누적하며
매크로 때문에 콜백이 시작부터 차단되지 않습니다. 개별 함수·구조적 한도 또는 메모리
한도에 도달하면 확보한 결과와 미해결 이유를 유지합니다. 범위를 바꾸거나 중단했는데
모든 호출 관계가 완전해졌다고 표시하지 않습니다.

## 업데이트

확장이 실행되면 GitHub의 정식 릴리스를 자동 확인합니다. 마지막 성공한 확인 후 24시간 이내에는 반복 요청하지 않습니다. 확장이 실행 중이면 한 시간마다 확인 시각을 점검하므로, 다음 자동 확인은 마지막 성공 후 약 24~25시간 뒤에 실행됩니다. v0.1.22부터 네트워크 오류나 잘못된 릴리스 정보는 성공 시각을 갱신하지 않고 다음 시간에 재시도합니다. 개발·테스트 모드에서는 자동 확인하지 않습니다.

새 버전이 있으면 현재/새 버전과 변경 내역을 보여줍니다. **Update**를 선택한 경우에만 VSIX를 다운로드하고 설치합니다. **Later** 또는 창 닫기는 설치하지 않습니다. 설치 후에도 **Reload Window**를 선택해야 다시 로드합니다.

- 수동 검사: 명령 팔레트 → **Dynsight: Check for Updates**.
- 새 릴리스가 게시돼도 즉시 알림이 오는 방식은 아닙니다. 바로 확인하려면 수동 검사를 실행하세요. 수동 검사는 24시간 제한을 건너뛰며, 현재 버전이 최신이면 안내만 표시합니다.
- 자동 검사 끄기: VS Code 사용자 설정의 **Dynsight → Automatic Updates** 해제 (`dynsight.automaticUpdates`).
- 업데이트 소스: [GitHub Releases](https://github.com/mrdylee/vscode_extension_relation_window/releases). 커밋만 푸시한 버전과 시험판은 설치하지 않습니다.
- 릴리스가 없으면 수동 검사에서 안내합니다. 자동 검사 중 오프라인/요청 제한은 조용히 처리하며, 수동 검사 또는 동의 후 설치 실패는 오류를 표시합니다.
- 버전·릴리스 파일·크기 및 제공된 SHA-256 체크섬을 확인합니다. 자동으로 코드를 보안 심사하는 기능은 아닙니다. 로컬 데스크톱 배포를 대상으로 하며 원격 환경의 자동 설치는 미검증입니다.

### 새 버전 배포하기

게시 전 순서는 **수정 → 테스트 → review-work → 지적 사항 수정·재검증 → 푸시·릴리스**입니다. 테스트 통과만으로 검토를 생략하지 않습니다. 검토 범위·발견 사항·해결 여부를 기록한 뒤 게시합니다.

큰 기능별 검토가 끝나면 `checkpoint/<feature>-reviewed-<date>` 태그로 개발 상태를 보존합니다. 배포는 `v0.1.28` 같은 버전 태그를 사용하며, 기존 태그를 다른 커밋으로 옮기지 않습니다.

1. `package.json`, `package-lock.json`의 버전 및 `package` 스크립트의 VSIX 이름을 함께 올리고 CHANGELOG를 작성합니다.
2. `docs/releases/<버전>.md`에 변경 사항과 설치 안내를 작성합니다.
3. 변경을 커밋·푸시한 뒤 `v0.1.10` 같은 버전 태그를 푸시합니다. 태그와 패키지 버전이 일치해야 합니다.
4. GitHub Actions가 Windows·macOS·Ubuntu 검증을 통과한 후 Windows·macOS·WSL용 VSIX와 SHA-256 목록을 정식 릴리스로 게시합니다. 접미사 없는 공통 VSIX 이름은 자동 업데이트가 사용하므로 유지합니다.
5. 이전 버전에서 **Check for Updates**를 실행해 확인합니다. 일반 커밋만으로는 릴리스가 생성되지 않습니다.

## 탐색

- **References**: 호출, 함수 주소 참조, 함수 선언을 함께 표시합니다. 함수 포인터 테이블은 변수 아이콘으로 표시합니다.
- **Callers**: 직접 호출, 매크로 확장 호출과 추정 콜백 호출을 표시합니다. 그래프는 선택한 함수에서 **호출하는 쪽으로** 펼쳐집니다.
- **Callees · Called functions**: 선택한 함수가 **호출하는 대상 쪽으로** 펼쳐집니다. 반복 호출은 노드 하나로 묶고 팝업에 실제 호출 위치를 모두 표시합니다. 자식 노드를 클릭하면 Context에서 호출 위치를 미리 보며, 선택한 단계만큼 대상 함수의 호출을 추가로 펼칩니다. Enter/더블클릭은 해당 호출 위치를 엽니다.
- **Callers & Callees**: 기본은 선택한 함수 왼쪽에 호출자, 오른쪽에 호출 대상을 표시하며 **Settings → Call Graph Direction**에서 좌우를 바꿀 수 있습니다. 그래프 전체를 왼쪽부터 표시하고 선택 함수를 화면 가운데로 자동 이동시키지 않습니다. 배치를 바꿔도 펼친 가지·선택·Callees 정렬을 유지합니다. 전체 300개 노드 제한을 공유합니다.
- **Settings → Callee Sort**: 기본 이름순과 소스의 첫 호출 위치순을 선택합니다. 반복 호출은 한 노드로 묶으며 팝업의 위치 목록은 소스순입니다. 소스순은 실제 실행 순서를 의미하지 않습니다. 선택은 프로젝트별로 저장됩니다.
- **Relation 배경을 왼쪽 버튼으로 드래그**하면 그래프를 이동합니다. 우클릭의 **Reset graph position**으로 되돌립니다. 심볼 클릭·더블클릭과 Context 텍스트 선택은 그대로 사용할 수 있습니다.
- 고정 중에는 **Pinned · Follow paused** 옆의 **↩ Pin** 버튼으로 고정한 심볼 위치로 돌아갈 수 있습니다. 메인 편집기와 Context가 해당 심볼을 표시하고 Relation에서도 핀이 꽂힌 루트가 보이도록 이동합니다. 고정 상태와 펼친 가지는 유지됩니다.
- **콜백 추적:** `Following selection` 상태에서 `cb()`의 `cb` 또는 `ops->callback()`의 `callback`을 클릭하면 **Callback targets**에 실제 호출 대상 후보가 표시됩니다. 함수 이름·파일 위치를 확인하고 후보를 선택하면 해당 함수의 Relation으로 이동하며 Pin도 설정할 수 있습니다. 후보 하나도 실행 확정을 뜻하지 않으며, 미확정 경로는 **Other targets may exist**로 표시합니다. 기존 인덱스를 재사용하므로 클릭으로 전체 재분석을 시작하지 않습니다. `Include Function Arguments`는 이 추적에 필요하지 않습니다.
- **콜백 등록:** `fp = handler`, `fp = &handler`, `ops.cb = handler`, `.cb = handler`처럼 함수를 대입하면 호출이 없어도 Callers/Callees에 **Registration**으로 표시합니다. 전역 초기화의 등록 주체는 해당 변수, 지역 초기화·대입의 등록 주체는 해당 함수입니다. `Analyze Callbacks`를 꺼도 등록 관계와 단순 함수 포인터·지역 구조체 멤버의 호출 후보를 찾습니다. 등록은 실행을 뜻하지 않으며, 호출 위치에서 찾은 **Registered candidate**와 구분합니다. `fp = factory()`의 반환값은 명시적 함수 등록으로 취급하지 않습니다.
- **콜백 진단:** 대상이 없으면 **Callback analysis**가 자동으로 펼쳐집니다. getter 본문 누락(`Return value unavailable`), 인자 공급 경로 누락(`Argument … has no indexed supply`), 객체 연결·멤버 값 미확인(`Object connection unavailable` / `Member value unavailable`), 구조체 정의 미확인(`Structure layout unavailable`)을 확인하세요. 이는 색인에서 확인하지 못한 정보이며 실제 실행 오류를 뜻하지 않습니다.
- **Settings → Context Layout**: **Combined · Full width**는 하단 전체를 사용합니다.
  **Left sidebar full height**는 왼쪽 패널을 아래까지 유지하고 Combined를 중앙·오른쪽
  하단에 배치합니다. **Right sidebar full height**는 오른쪽 패널을 유지하고 중앙·왼쪽
  하단을 사용합니다. **Center**는 양쪽 패널을 유지하고 편집기 바로 아래만 사용합니다.
  VS Code 패널 정렬을 사용하므로 Terminal 등 다른 하단 뷰도 같은 배치를 따릅니다.
  기본 Combined나 Separate로 돌아가면 Center 정렬을 복원합니다. Separate는
  **Dynsight Context**를 Explorer의 독립 뷰로 열며, 제목줄을 드래그해 옮길 수 있습니다.
  모든 배치는 분석 인덱스·미리보기·코드 이동·고정 상태를 공유합니다.
- **Macro-expanded call**은 매크로 확장으로 찾은 호출입니다. **Inferred call**은 정적 분석으로 찾은 함수 포인터·콜백 후보이며 점선 아이콘과 근거 위치를 표시합니다. **Macro invocation**은 확장하지 못한 호출, **Indirect call**은 아직 모르는 간접 대상, **Unresolved call**은 분석 범위에 정의가 없는 호출입니다. 미확정 대상은 말단 노드로 남깁니다.
- 함수 이름 선택: 해당 정의를 Context에서 미리 봅니다.
- Relation 노드는 **아이콘 + 심볼 이름 한 줄**로 표시합니다. 마우스를 같은 노드 위에서 500ms 동안 멈추거나 노드에 포커스를 두고 Space를 누르면 상세 팝업이 열립니다. Escape로 닫습니다.
- 상세 팝업의 `파일:줄:열` 선택: 그 호출/참조 위치를 Context에서 강조합니다. 같은 함수 안의 반복 호출도 각각 선택할 수 있습니다. 노드에서 Tab을 누르면 팝업의 버튼으로 이동합니다.
- **Relation 노드 한 번 클릭**은 Context를 바꾸고, 클릭한 심볼에서 상단 깊이만큼 호출·참조 관계를 펼칩니다(v0.1.17 이상). `1 level`이면 한 단계, `2 levels`이면 두 단계입니다. 기존 루트와 다른 가지는 유지하며 이미 더 깊게 펼친 가지는 접지 않습니다. 같은 노드를 반복 클릭해도 무한히 추가 확장하지 않습니다. **더블클릭/Enter**는 메인 편집기에서 해당 코드를 엽니다.
- **Context 코드 한 번 클릭**은 메인 편집기를 클릭한 줄·토큰의 시작으로 이동하고, 고정 해제 상태에서는 Relation도 클릭한 함수·변수로 바꿉니다. 고정 중에는 메인 코드만 이동합니다. 줄 번호나 빈 공간을 클릭하면 해당 줄 시작으로 이동합니다. 드래그로 텍스트를 선택하면 복사를 위해 이동하지 않습니다. 미리보기가 실제 편집 내용보다 오래된 경우에는 잘못된 위치로 이동하지 않습니다.
- 상단 **1 level ~ 8 levels**는 전체 기본 깊이, 상세 팝업의 **Levels…**는 그 노드에서 추가로 펼칠 깊이입니다.
- 노드 제목에 포커스를 두고 **→** 펼치기, **←** 접기, **Shift+→** 추가 깊이를 지정합니다. Tab으로 노드와 위치 사이를 이동합니다.
- 버튼은 현재 상태를 표시합니다. **Following selection**이면 메인 편집기와 Context에서 선택한 심볼을 따라 Relation이 바뀝니다. Relation에서 원하는 노드를 클릭한 뒤 이 버튼을 누르면 **해당 심볼을 새 루트로 고정**합니다. 노드를 선택하지 않았다면 현재 루트를 고정합니다. 고정 중에도 다른 노드를 우클릭하여 **Pin this symbol**로 고정 대상을 바꿀 수 있습니다. **Pinned · Follow paused** 버튼을 다시 누르면 자동 추적을 재개합니다. 고정 중에도 Context 클릭으로 메인 코드 위치는 이동합니다.
- 가운데 구분선을 드래그하거나 구분선에 포커스를 두고 좌우 키로 영역 너비를 조정합니다.
- `ƒ` 함수, `v` 변수, `T` 타입, `#` 매크로를 구분합니다. 구조체·union 멤버도 `v` 아이콘으로 표시하며, 타입 자체의 사용처는 아직 수집하지 않습니다.
- 점선 아이콘은 조건부·후보·재귀 상태가 있음을 나타냅니다. 정확한 상태는 상세 팝업에 표시합니다.
- Context에서 함수명, 기본 타입과 `_t` 타입 이름, 키워드, 변수, 숫자, 대문자 매크로/상수, 문자열, 주석, 전처리 지시자를 색으로 구별합니다. 밝은/어두운 VS Code 테마에 맞는 색을 사용합니다. 임의의 사용자 정의 타입과 매크로를 완전히 판별하는 의미 분석은 아닙니다.
- 미저장 편집과 파일 추가·변경·삭제를 자동 반영합니다. 변경 없는 파일을 탐색하거나 닫을 때는 기존 인덱스를 재사용합니다. 수정 취소와 외부 파일 변경은 다시 반영합니다. 인덱스는 현재 창의 메모리에 유지되며, 창을 다시 열거나 **Rebuild index**를 실행하면 새로 분석합니다.

## 콜백 제한 진단 (v0.1.52)

**Analysis notices**에서 콜백·매크로 제한을 문법 경고보다 먼저 보여줍니다.
콜백 경고에는 실제 관찰된 파일·행·함수와 `stage`(단계), `project`(프로젝트 경과 ms),
`scope`(현재 함수 방문/초기화 처리의 경과 ms), `evaluations`(현재 범위/프로젝트 평가 횟수)가 표시됩니다.
상세 기록은 추론 실행당 최대 64개이며 `scope`는 여러 전파 회차의 누적 시간이 아닙니다.

프로젝트 전체를 10초에 중단하던 제한은 제거했습니다. 하단의 **Local**은 현재 분석 중인
함수와 해당 방문의 경과 시간을 보여주며, 다음 함수로 이동할 때 초기화합니다. 5초 이상이면
**Taking longer**로 표시하지만 자동 중단하지 않습니다. 실제 콜백 실행 시간이 아니라
정적 함수 요약의 처리 시간입니다. **Stop local**로 중단하면 이미 찾은 대상을 불완전
결과로 유지하며, **Retry local**은 파싱한 소스를 재사용해 관계 분석을 다시 시도합니다.
명령 팔레트에서도 **Dynsight: Stop Local Analysis / Resume Local Analysis**를 사용할 수 있습니다.
메모리·작업량·256슬롯·전파 반복 제한은 유지합니다. 이전 10초 정책의 캐시는 원본 파싱을
재사용하고 관계만 자동 재계산합니다. 이 기능은 AI 활성화 설정을 바꾸지 않습니다.

표준 정수 typedef와 배열 원소의 타입을 보존해, 콜백에 쓰이지 않는 정수·바이트 쓰기는
변경 요약에서 제외합니다. 외부 `memcpy`·`memmove`·`memset`은 목적지의 바이트만 변경하는
것으로 처리하며, 원본이나 포인터 필드가 가리키는 객체까지 변경한다고 보지 않습니다.
복사·초기화된 바이트의 콜백 값은 확정하지 않고, 관련 저장소의 변경만 캐시 재평가에 반영합니다.

동적 오프셋으로 넘긴 버퍼도 주소 선택에 필요한 값과 버퍼 내용을 구분합니다.
`&table[1]`을 받은 함수의 `p[1]`은 `table[2]`에 연결하며, 실제 다차원 배열은 차원을 유지합니다.
정상 GNU `__attribute__((section(...)))` 선언은 위치 정보를 유지해 복구 파싱합니다.
잘못된 속성 구문이나 다른 문법 오류는 계속 경고합니다.

경고를 펼쳐 촬영하면 위치를 확인할 수 있습니다. **Report issue**의 `callbackLimits`에는
함수명·경로를 제외한 분류와 수치만 담습니다. 실제 프로젝트의 모든 미해결 콜백이
이 변경으로 해결되는 것은 아닙니다.

## 콜백 분석 범위

새 작업 공간에서는 **Smart Analysis Include / Exclude**를 사용합니다. 기존
`dynsight.analyzeCallbacks`와 `dynsight.macroExpansionFolders`는 통합 설정 저장 전의
호환 옵션입니다. 단순 등록·직접 호출·문자 그대로 전달한 함수 인자는 기본 분석에 남고,
여러 함수를 거치는 별칭·콜백 전파는 상세 범위에 적용합니다.

## 함수 인자 전달 관계 (v0.1.31)

**Settings → Include Function Arguments**를 켜면 기존 **Callers / Callees /
Callers & Callees**에 함수를 인자로 넘긴 관계도 함께 표시합니다. 기본값은
꺼짐이며, 변경 시 기존 인덱스를 사용해 그래프만 갱신합니다.

```c
int priv_task_data(void *ctx) {
    return svc_call_nonblock(ctx, a_func);
}
```

이때 `a_func`의 Callers에 `priv_task_data`가 표시되고, `priv_task_data`의
Callees에는 직접 호출한 `svc_call_nonblock`과 인자로 넘긴 `a_func`가 표시됩니다.
인자 전달만 있는 가지는 **하늘색 점선 연결선**, 실제 호출과 섞인 가지는 실선으로
표시합니다. 팝업에서 **Function argument #2 · via svc_call_nonblock**으로
구분합니다. 한 번 클릭하면 원래 인자 위치를 Context에서 보고, Enter/더블클릭하면
그 위치를 메인 편집기에서 엽니다. 기존 16×16 아이콘과 조건부·후보·재귀의 점선
아이콘 테두리는 유지합니다.

함수를 넘겼다는 사실만으로 실행·등록·비동기 동작을 확정하지 않습니다.
`svc(a_func())`는 반환값을 넘기는 것이므로 `a_func`의 인자 전달 관계가 아닙니다.
직접 함수명과 함수 주소는 가볍게 수집하며, 별칭·멤버·테이블·함수 반환값은 기존
포인터 분석이 이미 실행되는 경우의 알려진 후보만 재사용합니다. 이 기능 때문에
무거운 전체 포인터 분석을 새로 강제하지 않으므로 일부 별칭은 표시되지 않을 수
있습니다. References와 변수 R/W 필터에는 영향을 주지 않습니다.

JSON 설정은 `"dynsight.includeFunctionArguments": true`입니다. VSIX에 포함된
**Help → Function arguments**에서도 같은 사용법을 확인할 수 있습니다.

## 변수 읽기·쓰기 탐색

메인 편집기에서 변수를 선택하면 같은 Relation 창의 선택 메뉴가 **Variable · All uses / R · Read / W · Write / RW · Read/write / & · Address passed**로 바뀝니다. 사용한 함수별로 묶고, 한 줄 노드의 작은 색상 표시로 접근 종류를 구분합니다.

- **R**: 값 읽기. **W**: 직접 대입(`state = 1`)과 명시적 초기화(`int state = 0`). 초기값 없는 선언은 쓰기로 세지 않습니다.
- **RW**: 복합 대입(`+=` 등), 증가·감소(`++`, `--`). 읽기 필터와 쓰기 필터 양쪽에 포함됩니다. RW 필터는 RW만 표시합니다.
- **&**: 주소 사용(`&state`). 주소를 저장하거나 전달하는 위치를 표시하며, 이후 실제 변경 여부는 추론하지 않습니다.
- 사용 함수 노드를 클릭하면 **첫 번째 일치하는 사용 줄**을 Context에 표시합니다. 상세 팝업에서 같은 함수의 나머지 사용 위치도 선택할 수 있습니다.
- 단계를 늘리면 사용 함수의 상위 호출·참조 관계도 이어집니다. 함수 선택으로 돌아가면 기존 References/Callers/Callees 선택이 유지됩니다. Callees를 선택했더라도 변수는 계속 사용 위치와 상위 호출자를 보여줍니다.
- 지역 변수·매개변수와 전역 변수의 이름 가림을 구분하며, 일반적인 `extern` 선언은 찾을 수 있는 정의에 연결합니다.

이 읽기·쓰기 목록은 구문에 드러난 접근만 분류합니다. `*p = 1`은 포인터 `p`의 읽기이며 가리키는 대상의 쓰기는 추적하지 않습니다. 구조체·union의 이름 있는 멤버는 아래 범위에서 구분합니다. 배열 요소의 쓰기와 별칭을 통한 변수 접근은 목록에 추가하지 않습니다. `sizeof`/`_Alignof` 안의 식은 접근 목록에서 제외하며, 가변 길이 배열 때문에 평가되는 예외는 분석하지 않습니다. 매크로 인자 역시 확장 전 구문 기준이므로, 매크로가 실제로 수행하는 읽기·쓰기를 보증하지 않습니다.

## 구조체·union 멤버 탐색

v0.1.26부터 `m->state` 또는 `m.state`의 **state**를 클릭하면 선언된 타입을 따라 `Motor.state`처럼 표시합니다. 같은 이름의 `Sensor.state`나 전역 `state`와 구분합니다. 멤버 선언에서도 선택할 수 있으며, 기존 R/W/RW/& 필터, 실제 사용 위치 미리보기, 사용 함수의 상위 호출자 탐색을 그대로 사용합니다. 팝업에는 **Member of Motor**처럼 소유 타입을 표시합니다.

```c
struct Motor { int state; };
struct Sensor { int state; };
void run(struct Motor *m, struct Sensor *s) {
    m->state = 1;  // Motor.state: W
    s->state++;   // Sensor.state: RW
}
```

- 선언된 변수·매개변수 타입, typedef와 포인터 typedef, 배열 인덱스, 괄호·역참조, 이름 있는 중첩 멤버, union과 비트필드를 지원합니다.
- 타입 헤더도 Include/Exclude 분석 범위 안에 있어야 합니다. 간접 include를 따라가며, 따옴표 include는 실제 상대 경로를 우선합니다. 빌드의 헤더 검색 경로를 알 수 없거나 조건부 정의가 여러 개면 가능한 후보를 남깁니다.
- v0.1.32부터 `((Motor *)p)->state`의 명시적 타입, `get_motor()->state`의 선언된 반환 타입, 익명 struct/union이 승격한 멤버도 연결합니다. 함수 구현 없이 선언만 있어도 반환 타입을 사용할 수 있습니다. 캐스트는 코드에 적힌 타입을 사용하며 실제 객체 타입의 보증은 아닙니다.
- `Motor m = { .state = 1 }` 같은 지정 초기화는 원본 멤버 토큰에서 W로 표시합니다. 중첩 지정 경로, 배열, compound literal, 명확한 중괄호 위치 초기화를 지원합니다. 중간 경로의 멤버도 클릭할 수 있지만 상위 필드 전체를 쓴 것으로 표시하지 않습니다. 함수 내부 초기화는 해당 함수에, 전역 초기화는 초기화한 변수에 연결합니다.
- 이름만 같은 멤버로 연결하지 않습니다. 매크로 생성 타입, 중괄호 생략이 있는 초기화, 지정 초기화 뒤의 위치 초기화는 불완전하며 조건부 필드 배치도 미확정으로 남을 수 있습니다. 지원하지 않는 멤버 수식/초기화 경로는 **Analysis notices**로 알립니다. 헤더 누락 등으로 타입을 알 수 없는 경우에도 관계가 빠질 수 있습니다.
- `m->ptr`와 `m->items`의 R/W 접근은 해당 필드 자체를 대상으로 합니다. 포인터가 가리키는 값이나 배열 원소의 변경을 필드 전체의 쓰기로 추론하지 않습니다. 함수 포인터 멤버의 호출 대상 추정은 아래 기능으로 별도 처리합니다.
- 과도한 탐색을 막기 위해 타입/식 추적은 최대 32단계, 중간 후보는 최대 64개로 제한합니다. 이 범위를 넘으면 일부 관계가 표시되지 않을 수 있습니다.

## 비활성 코드 처리

**Skip inactive branches**는 기본으로 켜져 있습니다(`dynsight.skipInactive`). 리터럴 `0`/`1` 조건과 그 `#else`, `#elif`, 중첩을 처리합니다. 제외해도 Context의 원본 코드는 지우지 않습니다.

`#if BOARD_PRO`, `#ifdef`, `#ifndef`, `defined(...)`, 계산식 등은 빌드 설정 없이 참/거짓을 확정하지 않습니다. 양쪽의 가능한 코드를 남기고 **Conditional**로 표시합니다. 매크로 호출 확장에는 순서에 따른 `#define`·`#undef`와 색인된 헤더를 사용하지만, 빌드 옵션까지 반영하는 전체 전처리기는 아닙니다. 옵션을 끄면 `#if 0` 영역도 관계 색인에 포함됩니다.

## 매크로와 콜백 호출 분석 (v0.1.28)

별도 빌드 설정 없이 기존 **Callees / Callers / References**에서 사용합니다. 헤더와 콜백 등록 함수도 Include 범위에 넣고 **Index ready**를 기다리세요.

- 객체형·함수형 매크로, 중첩 인자 확장, 문자열화, 토큰 붙이기, 가변 인자와 리터럴 include를 처리합니다. 팝업에서 확장 경로와 코드를 보고 원래 호출 위치로 이동합니다. 계산된 include 경로나 빌드별 헤더 인스턴스화는 지원하지 않습니다.
- 지역 포인터의 초기화·대입·별칭, 분기/반복, 함수 인자 전달·등록·반환, 정적 상태, 구조체 콜백 테이블과 배열을 추적합니다. 알려진 배열 인덱스는 분리하고 모르는 인덱스는 가능한 항목을 모읍니다.
- 구조체 정의가 색인에 없어도 `.cb_preprocess = target`처럼 직접 명시한 멤버 초기화는 해당 객체에 보존합니다. 테이블 주소를 getter로 반환하고 등록 함수의 인자로 전달해 포인터에 저장하는 경로도 추적합니다. 타입 정보가 없을 때 `{target, other}`의 필드 순서는 추측하지 않습니다.
- 알려진 객체는 구분하지만, 가리키는 객체를 모르는 포인터 필드는 같은 선언 단위로 후보가 합쳐질 수 있습니다.
- **Inferred call** 팝업의 **Evidence**를 클릭하면 함수 주소·대입·인자 전달 근거를 Context에서 봅니다. Enter/더블클릭은 그 근거 위치를 편집기에서 엽니다. 노드 클릭은 실제 간접 호출 위치를 보여주며 대상 함수의 다음 호출도 펼칠 수 있습니다.
- 추정은 실행 대상의 보증이 아닙니다. 외부 호출에 의한 변경, 미확인 값이나 한계 도달은 **Other targets may exist**와 미확정 간접 호출로 남깁니다. 임의 주소, 바이트 단위 메모리 조작, 모든 캐스트/포인터 산술과 런타임 동적 연결을 정확히 해석하지는 않습니다.

예를 들어 다음 코드에서 run의 Callees에는 target이 점선 후보로 표시되고, 클릭하면 ops.run() 위치를 보여줍니다.

    typedef void (*CB)(void);
    void target(void) {}
    struct Ops { CB run; };
    struct Ops ops = { .run = target };
    void run(void) { ops.run(); }

분석은 Worker에서 수행합니다. 매크로는 대안 32개·중첩 32단계·함수당 토큰 40,000개, 콜백은 값/별칭 후보 64개·함수당 변경 슬롯 256개·프로젝트 전파 12회·루프 전파 4회로 제한합니다. 전체 시간 제한은 없으며 **Stop local**로 중단할 수 있습니다. 보호 한도나 수동 중단에 도달하면 **Analysis notices**와 미확정 대상을 남깁니다. 분석 범위를 좁히면 더 많은 대상이 확인될 수 있습니다. 함수 사이의 일반 정수 값은 전달하지 않아 인덱스 후보가 넓어질 수 있으며, 주소를 정수 저장소에 넣었다 복원하는 패턴은 미확정으로 처리합니다. 소스 폴더 전체의 모든 빌드 조합이나 실행 경로를 증명하는 도구는 아닙니다.

## 정확도와 범위

### 문제 신고하기 (v0.1.46)

**Diagnostics → Report issue** 또는 명령 팔레트 **Dynsight: Report Issue**를
실행하면 현재 진단, 최근 실행 기록, 확보 가능한 호스트 로그를 모아 수정 가능한
Markdown 보고서를 엽니다. 증상과 발생 시각을 적고 알림의 **Save report**로 `.md`
파일을 저장해 공유하세요. **Copy report**는 복사만 하고, **Copy & Open GitHub**는
복사 후 신고 페이지를 엽니다. 보고서가 길면 파일 첨부를 사용하세요.
자동 업로드나 자동 Issue 제출은 없습니다.

v0.1.47부터 Diagnostics의 **Search results / Selected / Indexed / Failed / Unaccounted**
기록으로 파일 수가 줄어든 단계를 구분할 수 있습니다. Search results는 검색 API가
돌려준 결과 수(중복·비 C/H 파일 포함 가능), Selected는 필터와 개수 제한을 적용한
고유 C/H 대상 수입니다. 나머지는 Rebuild 종료 시 그 대상의 성공·실패·미반영 수입니다.
검색 자체가 모든 파일을 찾았다는 보장은 아니며, 오류나 개수 제한으로 중단된 검색은 **Discovery: unfinished**로
표시합니다. 파일 읽기·분석 실패가 있으면 `Index ready` 대신 `Partial index`를 표시합니다.
이전 Rebuild 기록과 현재 파일 수는 이후 편집·삭제로 달라질 수 있습니다.

확장 실행 중 10초 간격과 분석 상태·Relation 조작 변화 시 작은 진단 기록을
작업공간별 확장 저장소에 남깁니다. 최근 3회 실행, 실행당 256 KiB 파일 2개로
제한하며 소스·함수명·파일 경로·설정값은 기록하지 않습니다. 호스트가 갑자기
종료되어도 저장된 이전 실행 기록은 남습니다. 아직 저장되지 않은 마지막 기록은
유실될 수 있고, 호스트가 멈춘 동안에는 새 기록을 만들 수 없습니다. Worker 수치는
마지막 수신값이며 `sampledAt`을 확인하세요. 프로세스 RSS는 다른 확장과 Worker를
포함한 공유 프로세스 수치입니다.

호스트 로그는 알려진 VS Code 로그 위치의 현재/직전 세션에서 `exthost.log`와
`remoteagent.log`만 제한적으로 읽어 종료·재시작·메모리 오류 줄을 추립니다.
파일당 마지막 64 KiB, 최대 8개 파일을 읽습니다. 경로·권한·버전 차이로 읽을 수
없으면 보고서에 표시합니다. WSL에서 Windows 쪽 Window 로그는 수집하지 않습니다.
기록 파일은 구간당 마지막 16 KiB만 보고서에 포함하므로 전체 로그가 아닙니다.

**진단 요약과 자체 기록에는 소스·함수명 등을 넣지 않지만, 호스트 로그에는 개인
정보가 남을 수 있습니다.** 알려진 사용자·작업 폴더 경로와 URL은 가리며, 모든 민감
정보 제거를 보장하지는 않습니다. 이전 세션이 다른 작업공간일 수도 있으므로
보고서와 첨부물을 확인한 뒤 공유하세요. 보고서 생성은 인덱스를 재생성하거나
Worker 분석을 요청하지 않습니다. 기존 문제는
[GitHub Issues](https://github.com/mrdylee/vscode_extension_relation_window/issues)에서
확인할 수 있습니다.

### 갑자기 다시 인덱싱할 때 (v0.1.45)

오류 알림이 없어도 **Diagnostics → Last rebuild**에서 가장 최근 재인덱싱의
시각과 시작 원인을 확인할 수 있습니다. `Extension startup`은 확장이 새로
시작한 경우, `Analysis settings changed`는 Include/Exclude 등 분석 설정 변경,
`Workspace folders changed`는 작업 폴더 변경, `Rebuild command/button`은
명령 또는 버튼 실행을 뜻합니다. 설정 변경은 관련 항목 이름만 표시합니다.

**Rebuild history and source activity**를 펼치면 최근 5회 이력, 처리 결과·소요
시간, 이번 실행의 소스 분석·호출 관계 계산 횟수와 마지막 파일 이벤트를 볼 수
있습니다. 파일 이벤트가 있어도 내용이 같으면 분석을 생략하므로 이벤트와
실제 분석 횟수는 다를 수 있습니다. 다시 발생하면 수동 Rebuild/창 재시작 전에
이 화면을 촬영하거나 **Report issue**를 저장하세요. Diagnostics 화면의 이력은 창 재시작 시
초기화되며, 실행 시작 시각으로 같은 실행 안의 재분석과 새 실행을 구분합니다.
v0.1.46부터 Report issue에는 디스크에 저장된 이전 실행 기록도 포함됩니다.
이 기록 자체가 원인 해결을 의미하지는 않습니다.

### 메모리 문제를 사진으로 공유하기 (v0.1.38)

Relation 하단 **Diagnostics**를 누르면 사진 한 장에 담을 수 있는 진단 요약이
열립니다. 메모리 제한이나 Worker 종료가 감지되면 자동으로 한 번 열립니다.

1. 문제가 발생하면 **Rebuild index / Reload Window 전에** Diagnostics를 여세요.
2. 필요하면 **Refresh**를 누르고, 창이 작으면 하단 패널의 높이를 늘리세요.
3. 버전부터 맨 아래 수치까지 화면 전체를 촬영해 공유하세요.

버전·WSL 등 실행 환경, Worker JS 사용량/한도와 60% 분석 제한값, 단계별
시작/종료 수치, 처음 제한에 도달한 순간, 분석 입력 규모를 표시합니다.
Worker가 종료되어도 마지막 측정값과 시각을 남깁니다. **Last Worker sample**은
실시간 수치가 아니라 마지막으로 전달받은 측정이며, 바쁜 Worker의 Refresh는
응답을 기다립니다. 재색인 시 Worker 측정 기록이 초기화되며, 재인덱싱 이력은 최근 5회까지 유지합니다. 창 재시작 시 두 기록 모두 초기화됩니다.

단위는 **MiB**입니다. Worker JS와 외부 메모리, 다른 확장도 함께 사용하는
Extension host JS를 구분해 표시합니다. 단계별 차이는 캐시·메모리 회수의
영향을 포함하므로 특정 단계의 순수 할당량이나 PC 전체 RAM 사용량이 아닙니다.
로그는 제한된 최신 요약만 메모리에 보관하며 소스 본문을 포함하거나 자동
업로드하지 않습니다. 이 버전은 진단 추가이며 메모리 한도를 늘리지 않습니다.

v0.1.34부터 분석 Worker의 메모리 여유가 부족해지면 매크로·콜백 추가 분석을
중단하고 **Partial index: memory budget reached**로 표시합니다. 이미 분석된
소스 호출과 직접 함수 인자는 후보로 남습니다. 분석하지 못한 파일은 알림에
표시됩니다. 실제 `ERR_WORKER_OUT_OF_MEMORY` 종료는 **Analysis stopped**로
표시하며, Include/Exclude 범위를 줄이고 **Rebuild index**를 누르면 새 Worker로
재시작합니다. 이전 버전에서 이미 종료됐다면 **Developer: Reload Window**가
필요합니다. 모든 단일 대형 할당이나 시스템 메모리 부족을 막는 보장은 아닙니다.

v0.1.33부터 매크로가 없는 헤더의 반복 방문도 제한합니다. 중첩 include가
폭증하면 `Macro include traversal limit reached` 알림을 남기고 후속
파일 갱신을 계속 처리합니다. 해당 파일은 원본 호출을 미확정 후보로 유지하며,
불완전한 전처리 결과에서 매크로·콜백 대상을 추론하지 않습니다. 관련 헤더를
수정하면 다시 분석합니다.

Tree-sitter C 구문 트리에서 심볼·위치를 수집하고 파일/지역 스코프를 이용해 연결합니다. 단순 문자열 검색보다 선언·문자열·주석을 구분하지만 컴파일러의 의미 분석을 완전히 대체하지 않습니다.

- 파일별 `static`과 지역 변수/매개변수의 이름 가림을 구분합니다. 여러 외부 정의는 후보 선택 목록과 **Candidate** 표시를 제공합니다.
- 함수 포인터는 소스에서 확인한 가능한 대상을 추정합니다. 모르는 대상은 간접 호출로 남깁니다.
- 매크로 확장 호출은 원본 호출 위치와 확장 근거를 함께 표시합니다. 지원 범위와 한계는 위 설명을 참고하세요.
- 헤더의 `static`, 간접 include, 복잡한 변수 선언, 컴파일러 전용 문법은 불완전할 수 있습니다. 파서 오류는 하단 **Analysis notices**로 표시하지만 모든 의미 오류를 감지하지는 못합니다.
- `.c`, `.h` 파일을 대상으로 하며 `node_modules`, `.git`, `.vscode-test`와 `dynsight.exclude` 패턴에 맞는 파일을 제외합니다. `files.exclude`, `search.exclude`, `C_Cpp.files.exclude`는 이 확장의 분석 범위에 적용되지 않습니다.
- 초기 분석은 Include/Exclude 적용 후 최대 10,000개 파일, 파일당 2,000,000 UTF-16 코드 단위, 화면당 300개 노드로 제한합니다. 제한·분석 실패는 알림으로 표시합니다. 원본 파일은 증분 갱신하고, 영향을 받는 매크로·콜백 관계는 다시 계산합니다.
- Context는 선택 위치 앞 80줄, 뒤 120줄 범위를 읽기 전용으로 보여줍니다. 간단한 구문 색상은 제공하지만 전체 C 의미 강조는 아닙니다.

## Relation이 바뀌지 않거나 느릴 때

1. **실행 중인 버전**을 Context 제목에서 확인합니다. 대규모 프로젝트의 반복 인덱스 갱신 병목은 v0.1.16에서 개선했습니다. 업데이트 후 **Reload Window**를 실행해야 새 버전이 적용됩니다. WSL에서는 확장이 해당 WSL 환경에 설치되어 있는지도 확인하세요.
2. **Following selection** 상태인지 확인합니다. **Pinned · Follow paused**는 선택 추적을 멈추고 현재 Relation을 유지하는 상태입니다. 버튼을 누르면 추적을 재개합니다.
3. 하단의 **분석 상태와 파일 수**를 확인합니다. 초기 분석 중에는 아직 처리하지 않은 파일의 관계가 빠질 수 있습니다. **Partial index: 10,000 file limit reached**이면 일부 파일이 초기 색인에서 빠졌으므로 제외 설정으로 범위를 줄이세요.
4. **Analysis notices**를 펼칩니다. `File exceeds the 2,000,000 character analysis limit`는 해당 파일의 크기 제한 안내입니다. 도구가 생성한 대형 파일이면 그 폴더를 제외하세요. 문법 분석 알림은 파일과 줄을 확인해야 하며, **Index ready**도 모든 파일에 분석 오류가 없다는 뜻은 아닙니다.
   매크로·콜백 분석의 한도에 도달하면 **Partial index: analysis limits reached**로 표시합니다. 이미 알려진 관계는 사용할 수 있지만 일부 콜백 연결이 빠질 수 있습니다.
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

### Make 빌드 구성 적용

**Dynsight: Select Build Configuration**에서 기존 Makefile 또는 `.sh`·`.bat`·`.cmd` 진입점을 선택할 수 있습니다. 일반 Include/Exclude로 발견한 C/H의 폴더와 상위 경로에서 후보를 찾고, 선택한 진입점의 실제 Make include·하위 Make·스크립트 호출을 따라 파일별 옵션과 출처를 확인합니다. 모듈 안의 여러 `.mk`와 공유 설정을 지원하며 `compile_commands.json`은 필요하지 않습니다. 스크립트와 compiler를 실행하지 않습니다.

지원되는 GCC 및 Diab `dcc`의 명시적 `-D/-U/-I` 옵션은 조건·헤더 검색·매크로 확장에 적용됩니다. 같은 헤더의 TU별 정적 변수와 함수는 분리하며, 필요한 경우 해당 헤더를 포함한 소스 문맥을 선택합니다. 일반/Smart Include·Exclude는 유지하고 소스 편집 시 빌드 설정 캐시를 재사용합니다. 설정 파일을 수정한 뒤에는 자동 갱신하거나 **Dynsight: Refresh Build Configuration**으로 근거를 다시 확인할 수 있습니다.

동적 shell/Make 표현식, 미확인 compiler 옵션, 제외된 필수 헤더는 미확정으로 표시합니다. 추가 Diab 전용 옵션·compiler 기본 환경·최종 링크 소속은 검증하지 않으므로 전체 빌드 완전성을 보증하지 않습니다. 활성 코드 자체의 callback 한도와 전파 비용은 그대로 남습니다. `skipInactive=false`는 모든 분기 보기이며 빌드 조건으로 분기를 제거하지 않습니다.
