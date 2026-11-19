# 과거 시즌 팀 구성을 한 번에 배정

Claude Opus5.5 medium. 2015가추가된현재카탈로그(2015/2022/2026) 재사용. 과거시즌선수5명을매번수동검색하지않고, 선택한연도의관측팀에서역할별최다출전구성을한번에BLUE또는RED에적용하는작은기능. 공식선발/최강/실전효과를주장하지말고표시명은역할별최다출전구성.

소유 web/app/season-lineup-panel.tsx, roster-workshop.tsx(새 callback과원자적적용만), 신규 web/app/season-team-preset.ts, 신규 web/tests/season-team-preset.test.mjs, docs/CLAUDE_SEASON_TEAM_PRESET_RESULT_2026-11-19.md. 기존season-player-cards.ts/guest-club.ts/타파일/public/package/git/network/install/fulltest/browser/subagent금지. 기존CSS사용.

pure helper: source_id+season+team_id로그룹하고각TOP/JUNGLE/MID/BOTTOM/SUPPORT에서game_count가가장큰카드1개를고름. 여러카드동률이면임의선택하지말고해당구성거부+수동선택안내. 빈역할/동일player복수역할/다른source/year/team섞임거부. 이름으로선수/팀합치지말것. team_names원본표기와각역할선수/경기수미리보기를제공하고, 샘플수는강함아님. 순서/입력불변/해시ref정확유지.

UI 현재선수시즌선택 재사용, 관측팀 select(연도따라목록갱신, 선수검색과는독립). 불완전팀도목록가능하지만버튼비활성사유. BLUE/RED 적용 버튼을명시선택하면 preview5역할을 callback한번으로전달. 추가확인모달불필요하지만새구성이현재선수5자리를대체함을버튼근처명시. 기존onChoose개별배정유지. callback에서target팀의현재5슬롯을모두비운복사본+seasonSlots5를같이만들어검증한뒤적용. 상대의현재/시즌과동일선수중복이면전체거부,원본/현재상태불변. disable/복원중/방중기존gate유지. preset성공시현재선수onRosterChange/live준비경로기존commit 재사용, 시즌보관메타기존연습과연결. 현재배정과통계를능력치로사용하지말것. ui불필요설명장문금지.

기존실제2015SKTelecomT1에서TOPMaRin114/MIDFaker77/JUNGLEBengi97/BOTTOMBang114/SUPPORTWolf102를최다출전으로고를수있는지단위로확인(공백오탈자는정상JUNGLE). 테스트:관측팀순서불변/동률거부/빈역할거부/중복선수거부/실제카탈로그2015팀/원본불변. 해당단위만시도,명령승인거부는반복말고보고. 한도면정확오류/reset기록후종료과금모델우회없음. 결과문서에구현/미검증구분.
