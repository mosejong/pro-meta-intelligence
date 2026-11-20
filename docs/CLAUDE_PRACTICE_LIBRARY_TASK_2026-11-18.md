# Claude 구현 작업 2 · 이름 붙인 연습 보관함

작업 1 독립 검증 통과 뒤에 실행한다. 모델 Opus 5.5 medium. Claude 구현, Codex 독립 검증. 포지션 보존(v4) 구현을 재사용한다. 작업 지시만 준비된 상태에서 실행했다고 표시하지 않는다.

## 목표
일반 이용자가 JSON을 몰라도 여러 밴픽 연습을 이름 붙여 보관하고 다시 열 수 있게 한다. 기존 자동 이어하기 sessions/current, 게스트 구단 보관, 링크 공유를 재구현하거나 덮어쓰지 않는다.

## 소유 파일
신규 web/app/draft-practice-library.ts, 신규 web/app/draft-practice-library-panel.tsx 및 css, web/app/draft-lab.tsx(통합 부분만), 신규 web/tests/draft-practice-library.test.mjs, 신규 web/tests/e2e/draft-practice-library.spec.mjs, docs/CLAUDE_PRACTICE_LIBRARY_RESULT_2026-11-18.md. 그 밖의 변경은 제안만. package 등록은 Codex.

## 계약
- 로그인 없이 이 기기에 최대 5개, 이름 50자 이내(공백/제어문자 검사), 명시 저장·목록·불러오기·삭제. 같은 이름은 ID가 달라 구분 가능하거나 중복 이름을 명확히 거부. 조용한 덮어쓰기 없음.
- 기존 IndexedDB pro-meta-draft v1은 바꾸지 않는다. 별도 작은 DB/store로 보관함을 분리한다. 로컬 아카이브 스키마 버전·고유 ID·이름·작성 시각·시나리오 문자열을 보존한다. 기존 parseDraftSession/serializeDraftScenario 및 최신 명시 positions를 사용한다. 다른 데이터 모델을 복제하지 않는다.
- 저장 성공은 transaction 완료 뒤에만 표시. 개수 제한·손상/미지원 레코드·잘못된 시나리오·용량·차단/timeout/읽기쓰기 실패 때 기존 항목과 진행중 밴픽 보존. 열기/본문읽기/쓰기는 bounded; 늦은 성공도 잘못 적용하지 말 것. 다중 탭 readwrite transaction으로 5개 제한/동시 저장을 검사.
- 목록 자체는 밴픽을 변경하지 않는다. 진행 중인 선택/이전 세트/올려놓은 챔피언이 있으면 불러오기 전에 명시 확인·취소. 유효성 검사 실패/취소 시 현재 연습·보관함 모두 보존.
- 불러오기는 기존 restoreSession을 재사용하고, 이전 자료를 최신으로 바꾸지 않는다. 기존 frozen snapshot 표시 유지. A/B 기준/타이머/자동 상대는 기존 파일 import와 같은 초기화 경로. 저장은 현재 명시 역할·미배정까지 포함하지만 가상 선수/감코/시즌 라인업은 포함하지 않음을 짧게 알린다.
- 친구 방 활성 시 저장/불러오기/삭제 잠금. 방 메시지/공유 링크 형식·서버 API 변경 금지.
- 메인에 펼친 긴 새 패널을 얹지 않는다. '내 연습 보관함' 접힘 UI와 짧은 한국어 동작으로 제공. 파일 고급 설정은 유지. 화면 390px, 44px 터치, 키보드 focus/취소 확인.

## 검증/범위
관련 단위 검사 + 타입 검사. 브라우저 spec 작성/실제 실행 구분. npm 명령 루트에서 --prefix web. 소스·package 수집/추가·번역·외부 계정·키·구매·크레딧설정·git commit/push/merge/deploy·폴더삭제·다른에이전트 생성 금지. 모델/한도 오류면 우회 없이 중단. Codex가 최종 lint/전체/브라우저 검사.

결과 문서에는 변경 파일·실제 검사·실패·미지원만 짧게 기록한다. 유틸리티 점수/승률을 만들지 않는다.
