# 실험 안내의 공유 범위 정정 — Claude 구현/수정

현재 고정실행·A/B·여러시드 요약글 복사가 구현됐는데 experiment-replay-panel.tsx 모델설명은
'실행은 이 화면 메모리에만 있으며 저장·공유되지 않습니다'라고 하여 일반이용자가 혼동할수있다.
실행 원본/재생입력은영속저장·링크공유되지않고 완료요약글만복사된다는 차이를 짧게명확히하라.
새기능이아닌 실제지원범위 오류수정이다.

최소읽기 web/app/experiment-replay-panel.tsx, experiment-comparison-panel.tsx, experiment-batch-panel.tsx의사용자안내.
소유 위3패널 중 필요파일만, web/tests/experiment-replay.test.mjs(기존SSR)과 필요시기존experiment-comparison.test.mjs.
고정원본/브라우저메모리/요약글복사/페이지떠날때유실의사실만짧게정정. 단일·A/B·batch문구가
서로모순되면함께정정하되 과잉설명하지말것. 미리완료되지않은복사활성화나모델가정/조건 변경금지.
실제서버전송·계정저장·다시재생할링크가있다고하지말것.

기존SSR에실제안내가요약글복사와실행원본유실을구분하는지최소assert추가. 기존행동검사유지.
새타입/helper/설정/저장/shareURL/번역/엔진/제품구조변경없음. CSS필요없음.
Codex는실행·독립검증만, 제품소스는Claude가맡는다. Read/Edit/Write/Glob/Grep만사용.
Bash/tests/git/network/subagent금지. 실제한도면오류/reset후중단, 모델/유료/계정우회금지.
짧게변경파일과미실행검사를보고.
