1. 오프셋이 버퍼 전체를 콜백 관련 데이터로 만듭니다

config_data_to_registers(
    priv_nv_config_envelope,
    &priv_nv_reg_buf[CONFIG_REG_OFFSET]);
현재 분석기의 의존성 연결은 다음처럼 이어집니다.
CONFIG_REG_OFFSET — 배열 인덱스라 추적 대상으로 선정
  → 변환 함수의 regs 포인터 인자
    → priv_nv_reg_buf 전체를 추적 대상으로 선정
      → 일반 정수 원소 쓰기까지 변경 요약에 포함
src/pointer-targets.ts:567–574에서 주소를 선택하는 인덱스의 의존성과, 포인터가 가리키는 데이터의 의존성이 섞이는 것이 핵심입니다.
다음 비교로 확인했습니다.
재현 조건	결과
pack(&buffer[0])	제한 없음
pack(&buffer[offset])	불필요한 mutation limit
#define BASE 0을 확장하지 않은 pack(&buffer[BASE])	제한 발생
같은 매크로를 확장해서 분석	제한 없음
따라서 매크로 미해석이 촉발하지만, 실제 동적 오프셋에서도 발생하는 분석기 문제입니다.
2. 겹치는 주소 후보 때문에 슬롯 수가 배로 늘어납니다
실제 변환 함수의 변경 요약은 248개 슬롯이었습니다. 그런데 호출자에서 목적지 주소 후보가 다음 두 개로 늘어납니다.
priv_nv_reg_buf[*]
priv_nv_reg_buf[0]
분석기는 각 후보에 하위 인덱스를 붙입니다.
priv_nv_reg_buf[*][0], priv_nv_reg_buf[0][0]
priv_nv_reg_buf[*][1], priv_nv_reg_buf[0][1]
...
그래서 248개 효과가 최대 496개 경로로 확장되고, 128번째 부근에서 256개 제한에 걸립니다. 로그의 first omitted=...[*][128]과 일치합니다.
실제 priv_nv_reg_buf는 1차원 배열입니다. [0][n]은 실제 배열 차원이 아니라 분석기가 원소 주소와 후속 인덱스를 단순 결합해 만든 경로입니다.
그 이후 초과된 변경을 불확실한 영역으로 보존하면서 function-regions, ordered-region 경고까지 이어집니다. 여섯 경고가 모두 독립적인 문제는 아닙니다.
3. 실제 타겟에서 원인을 분리한 결과
펌웨어 파일은 수정하지 않고, 분석 입력을 메모리상에서만 바꿨습니다.
- 원본: 제한 진단 6개
- 두 오프셋을 각각 숫자 0, 400으로 치환한 입력: 제한 진단 0개
이는 진단용 비교이며, 펌웨어에 숫자를 하드코딩하라는 뜻은 아닙니다.
현재 .vscode/settings.json:148에는 여전히 **/producy/ebsc/** 오타가 있어 매크로 확장이 꺼져 있습니다. 다만 NV 파일의 매크로 확장을 켠 실험에서는 별도의 Macro expansion alternative limit도 발생했으므로, 오타 수정만으로 전체 해결을 보장할 수는 없습니다.
4. Line 60은 별도의 파서 지원 문제입니다
static struct bms_config_data write_buf
    __attribute__((section(".os_data_nc")));
이 선언은 GCC 구문 검사에는 통과하지만 현재 Tree-sitter 파서에서는 오류로 분류됩니다. 따라서 펌웨어 문법 오류로 단정하면 안 됩니다. 256개 제한과도 별개입니다.
