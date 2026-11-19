# 모델 자원 흐름 — Claude 구현 / Codex 검증

목표: 현재실험은현재4숫자와최근8사건만보여주므로 결과에이른시간흐름을한눈에보기어렵다.
고정run을다시돌리지않고 **지금까지본모델자원흐름**을두팀선그래프로보여준다. 실제골드/승률/선수효과아님.

소유 신규web/app/experiment-resource-history.ts, 신규web/app/experiment-resource-history-panel.tsx,
기존web/app/experiment-replay-panel.tsx(작은wiring), 기존experiment-replay-panel.css(최소style),
신규web/tests/experiment-resource-history.test.mjs, web/package.json(test목록추가만),
신규docs/EXPERIMENT_RESOURCE_HISTORY_2026-11-20.md. 다른engine/입력/저장/링크/비교규칙변경금지.
Claude Opus5.5 medium이구현/수정. Codex독립검토·실행·브라우저검증. Read/Edit/Write/Glob/Grep만.
Bash/tests/git/network/subagent없음. 실제quota면error/reset기록후중단·모델/유료/계정우회없음.

최소읽기 experiment-replay.ts의replayFrame/CORE_TEAM_IDS/INITIAL_STATE/MAX_MINUTE/ExperimentRun,
experiment-replay-panel.tsx의frame/상태/사건표시, 기존experiment-replay-review.test.mjs/experiment-event-navigation.test.mjs fixture.

데이터helper:
- 이미만든run과현재shownMinute를받아0부터보이는분까지만각분의두gold값을반환한다.
- 기존replayFrame을재사용해계산하며자원획득규칙복제·simulateManager/buildRun/batch호출없음.
  최대61개frame(point0~60)라범위고정. fractional/negative/NaN같은입력은명시거부또는기존frame과일관된안전정규화, 문서화.
- 출력/그래프/축/data-attr/접근성라벨/표에는미래분·미래자원·winner·숨겨진실제endMinute가없어야한다.
  x축은현재보이는분범위만(0이면0point처리); y범위도지금까지값만. 실제종료분을끝미리노출금지.
- sourceID/core대응은고정run만, 현재팀선택이나현재입력란읽지않음. 바뀐진영도run당시팀명에묶는다.
- UI는이페이지에서만든run으로만호출. helper는순수읽기이며원본/이벤트/배열불변, 반환수정도원본영향없음.

UI:
- run이있을때현재상태아래별도기본접힘details '지금까지의 모델 자원 흐름'. main한페이지과밀방지.
- 제목/설명 '실제골드가아닌모델자원이며현재재생시각까지의고정기록. 다시계산하지않습니다'.
  '다시계산'은모델재실행뜻으로명확히(프레임읽기는존재).
- 외부chartlib없이SVG viewBox로선2개. 숫자formatter기존ko사용, 색만의존하지않는실선/점선+팀명legend.
  SVG role img+고유title/descID, 기본범위가보이며빈/0분/두팀동일값에서도유효한좌표(noNaN/div0).
- 보조접힘 '분별 값 보기'에현재까지의분·두팀숫자table을제공해스크린리더/정확값확인가능.
  SVG와table둘다미래없음. table은가로스크롤경계안에서모바일pageoverflow없음.
- 재생/step/seek/되감기/실행교체시표시만동기화. 새타이머/자동재생/자동실행/저장/서버없음.
  가정입력란만바꾸면기존고정run chart가달라지면안됨. 비교A 보관·링크복사에도영향없음.

tests:
실제buildExperimentRun fixture로0/중간/종료/되감기값을각분replayFrame의gold와직접대조.
필터링된과거값만확인할수있는미래이벤트/최종winner/state변경probe에서이전시각출력불변검증
(helper입력은사용자가보낸신뢰입력이라고주장하지않는pure형식으로테스트가능).
코어팀명대응/side반전/같은표시명구분(팀1/2등rawID불필요), 원본/반환격리,
범위/0분/동일양팀값coord안전, SSR SVG·table미래없음/접힘/접근성·모델범위문구.
기존엔진을문자열grep하는테스트금지. package.mjs경로슬래시유지.
Codex가실제PC/모바일seek/되감기/현재입력변경불변·새run교체E2E를추가한다.
완료보고는파일·미실행검사·남은리스크만간결히.
