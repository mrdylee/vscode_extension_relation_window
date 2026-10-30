# Dynsight 메모리 모니터 실행 안내

심볼 검색 중 메모리 증가나 프리징이 발생할 때, VS Code와 C/C++ 프로세스의 메모리 및 Dynsight 진단 기록을 함께 수집합니다. Dynsight 0.1.86의 기존 진단 기능을 사용하므로 확장을 새로 설치할 필요가 없습니다.

## WSL에서 실행

Windows에서 WSL로 연결한 VS Code라면 **해당 WSL 배포판의 터미널**에서 실행합니다.

```bash
curl -fL https://raw.githubusercontent.com/mrdylee/vscode_extension_relation_window/main/scripts/monitor-wsl-memory.sh -o /tmp/monitor-wsl-memory.sh
printf '%s  %s\n' f96de698636df806fee814783cf5f8e41fd19980501f7ec9bc1ddb7aa25bd034 /tmp/monitor-wsl-memory.sh | sha256sum -c -
bash /tmp/monitor-wsl-memory.sh "$HOME/dynsight-memory-$(date +%Y%m%d-%H%M%S)" 1800 2
```

사용자 정의 VS Code Server 위치 또는 Insiders에서는 마지막 명령 앞에 `VSCODE_AGENT_FOLDER="$HOME/.vscode-server-insiders"`처럼 실제 서버 경로를 지정합니다. Windows 네이티브 프로세스를 수집하는 스크립트는 아닙니다.

## Mac에서 실행

로컬 macOS VS Code에서 재현할 때 Mac 터미널에서 실행합니다.

```bash
curl -fL https://raw.githubusercontent.com/mrdylee/vscode_extension_relation_window/main/scripts/monitor-macos-memory.sh -o /tmp/monitor-macos-memory.sh
printf '%s  %s\n' 5b951b96305156bcdb3f375314fe37820a2781a53265d641d22679a9da8d8538 /tmp/monitor-macos-memory.sh | shasum -a 256 -c -
bash /tmp/monitor-macos-memory.sh "$HOME/dynsight-memory-$(date +%Y%m%d-%H%M%S)" 1800 2
```

Code Insiders 또는 사용자 정의 데이터 디렉터리는 마지막 명령 앞에 `VSCODE_USER_DATA_DIR="$HOME/Library/Application Support/Code - Insiders"`처럼 실제 경로를 지정합니다. Mac에서 WSL/SSH 원격 프로젝트를 열었다면 원격 호스트는 원격 환경에서 별도로 수집해야 합니다.

## 검색 동작 재현

기본 수집 시간은 **30분**, 간격은 **약 2초**입니다. 실행 중인 VS Code를 그대로 사용하고 초기 분석이 끝난 뒤 심볼 검색과 결과 미리보기·파일 이동을 반복합니다. 전체 워크스페이스 심볼 검색과 현재 파일 심볼 검색은 별도 실행으로 비교합니다.

Following Selection을 켠 실행과 트리를 고정한 실행을 비교하면 자동 갱신의 영향을 좁힐 수 있습니다. 이때 말하는 트리 고정은 슬롯 옆의 저장 보호 자물쇠와 다릅니다. 자세한 비교 순서는 [OOM 재분석](reviews/2026-10-30-wsl-oom-reanalysis.md)을 참고하세요.

출력 디렉터리는 새 경로여야 합니다. 종료하려면 실행 중인 터미널에서 **Ctrl+C**를 누릅니다. VS Code를 다시 로드해 PID가 바뀌어도 새 프로세스를 다시 탐색하며, 수집 시간 종료 또는 Ctrl+C 시 로그를 마지막으로 보존합니다.

시작·재현·프리징 시각을 남기려면 다른 터미널에서 실제 출력 경로를 지정합니다.

```bash
printf '%s\tsymbol search start\n' "$(date -u +%FT%TZ)" >> "$HOME/dynsight-memory-실행시각/events.tsv"
```

## 결과 확인

| 파일 | 내용 |
| --- | --- |
| `processes.tsv` | 프로세스별 RSS와 PID. 메모리 단위 KiB, 1024로 나누면 MiB |
| `system.tsv` 또는 `system.txt` | WSL 또는 Mac의 시스템 메모리·Swap 정보 |
| `info.txt` | 시작·종료 시각, 실행 조건, 설치된 관련 확장 디렉터리 |
| `events.tsv` | 사용자가 기록한 재현 동작 시각 |
| `logs/` | 최근에 기록된 Dynsight 진단 JSONL과 VS Code 로그의 마지막 256KiB |

로그는 시작·약 30초마다·종료 시 복사합니다. 수집 대상은 최근 2분 내 기록된 파일입니다. 기본 경로에서 진단 기록이 발견되지 않으면 `Dynsight: Report Issue`도 실행하고 실제 Code 데이터 위치를 확인하세요.

JSONL의 `pid`와 `processes.tsv`의 PID를 맞추면 Dynsight가 실행된 공유 Extension Host를 식별할 수 있습니다. Mac의 `code-plugin`에는 하위 도우미도 포함되므로 역할 이름만으로 모든 프로세스를 Extension Host로 취급하지 않습니다.

`host.heapMiB`는 공유 호스트의 JavaScript 힙, `host.limitMiB`는 그 한도, `host.processRssMiB`는 프로세스의 RSS입니다. Worker는 호스트와 PID/RSS를 공유합니다. `worker.heapMiB`는 `worker.sampledAt` 시점의 값이며, 유휴 상태에서 오래된 값일 수 있습니다. Mac의 VSZ는 가상 주소 공간이므로 실제 RAM 사용량으로 해석하지 않습니다.

스크립트는 설정·힙 한도를 변경하거나 디버거를 연결하지 않고, 전체 명령줄·환경 변수·소스 파일을 덤프하지 않습니다. 기존 VS Code 로그에는 작업 경로나 확장 메시지가 포함될 수 있으므로 공유 전에 확인하세요. 결과는 자동 업로드되지 않습니다.

## 수집기 검증

WSL 수집기는 Linux 통합 테스트에서 역할 구분·프로세스 재시작·메모리 기록·로그 보존·종료를 검증했습니다. Mac 수집기는 프로세스 목록 파싱 회귀 테스트와 실제 Mac 실행에서 메모리 행 및 Dynsight 진단 복사를 확인했습니다. 수집 성공은 실제 OOM 원인이 밝혀지거나 문제가 해결됐다는 의미는 아닙니다.
