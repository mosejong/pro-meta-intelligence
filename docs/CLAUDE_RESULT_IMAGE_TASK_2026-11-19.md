# 빠른 구현: 밴픽 결과 PNG 저장
Claude Opus5.5 medium. 기능먼저구현, 관련핵심만확인. 전체npm/build/브라우저/git/설치/네트워크/하위에이전트 금지. 다른Claude는 experiment-batch 파일을작업중이니 해당파일건드리지않는다.

목표: 완성된 DraftResultPanel에서 '밴픽 결과 이미지 저장' 버튼을 눌러 모바일/PC용 PNG를 다운로드. 일반인에게JSON대신공유할작은이미지다. 기존 buildDraftResultReport READY 결과를입력으로재사용. 팀이름/블루레드/픽5개·밴5개/패치·자료기준일과 '연습 결과 · 승패 예측 아님'을읽기쉽게표시. 임의승률/점수/실력효과/포지션확정추정없음. 캔버스에는텍스트만그려외부이미지/CORS/fetch필요없게한다. 챔피언이름은기존nameOf사용, 사용자팀이름은길이/줄바꿈제어해클리핑안되게. 읽기쉬운세로형1080폭(최대총픽20행)정도. 브라우저 Canvas2D/Blob/URLcreateObjectURL로서버전송없이PNG. 준비미완료/방잠금/disabled에서는저장차단, busy처리/실패안내/URLrevoke/연속클릭차단. 비동기완료전현재result가바뀌어도처음누른고정입력만저장하며이전결과임을분명히. 실패/다운로드가현재draft를바꾸지않음.

소유: 신규 web/app/draft-result-image.ts, 기존 web/app/draft-result-panel.tsx(최소버튼연결), 신규 web/tests/draft-result-image.test.mjs, docs/CLAUDE_RESULT_IMAGE_RESULT_2026-11-19.md. 필요하면신규이미지전용CSS한파일. package/기존solo CSS/데이터/서버/다른파일수정금지. 원본결과의순서보존, 모든문구는한국어. 외부서버업로드나WebShareAPI를성공했다고꾸미지않고다운로드만. 폰브라우저의파일저장동작한계명시.

unit:표시모델직렬화순수함수/입력불변/READY미지원거부/긴이름/빈이름대체/기준일명시/동일결과결정적. Canvas대역으로그림글자누락/버튼실패최소확인만가능하면. 권한막히면재시도없이부모에게보고. 완료파일·진짜실행검사·미완료짧게. 한도우회금지.
