# Dynsight — 한국어 사용 설명서

**언어: 한국어 | [English User Guide](USER_GUIDE.md)**

> **처음 사용하시나요?** [1. 빠른 시작](#1-빠른-시작) → [2. 설정 따라 하기](#2-설정-따라-하기) 순서로 보세요.
>
> Relation 상단의 **Help · 사용법**으로 언제든 다시 열 수 있습니다. 설명서는 확장에 포함되어 인터넷 없이도 읽을 수 있습니다. 처음 열리는 언어는 VS Code의 표시 언어를 따르며, 위의 링크로 바꿀 수 있습니다.

화면에서 찾기 쉽도록 버튼과 설정 이름은 실제 표시되는 **영어 이름**을 함께 적었습니다. 확장 ID는 `dylee.dynsight`, 설정 이름은 `dynsight.*`입니다.

## 필요한 내용 바로 찾기

| 하고 싶은 일 | 읽을 곳 |
| --- | --- |
| 처음으로 함수 관계 보기 | [1. 빠른 시작](#1-빠른-시작) |
| Settings를 열고 폴더 선택하기 | [2. 설정 따라 하기](#2-설정-따라-하기) |
| 각 설정의 뜻과 기본값 확인하기 | [3. 설정 한눈에 보기](#3-설정-한눈에-보기) |
| 호출한 함수와 호출되는 함수 구분하기 | [4. Relation과 Context 읽기](#4-relation과-context-읽기) |
| 트리를 저장하고 다시 열기 | [5. 슬롯과 잠금과 되돌리기](#5-슬롯과-잠금과-되돌리기) |
| 아이콘과 R/W 표시 이해하기 | [6. 아이콘과 변수 표시](#6-아이콘과-변수-표시) |
| 콜백 대상을 직접 지정하거나 AI 사용하기 | [7. 콜백과 AI](#7-콜백과-ai) |
| Make 빌드 설정 선택하기 | [8. 빌드 설정](#8-빌드-설정) |
| 결과가 없거나 느릴 때 확인하기 | [9. 문제 해결](#9-문제-해결) |
| 설치하거나 업데이트하기 | [10. 설치와 업데이트](#10-설치와-업데이트) |

## 1. 빠른 시작

1. VS Code에서 **File → Open Folder…** 메뉴로 C 소스가 있는 폴더를 엽니다. 빌드나 컴파일러, SDK를 준비하지 않아도 기본 탐색을 사용할 수 있습니다.
2. 명령 팔레트를 엽니다. Windows/Linux는 **Ctrl+Shift+P**, macOS는 **Cmd+Shift+P**입니다.
3. **Dynsight: Open Relation and Context**를 실행합니다.
4. 하단의 **Indexing C sources…** 표시가 끝날 때까지 기다린 뒤, `.c` 또는 `.h` 편집기에서 함수나 변수 이름을 클릭합니다.
5. **Relation**에서 관계를 보고, **Context**에서 해당 코드를 확인합니다. 트리의 항목을 한 번 클릭하면 미리보기, 두 번 클릭하거나 **Enter**를 누르면 원본 편집기로 이동합니다.

**바로 해볼 예시:** `main` 함수를 클릭하고 모드를 **Callees · Called functions**, 깊이를 **1 level**로 선택하세요. `main`이 호출하는 함수부터 볼 수 있습니다. 필요한 가지를 클릭하며 펼쳐 보세요.

## 2. 설정 따라 하기

### 설정 화면 열기

1. Relation 상단에서 **Help · 사용법** 옆의 **Settings**를 누릅니다. 명령 팔레트의 **Dynsight: Open Settings**로도 열 수 있습니다.
2. 현재 프로젝트에만 적용하려면 **Workspace** 탭을 선택합니다. **User**는 여러 프로젝트에 적용하는 기본 설정입니다. 여러 폴더를 연 경우 폴더별 탭에서 각 폴더의 분석 범위를 지정할 수 있습니다.
3. 드롭다운이나 체크박스를 바꾸면 VS Code가 저장합니다. 폴더 선택 창은 마지막에 **Apply**를 눌러야 저장합니다. **Esc**로 닫으면 적용하지 않습니다.
4. 코드 편집기로 돌아와 함수 이름을 클릭합니다. 화면 설정은 바로 적용되고, 분석 범위 변경은 관련 분석이 갱신되므로 상태 표시가 끝난 뒤 결과를 확인하세요.

> **설정을 찾기 어려울 때:** Settings 검색창에 `@id:dynsight.include`처럼 정확한 키를 넣으세요. 전체 설정으로 돌아가려면 `@ext:dylee.dynsight`를 검색하세요. 맨 위 **Context Layout** 설명에도 한국어·영어 사용법 링크가 있습니다.
>
> **Automatic Updates**는 전체 프로그램에 적용하는 항목이므로 **User** 탭에서 바꿉니다. 폴더를 열지 않은 상태의 Settings 버튼도 User 설정을 엽니다.

### A. 필요한 폴더만 분석하기

예를 들어 `App`과 `Drivers` 폴더만 살펴보고 싶다면 다음과 같이 설정합니다.

1. **Include** (`dynsight.include`)에서 **Select folders…** 링크를 누릅니다.
2. **Add folders…** 항목에서 `App`과 `Drivers`를 선택합니다.
3. 검토 목록에 `App/**`, `Drivers/**`가 있는지 확인합니다. `/**`는 그 폴더 아래 전체라는 뜻입니다.
4. 기존에 `**`처럼 전체를 선택하는 규칙이 있다면 제거해야 범위가 좁아집니다.
5. **Apply**를 누릅니다.
6. **Exclude**도 확인하세요. **Include에 있어도 Exclude에 걸리면 분석하지 않습니다.** 필요한 공통 헤더와 라이브러리는 일반 분석 범위에 포함해야 합니다.

**더 쉬운 방법:** 탐색기에서 폴더를 선택 → 우클릭 → **Dynsight → Add to Analysis Include** 또는 **Exclude from Analysis** → 목록 확인 → **Apply**.

| 패턴 | 뜻 |
| --- | --- |
| `App/**` | 열린 폴더 바로 아래 App의 모든 하위 파일 |
| `Drivers/**` | Drivers의 모든 하위 파일 |
| `**/generated/**` | 어느 깊이에 있든 generated 폴더 아래 파일 |
| `**/build/**` | 모든 build 폴더 아래 파일 |

경로는 **열린 워크스페이스 폴더 기준**이며 Windows에서도 `/`를 씁니다. WSL에서는 실제 경로의 대소문자를 맞추세요. 폴더 패턴 안에 다른 파일이 있어도 기본 소스 분석은 C/H 파일을 대상으로 합니다.

> **Exclude 기본값 주의:** 기본적으로 test/mock, `third*`, build/coverage, Polyspace 및 일부 도구 출력 폴더를 제외합니다. 직접 저장한 Exclude 목록은 기본 목록을 **대체**합니다. 기존 기본값을 유지하며 추가하려면 폴더 선택기의 검토 목록에서 추가하세요. `[]`로 저장하면 변경 가능한 기본 제외를 해제합니다. `.git`, `node_modules`, `.vscode-test`는 항상 제외합니다.

### B. 매크로와 콜백을 더 자세히 분석하기

1. 먼저 기본 함수 관계가 보이는지 확인합니다.
2. **Smart Analysis: Include**의 **Select folders…** 링크에서 `App/control`처럼 필요한 작은 폴더를 선택하고 저장합니다.
3. **Smart Analysis: Macro**는 체크된 상태로 둡니다. 매크로 확장과 로컬 함수 포인터·콜백 추론을 함께 켭니다.
4. 로컬 분석만 필요하면 **Smart Analysis: AI**는 끈 상태로 둡니다.
5. 기본 탐색이 준비된 뒤 상세 분석 결과가 추가되는지 확인합니다.

**두 Include의 차이는 꼭 확인하세요.**

| 항목 | 무엇을 정하나요? | 빈 목록 `[]`의 뜻 |
| --- | --- | --- |
| 일반 **Include** | 기본적으로 읽을 C/H 파일 | Exclude와 파일 수 제한을 적용한 전체 범위 |
| **Smart Analysis: Include** | 그 안에서 추가 분석할 파일 | 새 프로젝트에서는 매크로·AI 추가 분석 안 함 |

전체 색인 파일에 추가 분석을 하려면 Smart Analysis Include에 `["**"]`를 사용합니다. 큰 프로젝트는 작은 폴더부터 시작하면 분석 부담을 줄일 수 있습니다. **Smart Analysis: Exclude**가 추가 분석 범위에서 우선합니다. 이 항목에 제외해도 일반 색인에 있는 파일의 기본 탐색은 유지됩니다.

기존 버전의 상세 분석·Copilot 경로는 새 Smart Analysis Include를 명시적으로 저장하기 전까지 유지됩니다. 새 Include를 저장하면 빈 목록도 새 범위로 적용됩니다. 외부 헤더의 색인된 정의는 참고하지만, 외부 함수 본문을 자동으로 모두 따라가지는 않습니다.

### C. 보기 편하게 화면 바꾸기

| 원하는 화면 | Settings에서 선택할 값 |
| --- | --- |
| Context와 Relation을 함께 보기 | **Context Layout → Combined** |
| 화면 아래 전체 폭 사용하기 | **Context Layout → Combined · Full width** |
| 왼쪽 사이드바 높이를 유지하기 | **Combined · Left sidebar full height** |
| 양쪽 사이드바 높이를 유지하기 | **Combined · Center** |
| 오른쪽 사이드바 높이를 유지하기 | **Combined · Right sidebar full height** |
| Context를 따로 옮기기 | **Context Layout → Separate** 선택 후 **Dynsight Context** 제목을 드래그 |
| 호출하는 쪽과 호출되는 쪽 좌우 바꾸기 | **Call Graph Direction** 변경; **Callers & Callees** 모드에 적용 |
| 호출되는 함수를 코드 순서로 정렬하기 | **Callee Sort → source** |
| 인자로 전달되는 함수도 표시하기 | **Include Function Arguments** 체크 |

화면 배치·정렬 변경은 색인을 다시 만들 필요가 없습니다. Combined의 명시적 폭·정렬은 VS Code의 하단 패널 설정을 사용하므로 Terminal 등 다른 하단 화면도 함께 움직입니다. 명시적 정렬에서 일반 Combined나 Separate로 돌아가면 Center 정렬로 돌아갑니다.

### D. JSON으로 설정하기

처음에는 위의 화면 설정만 사용해도 됩니다. JSON을 쓰려면 명령 팔레트에서 **Preferences: Open Workspace Settings (JSON)** 명령을 엽니다. 기존 설정을 지우지 말고 필요한 항목만 합치세요.

아래 예시는 **App과 Drivers를 기본 분석하고, App/control만 로컬 추가 분석**합니다. AI는 사용하지 않습니다.

```json
{
  "dynsight.include": ["App/**", "Drivers/**"],
  "dynsight.smartAnalysis.include": ["App/control/**"],
  "dynsight.smartAnalysis.exclude": ["App/control/generated/**"],
  "dynsight.smartAnalysis.macro": true,
  "dynsight.smartAnalysis.ai": false
}
```

예시 폴더 이름은 실제 프로젝트 이름으로 바꾸세요. 이 예시는 Exclude를 새로 지정하지 않으므로 다른 범위에서 덮어쓰지 않았다면 기존 기본 제외를 사용합니다.

## 3. 설정 한눈에 보기

| 화면 이름과 정확한 설정 키 | 기본값과 용도 |
| --- | --- |
| **Context Layout** · `dynsight.contextLayout` | **`combined`** — Context를 함께 둘지 분리할지, 하단을 얼마나 넓게 쓸지 정합니다. |
| **Call Graph Direction** · `dynsight.callGraphDirection` | **`callers-left`** — 양방향 모드의 Callers/Callees 좌우를 정합니다. |
| **Include** · `dynsight.include` | **`[]`** — 기본적으로 읽을 C/H 범위입니다. 비우면 제외 규칙과 제한 안에서 전체를 읽습니다. |
| **Exclude** · `dynsight.exclude` | **기본 제외 목록** — 기본 분석에서 빼는 폴더입니다. Include보다 우선합니다. 저장 목록은 기본 목록을 대체합니다. |
| **Smart Analysis: Include** · `dynsight.smartAnalysis.include` | **`[]`** — 매크로·콜백·AI 추가 분석을 할 파일입니다. |
| **Smart Analysis: Exclude** · `dynsight.smartAnalysis.exclude` | **`[]`** — 추가 분석만 건너뛸 경로입니다. 일반 범위에서 제외하지 않으면 기본 탐색은 됩니다. |
| **Smart Analysis: Macro** · `dynsight.smartAnalysis.macro` | **켜짐** — 지정 범위 안에서 로컬 매크로 확장과 콜백 전파를 수행합니다. |
| **Smart Analysis: AI** · `dynsight.smartAnalysis.ai` | **꺼짐** — 미해결 콜백의 AI 후보를 요청합니다. Macro와 별도로 켤 수 있습니다. |
| **Skip Inactive** · `dynsight.skipInactive` | **켜짐** — 확실히 비활성인 조건부 분기를 숨깁니다. 판단 불가능한 분기는 남깁니다. |
| **Callee Sort** · `dynsight.calleeSort` | **`name`** — Callees를 이름 또는 첫 호출 소스 위치(`source`)로 정렬합니다. 실행 순서가 아닙니다. |
| **Include Function Arguments** · `dynsight.includeFunctionArguments` | **꺼짐** — 인자로 전달되는 함수를 표시합니다. 전달이 실행을 뜻하지는 않습니다. |
| **Automatic Updates** · `dynsight.automaticUpdates` | **켜짐** — GitHub 릴리스를 확인하고 설치 전에 묻습니다. User 설정이며 인터넷이 필요합니다. |

## 4. Relation과 Context 읽기

| 모드 / 동작 | 뜻 |
| --- | --- |
| **References** | 선택한 심볼의 호출·주소 참조·선언 등을 봅니다. |
| **Callers** | 선택한 함수를 호출하는 쪽을 봅니다. |
| **Callees · Called functions** | 선택한 함수가 호출하는 쪽을 봅니다. |
| **Callers & Callees** | 선택한 함수를 중심으로 두 방향을 함께 봅니다. |
| **1 level – 8 levels** | 처음 펼칠 깊이와 개별 가지를 펼칠 깊이입니다. |
| 한 번 클릭 | Context 미리보기와 해당 가지 확장입니다. 같은 항목을 반복 클릭해도 무한히 깊어지지 않습니다. |
| 두 번 클릭 / **Enter** | 원본 편집기에서 해당 심볼이나 참조 위치를 엽니다. |
| 500ms 가만히 마우스 올리기 / **Space** | 상세 정보와 실제 호출·참조 위치를 봅니다. **Escape**로 닫습니다. |
| **→** / **←** | 포커스한 가지를 펼치거나 접습니다. **Shift+→** 키는 확장 깊이를 고릅니다. |
| Context 코드 클릭 | 원본 편집기의 해당 위치로 이동합니다. Following 상태면 선택 심볼도 따라갑니다. 드래그는 텍스트 선택·복사입니다. |

한 함수를 여러 번 호출해도 트리 항목은 합쳐질 수 있습니다. 상세 팝업에서 각 호출 위치를 확인하세요. 정의가 여러 개면 **Select definition**에서 파일을 고릅니다.

Context와 Relation 사이의 경계선을 드래그하면 폭을 조절합니다. 그래프 빈 배경을 드래그하면 화면을 이동합니다. 우클릭의 **Reset graph position**으로 처음 위치로 돌아갑니다. 새 루트를 선택하면 그래프 위치도 초기화됩니다.

## 5. 슬롯과 잠금과 되돌리기

### 특정 함수를 고정하기

- **Following selection**: 편집기에서 선택한 심볼을 Relation이 따라갑니다.
- Relation에서 원하는 항목을 선택하고 **Following selection**을 누르면 그 심볼을 루트로 고정합니다. 선택한 항목이 없으면 현재 루트를 고정합니다.
- **Pinned · Follow paused**: 고정 상태입니다. 다시 누르면 편집기를 따라갑니다. 색인과 수동 확장은 계속 사용할 수 있습니다.
- 다른 항목을 우클릭 → **Pin this symbol**로 고정 대상을 바꿀 수도 있습니다.
- **↩ Pin**: 고정한 심볼의 소스·Context·루트로 돌아갑니다. 펼친 가지와 설정을 유지합니다.

### 1–5 슬롯에 트리 저장하기

1. Relation에서 저장할 함수나 변수에 마우스를 올리고 **우클릭**합니다.
2. **Save to slot 1–5** 중 원하는 번호를 선택합니다.
3. **Following selection** 옆 숫자 슬롯에 마우스를 올려 저장된 심볼 이름을 확인합니다.
4. 숫자를 클릭하면 저장했던 **전체 Relation 트리**를 복원하고, 저장 시 우클릭한 심볼을 선택하여 Context와 원본 소스를 엽니다.

**예시:** A가 루트인 트리에서 B를 우클릭해 저장하면, 나중에 슬롯을 눌렀을 때 A와 다른 가지까지 복원하고 B를 선택합니다. 양쪽 호출 가지, 펼침·접힘, 보기 옵션도 저장합니다. 불러올 때 현재 Following/Pinned 상태는 유지합니다.

슬롯 번호의 작은 **자물쇠**는 덮어쓰기·삭제 방지용입니다. 잠겨 있어도 불러올 수 있습니다. 바꾸거나 지우려면 잠금을 푼 뒤 저장하거나 슬롯 우클릭 → **Clear slot**을 선택하세요. 슬롯과 잠금은 작업공간에 저장됩니다.

트리는 현재 코드로 다시 구성합니다. 삭제된 심볼이나 변경된 가지는 모두 복원하지 못할 수 있으며 안내가 표시됩니다. 예전 형식으로 저장한 슬롯은 당시 기록되지 않은 상위·다른 가지를 복구할 수 없으므로 필요하면 다시 저장하세요.

### Backspace로 펼침과 접힘 되돌리기

Relation에 포커스가 있을 때 **Backspace**를 누르면 최근 가지 확장 또는 접기를 한 단계 되돌립니다. 예를 들어 B 확장 → C 확장 후 Backspace는 C 확장 전, 다시 누르면 B 확장 전으로 돌아갑니다. 접은 가지도 되돌릴 수 있습니다.

현재 선택과 Context, 루트, 고정 상태, 그래프 위치는 유지합니다. 세션 중 최근 100개 트리 동작을 기억합니다. 루트·보기 옵션·색인 소스 변경이나 슬롯 불러오기는 새 이력을 시작합니다. 소스 편집기·Context에서는 트리 되돌리기로 동작하지 않고, 입력란에서는 원래의 문자 지우기 동작을 유지합니다.

## 6. 아이콘과 변수 표시

![함수 선언과 구현, 변수, 타입, 매크로, 미확인 심볼과 상태 표시](media/symbol-icons.png)

| 표시 | 뜻 |
| --- | --- |
| 테두리형 `ƒ` | 함수 선언 또는 구현 여부를 특정하지 못한 함수 참조입니다. 팝업 설명을 확인하세요. |
| 채움형 `ƒ` | 함수 구현입니다. |
| `v` / `T` / `#` / `?` | 변수 / 타입 / 매크로 / 미확인 심볼입니다. |
| **R** / **W** / **RW** / **&** | 읽기 / 쓰기 / 읽고 쓰기 / 주소 사용입니다. |
| 점선 아이콘 테두리 | 조건부·후보·재귀 등 상태입니다. 팝업의 이유를 확인하세요. |
| 청록 점선 연결 | 함수가 인자로 전달되는 관계입니다. 실제 호출의 증거는 아닙니다. |

변수를 선택하면 Read/Write 필터로 사용 위치를 골라 볼 수 있습니다. 함수 모드는 기억했다가 함수로 돌아오면 복원합니다. 구조체·공용체 멤버는 같은 이름이라도 소속 타입과 실제 접근 위치를 확인하세요. 분석이 타입을 확정하지 못하면 후보 선택이 필요할 수 있습니다.

## 7. 콜백과 AI

### 먼저 로컬 결과 확인하기

**Smart Analysis: Macro**는 지정 범위에서 매크로와 함수 포인터·구조체 콜백을 분석합니다. 간접 호출 위치를 클릭하거나 팝업을 열어 근거와 미해결 이유를 확인하세요.

- **Macro-expanded call**: 매크로를 펼친 결과에서 찾은 호출입니다.
- **Inferred call**: 함수 포인터·콜백에 대한 후보 대상입니다.
- **Registration**: 함수가 등록·대입된 사실입니다. 실제로 실행됐다는 뜻은 아닙니다.
- **Indirect call / Unresolved call**: 간접 대상을 찾지 못했거나 분석 범위에서 확인하지 못한 호출입니다.

**Skip Inactive**는 확실히 비활성인 분기만 건너뜁니다. 불확실한 조건은 남깁니다. 제한·미지원 표현식·메모리 부족으로 결과가 부분적일 수 있으므로 “트리에 없음”을 “실행되지 않음”으로 해석하지 마세요.

### AI 후보 켜기

**Settings → Smart Analysis: AI** 하나에서 설정합니다. 체크하면 **1/2: 설치된 Copilot / Claude Code / Codex 선택 → 2/2: 해당 모델 선택**이 이어집니다. 모델은 이름을 보고 목록에서 고르며, Claude Code·Codex에는 **Default model**도 있습니다. 두 단계를 마친 선택만 함께 저장합니다. 중간에 취소하면 새로 켠 체크가 꺼집니다. 같은 항목의 **Choose or change AI extension and model…** 링크나 **Dynsight: Configure Smart Analysis AI**로 다시 선택할 수 있습니다. **선택한 하나만 요청을 처리하며 다른 제공자로 자동 전환하지 않습니다.** 별도 CLI·경로·모델 ID 입력은 필요하지 않습니다. 선택한 확장에 로그인해 두세요.

Copilot은 VS Code 모델 API를 사용하고, Claude Code·Codex는 설치된 확장에 포함된 실행 엔진을 자동으로 찾아 기존 로그인을 사용합니다. 기존 채팅창에 메시지를 입력하는 방식은 아닙니다. 제공자를 바꾸면 이전 요청이 끝난 뒤 새 요청을 시작합니다. WSL·SSH에서는 해당 환경에서 사용할 수 있는 확장이 필요합니다. 실패하면 선택한 확장의 로그인·업데이트 상태를 확인한 뒤 **Analyze Callbacks with AI**로 재개하세요. 기존 Copilot 사용 여부는 새 AI 설정을 명시적으로 저장하기 전까지 적용됩니다.

1. **Smart Analysis: Include**에 분석할 폴더를 저장합니다.
2. **Smart Analysis: AI**를 체크한 뒤 첫 번째 목록에서 사용할 확장을 고릅니다.
3. 바로 이어지는 두 번째 목록에서 모델 이름 또는 **Default model**을 고릅니다. ID를 입력하지 않습니다. 선택은 두 단계를 마친 뒤 저장합니다.
4. 색인이 준비되면 미해결 콜백을 하나씩 분석합니다. 유효한 기존 결과는 재사용합니다. 저장·재색인·모델/범위 변경도 필요한 결과의 분석을 시작합니다.

> **전송 범위:** 관련 소스 일부를 선택한 AI 제공자·모델로 보내며 계정 사용량 한도가 적용됩니다. 호출 위치는 Smart Analysis 범위 안이어야 하지만 근거 코드는 다른 색인 파일에서도 수집할 수 있습니다. 로컬 분석만 쓰려면 AI를 끄세요.

**Stop analysis / Dynsight: Stop AI Analysis**는 완료 결과를 남기고 이 세션의 자동 요청을 멈춥니다. **Dynsight: Analyze Callbacks with AI**, 설정 다시 켜기, 모델/범위 변경으로 재개합니다. 요청 실패도 자동 반복하지 않고 일시 중단합니다.

### 후보를 직접 지정하기

1. **AI candidate** 팝업에서 **Set manually**를 누릅니다.
2. 함수 이름과 파일 경로를 확인해 실제 함수를 선택합니다.
3. **Apply**를 누르면 이동 대상과 그래프가 그 함수를 사용하고 **User confirmed**로 표시합니다. C 코드를 수정하지 않습니다.
4. **Recheck with AI**로 한 호출만 다시 확인할 수 있습니다. 다른 후보가 나와도 **Use this target**을 눌러야 교체됩니다.
5. **Remove manual override**는 해당 사용자 지정만 제거합니다.

사용자 선택은 작업공간에 별도로 저장하며 재시작·재색인·모델 변경으로 자동 덮어쓰지 않습니다. 코드가 바뀌어 동일성을 확인할 수 없으면 재검토가 필요합니다. **AI candidate**와 **User confirmed** 모두 실제 실행을 입증한 정적 호출과 구분합니다.

## 8. 빌드 설정

기본 탐색은 빌드 설정 없이 사용할 수 있습니다. 기존 Make/스크립트의 Define·Include를 반영하려면 Relation의 **Build** 또는 **Dynsight: Select Build Configuration**을 실행합니다.

1. 목록에서 기존 Makefile·셸·배치 빌드 항목을 고릅니다. 없으면 **Choose build entry file…** 항목으로 지정합니다.
2. 스크립트 인자가 필요한 경우 입력합니다.
3. 읽기 전용 미리보기에서 파일별 컴파일 명령, 작업 폴더와 미해결 이유를 확인합니다.
4. 다시 찾으려면 **Dynsight: Refresh Build Configuration**, 기본 분석으로 돌아가려면 **Use basic source analysis**를 선택합니다.

스크립트나 Make, 컴파일러를 실제 실행하지 않고 정적으로 읽습니다. 임의 셸 로직·생성기·컴파일러 기본 설정·최종 링크 포함 여부는 완전히 확인하지 못할 수 있습니다. `build membership unknown`은 해당 파일의 빌드 조건을 신뢰성 있게 정하지 못했다는 뜻입니다. 미리보기의 파일·줄·미해결 식을 확인하세요.

빌드 선택은 일반 Include/Exclude나 Smart Analysis 범위를 넓히지 않습니다. 필요한 헤더가 밖에 있으면 범위를 직접 조정하세요. 헤더 정의가 여러 소스 문맥에 속하면 해당 소스를 선택합니다. 빌드 설정 변경은 AI 문맥과 저장한 수동 대상의 재검토를 요구할 수 있습니다.

## 9. 문제 해결

| 증상 | 먼저 해볼 일 |
| --- | --- |
| 아무것도 안 나옴 | C/H 폴더 열기 → **Open Relation and Context** → 색인 완료 대기 → 함수 이름 클릭 |
| 편집기에서 다른 함수를 눌러도 트리가 그대로임 | **Pinned · Follow paused**를 눌러 **Following selection**으로 전환 |
| 함수나 헤더가 빠짐 | 일반 Include/Exclude 확인. 기본 test·`third*` 제외도 확인 |
| 매크로·콜백이 안 나옴 | Smart Analysis Include가 비어 있지 않은지, Macro가 켜져 있는지 확인 |
| AI가 시작되지 않음 | 체크박스·모델·범위 확인. 중단했다면 **Analyze Callbacks with AI** 실행 |
| 분석이 느림 | Smart Analysis를 작은 폴더로 줄이고 트리 깊이를 낮춤. 필요하면 **Stop local**로 중단 |
| Local 분석이 중단됨 | 명령 팔레트의 **Dynsight: Resume Local Analysis**로 재개. 제한 이유도 확인 |
| 업데이트 후 Rebuild 안내 | 메시지의 이유 확인 후 필요하면 **Rebuild index**. 확장 버전 번호만으로 항상 재색인하는 것은 아님 |
| 이전 확장과 충돌함 | 아래 설치 안내의 이전 버전 제거 절차 확인 |

### Diagnostics 확인하기

**Diagnostics**에서 색인 파일 수, 분석 상태, 캐시, 재색인 이유, 메모리·부분 결과를 확인합니다. 기본 탐색 준비와 상세 분석 완료는 다른 상태입니다. 제한이 있으면 확보한 관계만 표시할 수 있습니다.

**Stop local**은 로컬 분석을 멈춥니다. 말줄임된 함수 이름에 마우스를 올리거나 키보드 포커스를 두면 전체 이름을 보고 **Copy**로 복사할 수 있습니다. 팝업의 이름은 열었을 때의 값이며, 현재 이름을 다시 보려면 닫았다가 여세요.

색인은 작업공간의 확장 저장소에 저장됩니다. 호환되는 캐시와 변경 없는 소스는 다시 활용하며, 소스·범위 변경은 영향을 받는 분석을 갱신합니다. 공유 헤더 변경은 많은 파일에 영향을 줄 수 있습니다. **Rebuild index**는 전체 로컬 분석을 다시 만드는 기능이므로 화면 배치만 바꿨을 때 누를 필요는 없습니다.

문제 보고는 **Dynsight: Report Issue**를 실행하세요. 초안과 첨부할 내용을 검토한 뒤 직접 제출합니다. 상세 진단 항목은 [영어 상세 설명](USER_GUIDE.md#if-results-are-missing-or-slow)에서도 확인할 수 있습니다.

## 10. 설치와 업데이트

1. [GitHub Releases](https://github.com/mrdylee/vscode_extension_relation_window/releases)에서 VSIX를 받습니다.
2. 명령 팔레트에서 **Extensions: Install from VSIX…** 명령을 실행합니다.
3. 필요하면 **Developer: Reload Window**를 실행하고 Context 옆의 버전을 확인합니다.

Windows/macOS/WSL 이름의 파일은 같은 공통 JavaScript/WASM 패키지입니다. VS Code 데스크톱 1.95 이상을 사용하세요. 웹 전용 VS Code는 지원하지 않습니다. WSL은 연결된 창의 WSL 확장 목록에 설치하고 같은 창에서 설정합니다. WSL 원격 연결·자동 설치는 실환경 검증 범위에 포함되지 않았습니다.

**Dynsight: Check for Updates**로 바로 확인할 수 있습니다. 자동 확인은 기본으로 켜져 있고 마지막 성공 후 약 하루 간격으로 확인합니다. **Update**를 선택해야 설치하고, **Later**나 닫기는 설치하지 않습니다. 설치 뒤 **Reload Window**를 선택해야 새 버전으로 다시 로드합니다. 자동 확인은 **User → Automatic Updates**에서 끌 수 있습니다. 업데이트 확인·다운로드는 인터넷이 필요합니다.

v0.1.43 이하의 이전 확장 **C Relation Explorer**가 있으면 **Remove previous extension and reload** 안내를 따르세요. 안내를 닫았다면 Extensions에서 이전 확장을 제거한 뒤 Reload Window를 실행합니다. 기존 `cRelation.*` 설정은 새 설정이 없을 때 `dynsight.*`로 이전합니다. 기존 사용자 단축키 명령은 호환됩니다.

---

**다시 찾기:** Relation의 **Help · 사용법** 또는 명령 팔레트의 **Dynsight: 사용 설명서 열기 (한국어)** / **Dynsight: Open User Guide (English)**.
