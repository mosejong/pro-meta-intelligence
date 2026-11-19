# 여러 시드 가정 비교 결과를 쉬운 글로 복사

Claude Opus5.5 medium. 자동 진행의 작은 UX 작업. 기존 experiment-batch-panel.tsx 결과에 일반 이용자용 비교 요약 복사 버튼을 추가한다. JSON/export파일/새엔진/실전 승률/신규 API 불필요. 결과는 이미 계산한 BatchResult만 읽고 복사할 때 절대로 runExperimentBatch/단일엔진 재호출 금지. 모델 내부 실험이며 실제 선수·챔프·룬·아이템 효과/실전 예측 아님을 요약에 남겨라. A/B 번호, 재현번호목록과 쌍수, 팀별 모델승리 횟수/분모 및 자원/킬 차이 범위/종료분 차이 포함. 현재 B와 다른 오래된 결과는 복사 버튼 비활성화하고 이유를 표시. 복사성공은 clipboard.writeText 완료 후에만 알리고, API없음/거부시 선택가능 textarea로 동일 일반글 수동복사 제공. 비동기 복사 중 B/기준A/결과 변경·unmount 시 오래된 성공상태를 보여주지 말 것. 이전 렌더의 stale 클로저 금지. 권한/외부공유/네트워크 추가 없음.

소유: web/app/experiment-batch-panel.tsx, 신규 web/app/experiment-batch-summary.ts 및 신규 web/tests/experiment-batch-summary.test.mjs, docs/CLAUDE_BATCH_SUMMARY_RESULT_2026-11-19.md. 다른파일/package/git/설치/브라우저/fulltest/하위agent 금지. 기존CSS 재사용 또는 최소 inline 구조, 스타일파일변경금지. 기존 BatchResult 타입과 label을 재사용. 원본불변/동일결과 결정성/쉬운글/실전효과표시없음 핵심 단위작성하고 해당파일만 테스트시도. 승인단계 거부는 반복하지 말고 보고, Codex가 실행. 한도오류면 실제오류/reset시간기록후종료. 추가과금/모델우회없음.
