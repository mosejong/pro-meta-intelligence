# 역대 시즌 선수와 연습 함께 저장

Claude Opus5.5 medium 구현. 기존 cc08e643 현재선수+밴픽 보관을 확장한다. 먼저 관련 파일과 docs/IMPLEMENTATION_CADENCE_2026-11-19.md를 읽는다. 목표는 시즌선수가 배정돼도 연습 보관함에서 현재선수/시즌선수 구성과 밴픽을 함께 저장·복원하는 것이다. 기존 guest-club와 season-player-cards 검증/카탈로그 로더를 재사용한다. 현재선수 bundle v1 및 옛 plain draft 호환 필수. 선수 이름 연결·카탈로그 임의 생성·과거선수 현재선수 취급 금지.

소유 파일: web/app/practice-roster-bundle.ts, draft-practice-library.ts, draft-practice-library-panel.tsx, roster-workshop.tsx, draft-lab.tsx 및 필요 최소 신규 헬퍼/신규 web/tests/season-practice-bundle.test.mjs. 기존 season-player-cards.ts/guest-club.ts는 읽기만. package.json 변경 금지. 결과 문서 docs/CLAUDE_SEASON_PRACTICE_RESULT_2026-11-19.md 작성.

저장은 선택한 SeasonCardRef 및 기준 식별자를 유지하며 현재 슬롯과 시즌 슬롯 중복/두팀간 중복선수를 거부한다. 복원 시 현재 공개 카탈로그의 catalog_id/card_id/player_id 및 역할/원본 기준을 검증한다. 없거나 바뀐 카탈로그·오프라인·로더 실패 시 조용히 버리거나 현재 로스터로 대체하지 말고 기존 상태를 보존하며 한국어 안내한다. 비동기 로딩 동안 팀변경/취소/새 요청/방 시작은 늦은 적용을 막는다. 완전검증 뒤 draft+roster+season 한번의 명시 복원으로 적용. 기존 장치 로스터가 늦게 덮어쓰지 않도록 유지. 로스터 준비 gate 유지. 저장 크기 제한과 IDB 원자성/5개 한도 보존. 시즌자료를 실전 승률이나 능력치로 취급하지 않는다.

구현 후 신규 핵심 단위만 실행(왕복/구버전/카탈로그 불일치/중복/손상). full npm/브라우저/설치/네트워크/git/하위에이전트 금지. 권한 거부는 반복하지 말고 보고. 구현이 과도하면 작은 안전한 완료범위를 명시하고 절반 구현을 정상지원처럼 표시하지 않는다. 한도 오류면 정확한 오류와 reset시간/세션을 남기고 종료, 유료/모델우회 금지. 코드수정 및 핵심 확인 결과를 문서로 남겨라.
