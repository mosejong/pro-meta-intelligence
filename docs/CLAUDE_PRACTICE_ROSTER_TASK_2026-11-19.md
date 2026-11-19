# 다음 구현: 연습에 현재 선수 로스터 함께 보관

Claude Opus5.5 medium. 기존 기능 확장, 속도우선 구현→짧은 핵심 확인. docs/IMPLEMENTATION_CADENCE_2026-11-19.md 참고. 최초 읽기는 아래 관련 파일만 필요한 만큼. 신규 출처/배포/번역/계정 없음.

목표: 내 연습 보관함에서 기존 밴픽·이전세트·명시포지션에 더해 현재 선수 가상 로스터를 선택적으로 함께 저장/복원. 사용자가 체크박스 '현재 선수 구성도 함께 저장'을 명시 선택(기본선택은 안전하게 준비된 로스터가 있을 때만). 기존 저장항목(v1)은 그대로 읽히고 draft-session v2/v3/v4 및 roster-scenario v1 형식을 바꾸지 않는다. 5개 한도/원자적IDB트랜잭션/이름검증/확인모달/늦은복원gate는 유지.

이번 범위는 현재 공개 스냅샷의 선수만. 역사 시즌 선택은 아직 통합저장에 포함하지 않으며 절대 조용히 버리거나 현재선수처럼 저장하지 않는다. RosterWorkshop에서 시즌선수 존재/준비여부를 별도 작은 메타로 부모에 전달해 함께저장을 차단·안내하고, 사용자가 명시적으로 밴픽만 저장하는 건 허용. 기존 구단저장으로 시즌선수 보관은 그대로 유지. 가정실험 실행/기준A/AI이력/친구방credentials는 이 저장에 포함하지 않는다.

권장구조(더 작은 호환구현 가능): 기존 IDB stores/DBversion 유지, scenarios 값에 선택적 버전명시 content봉투를 넣고 옛 plain draft JSON도 읽기. entry metadata는 v1지원과 함께 roster포함여부가 명확한 v2를 수용. save(name,draft,optionalRoster)에서 optionalRoster가있으면 serializeRosterScenario/parseRosterScenario로 draft report의 basis/pair/index에 엄격검증. read는 session과 optionalRoster를 반환하되 옛 read결과는 호환. 잘못된 roster를 '없는것'으로 무시하지 말고 전체항목CORRUPT/INVALID로거부. read/list metadata-summary도 정합검사. 크기상한유지. 기존 autosave/구단DB는 건드리지 않는다.

UI복원: 전부 검증한뒤 기존교체확인후 callback한번으로 draft와 optionalRoster를 전달. parent restoreSession 재사용, roster editor는 명시적 초기복원요청(token+validatedpayload)으로 갱신한다. 같은팀/같은basis에서도 새로선택한저장로스터가적용돼야한다. 이때 localStorage의 오래된 roster를나중에읽어덮어쓰지않게하고 로스터 준비전 simulation/A-B가중간상태를고정하지않게onRosterChange(null)와ready gate유지. 이전버전 저장항목에 roster없으면 기존동작유지/포함하지않음안내. roomactive/async읽기/새팀/새밴픽/roster변경/체크박스변경은 대기확인·늦은load를무효화, 취소는어느상태도교체하지않음.

소유: web/app/draft-practice-library.ts, web/app/draft-practice-library-panel.tsx, web/app/roster-workshop.tsx, web/app/draft-lab.tsx, 신규 web/app/practice-roster-bundle.ts 필요하면, 신규 web/tests/practice-roster-bundle.test.mjs, docs/CLAUDE_PRACTICE_ROSTER_RESULT_2026-11-19.md. 기존 테스트/패키지/다른파일수정금지. 기존CSS클래스재사용. 구현을우선하고확장설계로과하게키우지말것.

짧은 핵심확인: v1read호환/현재선수bundle왕복/상이한basis·pair·중복선수·손상roster거부/원본불변. 기존 테스트가필요하면관련library/roster단위만. fullnpm/Pages/browser/네트워크/설치/git/하위에이전트금지. 명령권한막히면반복하지말고부모에보고. 실제동작·미완료/미검증을짧게문서화.

한도오류면추가호출/유료/모델우회없이작업파일·세션ID·정확한오류/리셋시각을결과에남기고종료한다. Codex가그시각이후재개예약을관리한다.
