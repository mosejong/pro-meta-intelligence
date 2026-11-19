# 피어리스 여러 세트 결과를 쉬운 글로 복사

Claude Opus5.5 medium. 기존 buildSeriesRecap을 재사용해 완료한 여러 세트 밴픽을 일반 글로 복사한다. JSON이나 승패 모델은 추가하지 않는다.

소유: web/app/draft-series-recap-panel.tsx, 신규 web/app/draft-series-recap-text.ts, 신규 web/tests/draft-series-recap-text.test.mjs, docs/CLAUDE_SERIES_TEXT_SHARE_RESULT_2026-11-19.md. 기존 recap.ts는 읽기만. 다른 파일/package/CSS/public/git/network/install/fulltest/browser/subagent 금지.

순수 helper는 검증된 SeriesRecap+patch/cutoff+nameOf를 받아 세트 순서, 선픽 진영, 양팀 이름, 픽5/밴5, 다음 세트 잠금과 총 잠금을 한국어 글로 만든다. 기존 recap에 없는 미완료 현재 세트를 추가하지 않는다. 하나라도 UNSUPPORTED이거나 total_locks가 미확인이면 전체 공유를 거부한다. 완료 세트가 없으면 비활성. 팀/챔피언 이름의 제어문자·bidi·줄바꿈을 정리하고 길이를 제한한다. 입력 불변/결정성. 선수 구성과 명시 포지션은 요약 범위가 아니며 경기 승패·승률 계산이 아니라는 안내, 자료 기준일/패치를 포함한다. 원본 행과 원시 JSON을 내보내지 않는다.

복기 패널 안에 '여러 세트 밴픽 복사' 버튼. 이미 계산한 recap을 읽기만 하고 복사 때 recap/엔진을 재실행하지 않는다. 비동기 복사가 끝나기 전에 recap/nameOf/patch/cutoff가 바뀌면 이전 성공 표시나 수동 복사 글을 숨긴다. 기존 experiment-batch-panel의 useLayoutEffect 토큰과 렌더 identity guard 패턴을 참고하되 공용 리팩토링은 하지 않는다. ClipboardAPI 성공 후에만 성공 문구, 없거나 거부하면 접근성 라벨이 있는 readOnly textarea로 같은 일반 글을 수동 선택하게 한다. 현재 밴픽/세트 상태와 패널의 접힌 기본 상태는 유지한다.

신규 단위: 세트 순서/Red 선픽/진영 교체/잠금 수/미완료 제외(기존 recap으로 생성)/미확인 거부/이름 정리/입력 불변. 새 파일 단위만 시도하고 승인 단계 거부는 반복하지 말고 Codex에 보고한다. 실제 한도 오류면 세션/reset 원문을 기록하고 종료한다. 과금·모델 우회 금지. 결과 문서에 구현/미검증을 구분한다.
