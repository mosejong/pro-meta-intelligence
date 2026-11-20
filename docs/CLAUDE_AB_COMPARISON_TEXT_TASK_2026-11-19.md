# 완성된 단일 A/B 비교 요약 — Claude 구현 / Codex 검증

목표: 기존 단일 시드 가정 A/B 비교를 일반 한국어 글로 복사. 현재 단일 실행 요약과 다중 시드 요약은 있지만 단일 A/B 비교 요약은 없다. 새 모델/예측/저장/방/링크 기능 아님.

Claude Opus 5.5 medium 제품 구현/수정 담당, Codex 독립 검사. 최소 읽기: experiment-comparison.ts/panel.tsx, experiment-result-text.ts/share-panel.tsx의 안전·비동기 패턴, experiment-comparison.test.mjs fixture. 필요 시 replay.ts trustedRun. 전체 기획 읽지 말 것.

소유: 신규 web/app/experiment-comparison-text.ts, 신규 web/app/experiment-comparison-share-panel.tsx, 기존 web/app/experiment-comparison-panel.tsx/CSS 최소 wiring, 신규 web/tests/experiment-comparison-text.test.mjs, web/package.json test 파일 목록에 추가만, 신규 docs/EXPERIMENT_COMPARISON_TEXT_2026-11-19.md. 기존 엔진·검증·저장·비교 규칙 변경 금지.

순수 builder는 unknown A/B와 shownMinute를 받아 기존 compareExperimentRuns + trustedRun으로 검증. B 종료 전, 같은 실행, 서로 다른 입력/시드/팀/패치/근거, 비신뢰 객체는 전체 거부. 구조만 맞춘 복사 객체도 거부. 모델/배치 재실행 없음. 현재 입력이 바뀌어도 이미 고정된 유효 A/B 요약은 그대로이며 '보관된 두 실행 비교'임을 명시. 이미 본 결과로부터 종료시점/팀별 네 가지 outcome 원값과 B-A 차이/각 팀 가정 A→B/변경 없음·단일·다중 의미/고정 시드·규칙·패치·기준 시점/실제 승률·선수챔피언룬아이템 효과 아님 포함. 하나가 다른 이름이어도 source ID로 대응. 같은 표시명은 팀1/팀2 등으로 구별하며 raw ID를 글에 내보내지 말 것.

텍스트는 기존 cleanField 등 재사용 가능한 안전 도구 활용. 줄바꿈·제어/양방향 문자 안전, 누락/비정상 정보 전체 거부, 총길이 제한. 원본 JSON/스냅샷/선수ID/팀ID/evidence key 유출 금지. 결과값 임의 0대체/재해석 금지. 필요 시 기존 trusted output만 받는 좁은 타입. 변화없음이면 차이0, 다중변경이면 한 가정 기여로 나누지 않음.

UI: 가정 비교 details 안에 'A/B 비교 요약 복사' 버튼. 유효 완료된 서로 다른 실행만 활성화. 거부 이유 짧게. 자동복사 거부 시 읽기전용 textarea 직접선택. 비동기 완료가 늦게 와도 A교체/해제·새 B·B종료 전 되감기·unmount 뒤 이전 성공/실패가 뜨지 않아야 한다. 이전 종료상태를 떠났다가 돌아와도 이전 진행중 promise는 무효. 자동복사 외 저장 없음. 기존 UI 톤·레이아웃 유지, 가정/비교/배치 실행에는 영향 없음.

테스트: 실제 buildExperimentRun fixture로 valid/none/single/multiple, sourceID와 표시명 충돌, 입력/시드불일치·같은실행·종료전·NaN·미신뢰 거부, 안전텍스트/총길이, 원본불변. SSR disabled/경계 확인. 숫자 하드코딩으로 자기구현 재서술하지 말고 기존 비교 결과와 대조. Codex가 browser async/race 검증 추가. package 목록 경로 구분자는 '/' 그대로.

Bash/실행/테스트/git/network/subagent 금지, Read/Edit/Write/Glob/Grep만 사용. 테스트는 Codex. 한도 시 actual reset/error 보고하고 중단, 모델/유료 우회 금지. 완료 보고는 짧게, 미실행 검사 정확하게.
