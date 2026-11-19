# 다음 구현: 같은 밴픽의 여러 재현 번호 비교
속도 우선: 구현→타입/관련 핵심 확인만, 전체npm/브라우저는부모가통합시한번. Claude Opus5.5 medium. 기존 단일 가정실험/동결A-B비교를 재사용한다. 새로운 실제승패모델을 만들지 않는다.

목표: 현재 비교가능한 기준A/실행B를 같은 여러 시드로 명시적 한 번 실행해 모델 결과의 흔들림을 비교한다. 버튼을 누를 때만 계산. 기본20쌍, 정수1~30쌍 상한. 미리 정한 동일시드목록을A/B각각사용, seed목록과규칙버전·대상맥락을 결과에보존. A/B조건불일치/미신뢰실행은기존비교검증으로거부. 이름·진영이아니라원본teamID대응. 사용자 A/B 가정만달라지는 paired실험이다.

결과: 실제승률·신뢰구간·실전예측주장 금지. 각팀의 모델내부승리횟수(분모명시, 퍼센트없음), B-A자원/킬/종료분 차이의 min/median/max 정도만 간단히. 20개seed는임의선택된모델실험이지모집단통계가아님. 선수/챔프/룬/아이템실제효과여전히미지원. summary는짧게, 상세rows는접기. 같은가정이면각쌍차이0이어야한다.

소유: 신규 web/app/experiment-batch.ts, 신규 web/app/experiment-batch-panel.tsx/css, 기존 web/app/experiment-comparison-panel.tsx(최소추가 연결), 신규 web/tests/experiment-batch.test.mjs, docs/CLAUDE_EXPERIMENT_BATCH_RESULT_2026-11-19.md. 기타수정금지(package부모담당). simulation-core/replay/trust/현재밴픽/저장형식 변경금지. A/B현재기준교체/새실행시기존batch결과를몰래재계산하지말고대상불일치안내/명시재실행. 계산완료뒤깊은동결,원본불변. 기존실행재생/현재선택을바꾸지않는다. 버튼은원래단일B재생종료후에만가능.

관련unit과가능하면typecheck만. 전체npm/Pages/browser/git/설치/네트워크/다른에이전트 금지. 검사권한막히면재시도하지말고부모에알림. 결과는구현파일·실행한검사·미완료를짧게. 한도우회/대체모델/유료전환금지.
