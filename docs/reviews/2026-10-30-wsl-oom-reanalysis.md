# WSL Extension Host OOM 재분석

검토 기준: `diagnosis.md`가 추가된 커밋 `9d11125`, Dynsight 0.1.86 소스. 실제 장애 환경에 접속하거나 동일 프로젝트에서 OOM을 재현하지는 못했다.

## 결론

**확정된 직접 원인은 WSL Extension Host의 JavaScript 힙 한도 도달이다. 어떤 확장이 어떤 객체를 누적했는지는 아직 확정할 수 없다.** 앞서 `WriteString` 스택을 근거로 웹뷰 전송 적체를 최우선 원인으로 제시한 판단은 철회한다.

슬롯 클릭도 이 호스트의 메시지 처리를 필요로 하므로, 호스트의 GC 정체·종료로 슬롯이 반응하지 않는 현상은 설명할 수 있다. 다만 슬롯 1 자체의 별도 결함을 이 로그만으로 입증하거나 배제할 수는 없다.

## 로그가 입증하는 범위

원문: [diagnosis.md, 9d11125](https://github.com/mrdylee/vscode_extension_relation_window/blob/9d11125/diagnosis.md).

| 항목 | 관측값 | 해석 |
| --- | --- | --- |
| 실행 위치 | `/home/dylee/.vscode-server/.../node` | Windows 클라이언트에 연결된 WSL 원격 호스트 |
| VS Code | 1.144.0, `2c33b50b16c472efe58357d1d2a8a5414bc23fbf` | 사용자가 말한 1.86은 Dynsight 0.1.86과 구분해야 함 |
| Dynsight | 11:27에 0.1.86 설치 기록 | C/C++ 버전·전체 활성 확장 목록은 없음 |
| 첫 OOM | PID 8258, 13:35:22 | Mark-Compact 후 4093.4 → 4088.4 MB, 이후 SIGABRT |
| 재시작 후 OOM | PID 15086, 13:53:39 | Mark-Compact 후 4089.5 → 4073.7 MB, 이후 SIGABRT |
| 재시작부터 두 번째 OOM까지 | 약 16분 42초 | 한 번의 일시적인 실패로 끝나지 않음 |
| 공통 스택 | `String::ValueView → StringBytes::Size → StreamBase::WriteString` | 문자열을 스트림에 쓰는 중 추가 할당에 실패 |

GC 후에도 힙이 거의 줄지 않았다. 실패 시점에 많은 데이터가 살아 있었다는 단서지만, 영구 누수인지 큰 작업의 진행 중 데이터인지, 대기 중인 요청인지 구분할 수 없다. 로그에는 JavaScript 호출 스택, 객체 보유 경로, 심볼 검색 시각이 없다. PID만으로 어느 스레드/isolate의 힙이 소진됐는지까지 확정하지는 않았다.

사용자가 관측한 **9GB의 프로세스 이름과 측정 항목은 아직 불명확하다.** 한 프로세스의 RSS, 여러 프로세스 합계, Windows의 VmmemWSL 수치는 서로 다르다. RSS는 JavaScript 힙 외의 메모리도 포함한다. Dynsight Worker는 별도 스레드이므로 호스트와 PID/RSS를 공유하고, JavaScript 힙은 별도다. [Node.js 메모리 지표 설명](https://nodejs.org/api/process.html#processmemoryusage)

## 호출 경로 재검토

1. Dynsight에는 `workspace/symbol` 또는 `textDocument/documentSymbol` 제공자 등록이 없다. 검색 자체를 직접 처리하는 구조가 아니다.
2. 검색 결과 미리보기·이동이 편집기나 선택 위치를 변경하면 `src/extension.ts:50`의 이벤트가 `RelationView.track()`을 호출할 수 있다. 선택 변경은 80ms 지연, 활성 편집기 변경은 즉시 처리한다. 검색창에 입력만 하는 경우와 실제 결과를 미리 보는 경우를 분리해야 한다.
3. `src/view.ts:133`의 `track()`은 잠금 상태에서 반환하고, 같은 루트의 그래프가 있으면 중복 갱신을 건너뛴다. 다른 심볼로 이동하면 그래프/문맥 생성 후 상태를 전송한다.
4. `src/view.ts:243`은 문맥으로 약 200줄을 보내지만 구문 강조는 파일 전체를 계산하고 한 파일만 캐시한다. 큰 파일 사이를 오가면 반복 할당이 생길 수 있다. 이것만으로 계속 쌓이는 누수를 증명하지는 못한다.
5. `src/view.ts:255`는 전체 상태를 웹뷰에 보내며 완료를 기다리지 않는다. 메시지 크기와 미처리 요청 수를 아직 측정하지 않았으므로, 적체는 검증 전 가설이다.
6. 동일 VS Code 버전/커밋의 로컬 번들에서 웹뷰 메시지는 JSON 직렬화 후 RPC로 전달되고, 표준 소켓 전송은 `socket.write(buffer)`를 사용함을 확인했다. **JSON을 쓴다는 이유로 네이티브 `WriteString`을 이 경로와 바로 연결할 수 없다.** 로컬과 장애 환경의 플랫폼 및 실제 전송 경로 차이는 남아 있다.
7. 로컬 C/C++ 1.34.4 번들의 JSON-RPC도 본문을 `Buffer.from(JSON.stringify(...))`로 만들고 헤더만 ASCII 문자열로 쓴다. 이것은 WSL C/C++ 버전이나 해당 검색의 실제 호출 스택을 확인한 결과가 아니며, C/C++을 원인에서 제외하는 근거도 아니다.

Node의 문자열 쓰기 구현은 전송 전 문자열 크기 산정 중에도 메모리 작업을 한다. 따라서 이 스택은 **마지막 실패 지점**이며, 이미 힙을 채운 객체의 소유자를 알려주지 않는다. 참고한 [Node 소스](https://github.com/nodejs/node/blob/v22.x/src/stream_base.cc)는 경로의 일반적인 의미를 확인하기 위한 것으로, 장애 런타임의 정확한 Node 버전은 로그에 없다.

## 남은 후보와 구분할 증거

| 후보 | 코드상 근거 | 필요한 증거 |
| --- | --- | --- |
| 호스트에 남는 분석 데이터·캐시 | source/build 인덱스, 파일별 include 가시성 캐시(`src/relations.ts:148`) | 호스트 힙 추이, 객체 보유 경로. 파일 수·헤더 변형 수와 함께 비교 |
| 검색 결과 이동에 따른 Dynsight 갱신 | 전체 파일 구문 강조, 그래프 생성·상태 전송 | 잠금 전후 같은 탐색의 힙 증가량, 전송 크기/대기 수 또는 할당 프로파일 |
| 공유 호스트의 다른 확장 데이터 | 호스트 힙은 Dynsight 전용 지표가 아님 | Dynsight 비활성화 후 같은 검색 비교, JS 할당/힙 프로파일 |
| C/C++ 네이티브 서버의 별도 증가 | 별도 cpptools 프로세스 존재 가능 | PID별 RSS. 이것만 커지는 경우 호스트 V8 OOM과 별도로 분석 |

우선순위는 원인 확률 순위가 아니라 **가장 적은 조건 변경으로 구분할 수 있는 순서**로 정한다.

기존 Worker 메모리 제한(`src/analysis-worker.ts:81`)은 Worker 자신의 힙에만 적용된다. 호스트 전체 메모리나 다른 확장의 할당을 보호하지 않는다. 반대로 검색할 때마다 분석 전체가 재실행된다고 단정해서도 안 된다. `src/workspace.ts:411`은 소스와 분석 옵션이 같으면 재분석을 건너뛴다.

## WSL에서 수집하기

WSL의 저장소 루트에서 실행한다. 출력 디렉터리는 새 경로여야 한다.

```bash
bash scripts/monitor-wsl-memory.sh /tmp/dynsight-search-a 1800 2
```

기본값은 30분 동안 약 2초 간격이다. Ctrl+C로 종료해도 기록을 보존한다. 사용자 정의 서버 위치 또는 Insiders라면 `VSCODE_AGENT_FOLDER`를 해당 서버 디렉터리로 지정한다.

```bash
VSCODE_AGENT_FOLDER="$HOME/.vscode-server-insiders" \
  bash scripts/monitor-wsl-memory.sh /tmp/dynsight-insiders 1800 2
```

- `processes.tsv`: PID/프로세스 시작 시점, Extension Host·cpptools·cpptools-srv 구분, RSS·최대 RSS·Swap·스레드 수. 메모리 단위는 KiB이며 1024로 나누면 MiB다. PID 재시작도 다시 탐색한다.
- `system.tsv`: WSL Linux의 전체/가용 메모리와 Swap. Windows VmmemWSL 수치는 수집하지 않는다.
- `info.txt`: 시작·종료 시각, 설치된 Dynsight/C/C++ 디렉터리 목록. 설치 목록은 활성 버전 목록과 다르다.
- `logs/`: 최근 2분 내 기록된 Dynsight 진단 JSONL과 `remoteagent.log`/`exthost.log`의 마지막 256KiB를 시작·약 30초마다·종료 시 보존한다. 긴 로그의 앞부분은 포함되지 않는다. 표준 서버 디렉터리의 로그만 자동 검색한다.

기존 진단 JSONL(`src/issue-report-service.ts:15`)에는 `pid`, `host.heapMiB`, `host.limitMiB`, `host.processRssMiB`, `worker.heapMiB`, `worker.sampledAt`, 분석 단계, `sourceParses`, `relationPasses`, 선택 동작이 기록된다. **호스트 힙은 공유 호스트 전체이고 Worker 샘플은 분석 중 보고된 마지막 값**이다. 둘을 더한 값과 RSS가 같을 것으로 기대하면 안 된다. 호스트가 멈추면 JSONL 기록도 멈출 수 있으므로 외부 `/proc` 수집을 함께 사용한다.

다른 WSL 터미널에서 동작 시각을 남길 수 있다.

```bash
printf '%s\tCtrl+T preview start\n' "$(date -u +%FT%TZ)" >> /tmp/dynsight-search-a/events.tsv
```

스크립트는 소스 내용·환경 변수·전체 명령줄을 덤프하지 않는다. 복사된 기존 VS Code 로그에는 작업 경로나 확장 메시지가 포함될 수 있다.

## 최소 비교 실험

각 조건마다 창을 다시 로드하고 초기 분석이 끝난 뒤 같은 대기 시간을 둔다. 동일한 프로젝트·Build 구성·검색어·이동 순서를 사용하고 소스는 수정하지 않는다. `Ctrl+T`와 `Ctrl+Shift+O`는 별도 세션으로 기록한다.

1. **A: 두 확장 활성, Dynsight 잠금 해제.** 검색창 입력만 할 때와 결과 미리보기/이동을 할 때를 나눠 기록한다.
2. **B: 두 확장 활성, Dynsight 트리 잠금.** 동일 탐색을 반복한다. 기존 잠금 동작이 `track()` 갱신을 건너뛰므로 제공자와 분석 설정을 유지하면서 탐색 갱신의 영향을 줄여 비교할 수 있다.
3. **C: 워크스페이스에서 Dynsight 비활성화 후 다시 로드.** C/C++ 검색을 똑같이 반복한다. 이때 Dynsight JSONL이 없는 것은 정상이다.

B에서만 증가가 줄면 Dynsight 탐색 경로의 할당·보유 객체를 조사한다. C에서만 줄면 인덱스·Worker→호스트 전달 등 다른 Dynsight 경로까지 조사한다. C에서도 재현되면 C/C++ 또는 다른 공유 확장/호스트 경로를 조사한다. 어느 결과도 단일 실행만으로 확장 하나의 누수를 확정하지 않으며, 재현 조건을 좁히는 용도다. C/C++을 끄면 검색 제공자 자체가 달라질 수 있어 같은 검색의 대조군으로 바로 취급하지 않는다.

다음 수정은 이 비교 또는 할당/힙 프로파일에서 확인된 경로에 한정하고, 수정 전에 실패하는 재현 테스트를 만든다. 근거 없이 힙 한도를 올리거나 웹뷰 ACK 구조를 먼저 추가하지 않는다.

## 검증 범위

제품 코드 변경 없음. 모니터의 Bash 구문 검사 및 네트워크 없는 Debian Linux 컨테이너의 통합 테스트가 통과했다. 통합 테스트는 가짜 프로세스로 역할 구분·PID 재시작·메모리 필드·진단/로그 복사·종료 보존·기록 시간·인자 검증·기존 출력 보호·명령줄 미수집을 확인했다.

`node --expose-gc --import tsx --test test/analysis-memory.test.ts test/relation-slots.test.ts test/relation-navigation.test.ts`도 38개 모두 통과했다. 이 결과는 실제 C/C++ 검색이나 9GB OOM을 재현한 것이 아니다. 실제 WSL 장애 해결 여부는 위 비교 수집 후 판단해야 한다.
