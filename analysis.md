원인을 재현해서 확인했습니다. 이 메시지는 펌웨어 실행 오류가 아니라, 확장의 콜백 분석기가 일반 데이터까지 과도하게 추적하면서 보호 한도에 도달했다는 뜻입니다. 단순히 프로젝트가 큰 것 외에, 분석기의 타입 처리와 메모리 변경 추적에 구체적인 문제가 있습니다.
1. 콜백과 무관한 정수·배열 쓰기가 256개 슬롯을 소비합니다
두 가지 원인을 확인했습니다.
- 표준 정수 타입 인식 누락 — src/member-resolver.ts:53의 스칼라 판별에 uint8_t, uint16_t, uint32_t 등이 없습니다. 실제 분석 결과에서도 command_timeout_ms, last_accepted_command, pending_mask가 정수가 아닌 타입을 모르는 저장소로 취급됩니다.
- 배열 원소의 기본 타입 정보 손실 — src/pointer-targets.ts:505에서 배열 인덱싱·역참조 결과 타입을 만들 때 기본 타입 이름이 빈 문자열이 됩니다. 따라서 dst[0] 같은 바이트 원소도 불필요한 변경 요약에서 제외되지 않습니다.
작은 소스로 비교해도 차이가 재현됩니다.
콜백과 무관한 데이터 쓰기	결과
unsigned int 구조체 필드 257개	제한 없음
uint32_t 구조체 필드 257개	mutation limit 발생
unsigned char *dst에 원소 256개 쓰기	mutation limit 없음
같은 배열에 원소 257개 쓰기	mutation limit 발생
따라서 로그의 parameter[2][256]은 콜백 후보가 256개라는 뜻이 아니라, 출력 버퍼의 각 원소가 변경 슬롯을 하나씩 차지했다는 뜻입니다.
2. memcpy의 읽기 전용 원본까지 변경 가능 영역으로 처리합니다
현재 본문이 없는 함수는 opaque call로 처리합니다. memcpy·memset 전용 동작 모델이 없어 포인터 인자가 가리키는 영역을 보수적으로 무효화합니다.
관련 경로는 src/pointer-targets.ts:815, :856입니다.
memcpy(&nv[offset], &fbs[offset], size);
이 코드에서 목적지 nv뿐 아니라 읽기만 하는 원본 fbs도 변경 가능 영역에 등록됩니다. 반복 복사마다 원소별 영역이 쌓입니다.
사용자 로그의 다음 항목이 정확히 이 현상입니다.
first omitted=product_log_data_message_nv_pack.parameter[1][500]
parameter[1]은 입력 fbs_raw입니다. 생성된 codec 파일만 분리해서 분석해도 동일한 누락 위치까지 재현했습니다.
3. stop/fetch 경고는 하위 함수의 영향이 호출자까지 전파된 결과입니다
두 경고 위치는 모두 같은 함수를 호출합니다.
priv_task_data_event_finalize_stop:1036
product_task_data_cmd_ctrl_check_stop_command_progress:1411
  → priv_try_finalize_stop()
    → product_task_data_rack_stop_clear()
      → 여러 전역 버퍼·slot·lane·group을 memset()
분석기는 하위 함수의 변경 영역과 연결된 포인터를 호출자에서 다시 추적합니다(src/pointer-targets.ts:323). 이 과정에서 256개 도달 한도를 넘습니다.
즉, 1036행 자체가 복잡해서가 아니라 하위 호출의 변경 영향이 누적된 것입니다. priv_complete_group의 call-effects, command dispatch의 branch-join 경고도 각각 호출 대상들의 변경 영향, 분기별 변경 영향을 합치다가 발생합니다.
4. 반복 분석과 넓은 캐시 무효화가 10초 중단을 유발합니다
src/pointer-targets.ts:165에 콜백 분석 전체의 10초 제한이 고정되어 있습니다.
캐시도 개별 함수가 읽는 값뿐 아니라 전역 heap 크기와 전체 region revision을 검사합니다(:928–932). 계측 결과, codec 함수의 인자·읽은 값·호출 함수가 그대로인데도 전역 상태 변화 때문에 재분석되는 경우를 확인했습니다. 로그의 runs=5 · cache hits=0과 연결됩니다.
따라서:
Project budget observed at … priv_handle_reset_command
는 해당 함수가 10초를 사용했다는 뜻이 아닙니다. 전체 예산이 소진됐을 때 우연히 분석 중이던 위치입니다.
검증 결과와 수정 우선순위
실제 현재 설정의 196개 파일·1,215개 함수에서 같은 현상을 재현했습니다.
- 콜백 분석 OFF: 콜백 제한 경고 없음.
- codec .c 두 개 제외: stop/fetch의 256개 제한과 10초 중단은 여전히 발생.
- 기존 관련 테스트 67개: 모두 통과. 이번 정수 타입·배열 패턴을 충분히 검증하지 못하는 테스트 공백이 있습니다.
권장 수정 순서는 다음과 같습니다.
1. 표준 정수 타입 판별과 배열·역참조의 타입 정보 보존.
2. memcpy·memmove·memset의 실제 읽기/쓰기 동작 모델링.
3. 콜백 관련 저장소 중심으로 변경 요약 축소.
4. 전역 변경 때문에 무관한 함수까지 재분석되는 캐시 의존성 개선.
256 또는 10초를 올리는 것만으로는 근본 해결이 어렵습니다.
별도로 .vscode/settings.json:148의 **/producy/ebsc/**는 product 오타로 보여 현재 매크로 확장 대상이 0개입니다. 이번 제한의 직접 원인은 아니지만 분석 정확도에 영향을 줄 수 있습니다.
원인 분석만 수행했으며, 확장 소스와 펌웨어 소스·설정은 변경하지 않았습니다.
