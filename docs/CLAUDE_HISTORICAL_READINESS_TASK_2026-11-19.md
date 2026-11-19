# 과거 선수의 실험 미지원 상태를 명확히 연결

Claude Opus5.5 medium. 현재과거시즌선수를고르면현재슬롯이비어시뮬레이션입력은실행안되지만다른탭에는선수빈칸만보여사용자가저장실패로오해할수있다. 새실제효과모델을구현하는것아님. 과거선수는연습/보관/관측참고지원, 가정실험선수효과미지원이라는기존범위를명확히한다.

소유 web/app/simulation-readiness-panel.tsx, draft-lab.tsx, docs/CLAUDE_HISTORICAL_READINESS_RESULT_2026-11-19.md. 다른파일/핵심스키마/엔진/기존테스트/package/git/network/install/fulltest/browser/subagent금지.

ReadinessPanel에선택적hasHistoricalPlayers(defaultfalse), onOpenRoster? prop추가. draftlab기존rosterMeta.seasonPlayers를전달, callback은기존studioTab ROSTER이동(선수구성/밴픽수정없이). hasHistoricalPlayers면간결한한국어상태: 과거시즌선수구성은보관·밴픽참고용이며현재가정실험입력에는미연결;선수가사라진게아님. 버튼'선수 구성 확인'으로탭이동만. 기존빈칸실패목록대신우선사유로보이게하되적용가능현재선수역할표를허위완성으로채우지말것. 과거선수를현재선수로자동대체/삭제절대금지.

hasHistoricalPlayers면readySnapshot/null발행/보관/실험실행가능여부를확실히차단하고부모ExperimentReplayPanel에이전readyInput이남아도hasHistoricalPlayers면null전달. 코어SimulationInputSnapshot/file schema는그대로. 과거선수가해제되면원래준비검사흐름으로돌아가고기존입력을멋대로유효화하지말것. 기존A/Bfrozen실행은과거값으로변조하지않으며미지원상태에서새실행을허용하지말것. 저장/복원/자료보존변경없음.

아주작은연결변경이므로구현과수동코드검토로보고하고,명령실행승인막히는환경이라타입/lint/browser는Codex가직접진행. 불필요한복제테스트나하위agent생성없음. 한도면정확오류/reset기록후종료과금모델우회없음. 결과문서에실행미검증구분.
