# 문제 접수부터 수정 릴리즈까지

사용자는 확장의 **Diagnostics → Report issue**에서 보고서를 만들고,
[GitHub Issues](https://github.com/mrdylee/vscode_extension_relation_window/issues)에
직접 제출합니다. 공개 게시물에 회사 소스 전체나 원본 프로젝트를 요청하지 마세요.

1. **분류**: 버전, 운영체제/WSL, `status`, `workerError`, `notices`부터 확인합니다.
   같은 증상과 환경의 기존 Issue가 있으면 연결합니다. 실제 수정 전에는 해결로
   표시하지 않습니다.
2. **가설**: `worker-out-of-memory`는 Worker 종료, `memory-budget`은 분석 중단,
   `syntax`는 파서 진단입니다. `macro-limit`/`callback-limit`은 제한에 따른 누락
   가능성입니다. 모두 같은 원인으로 취급하지 않습니다. `other`가 많으면 사용자가
   검토한 오류 한 줄이나 비밀을 제거한 재현 코드만 추가 요청합니다.
3. **측정 해석**: `sampleAgeSeconds`가 크면 마지막 측정이 오래된 것입니다.
   단계별 `checkpoints`와 `firstLimit`를 비교하되 JS heap을 전체 RAM이나
   특정 단계의 순수 할당량으로 단정하지 않습니다. 공유 extension host 수치도
   우리 확장 단독 사용량이 아닙니다.
4. **재현**: 보기 모드/깊이/고정/함수 인자 옵션과 재현 순서를 맞춥니다. 경로와
   패턴은 보고서에 없으므로 필요할 때만 익명화한 범위 설정을 요청합니다.
   Windows/macOS/WSL 환경 차이와 소스 분석 문제를 구분합니다.
5. **수정**: 실패하는 회귀 테스트를 먼저 추가하고 수정합니다. 작은 재현에서
   Caller/Callee와 실제 호출 위치가 보존되는지 확인하고 해당 환경에서도 검증합니다.
6. **리뷰·게시**: review-work → 검사 → 버전/태그 → GitHub 릴리즈 → VSIX 다운로드
   확인 순서로 마무리합니다. Issue에 해결 버전과 재확인 방법을 남기고 사용자
   확인 또는 충분한 재현 검증 후 닫습니다.

보고서 형식에는 `reportSchema`가 있습니다. 자동 분류를 나중에 추가할 때도
사용자가 작성한 코드·로그·본문은 신뢰할 수 없는 입력으로 취급하세요. 지금은
자동 답변, 자동 수정, 자동 Issue 종료 기능을 제공하지 않습니다.
