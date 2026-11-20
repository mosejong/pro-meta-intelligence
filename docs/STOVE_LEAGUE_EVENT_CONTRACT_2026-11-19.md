# 스토브리그 변경 이벤트 연결 계약 · 2026-11-19

연구자료 STOVE_LEAGUE_SOURCE_REVIEW_2026-11-19.md/JSON을 런타임현재소속표로 취급하지 않는다. 현재 관측데이터와 가상 로스터 검증은 그대로 유지한다.

제안별도층(설계, 신규DB스키마아님): event_id, subject_type=PLAYER/COACH, source_subject_id(nullable), display_name, team_id(nullable), change_type, target_season, announced_at(nullable), effective_from/to(nullable), verified_at, source_url, original_url_verified, verification_class, review_status. 감독/코치는 선수5슬롯과별도. 이름일치만으로선수안정ID연결금지. source_subject_id가없으면계약사실연결이아니라미연결연구항목이다.

- RELEASE/CONTRACT_END는 FA자격/타팀입단/선발/은퇴로자동전환하지않는다.
- RENEWAL은계약유지범위만, STARTER확정아님. AGENCY_SIGNING은PRO_RETURN아님.
- 효력일미확인은null유지, 발표일/뉴스게시일로대체하지않는다.
- OFFICIAL_CONTENT_VIA_PLATFORM_MIRROR/B_REPORTED/C_RUMOR는자동소속주입대상아님. 원문직접검증과효력/시즌/안정ID확인후사람검토를거쳐도과거관측팀은덮어쓰지않는다.
- 사용자가가상선수선택을하면HYPOTHETICAL이며관측/공식선발과분리. 새소속공지가옛팀사용기록의출처를바꾸지않는다.
- 감코진효과·팀이적효과·선수강함수치는현재모델미지원. 계약발표를능력치/승률변화로치환하지않는다.

실제수집원추가/스키마이행/추천반영/공개로스터자동갱신은이번작업에없다. 출처연구와동일성검토완료후좁은별도구현으로진행한다.
