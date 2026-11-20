# 자동 선택 복기를 일반 글로 복사

Opus5.5 medium. 이번은 사용자 기능 한 조각. 읽기: web/app/solo-draft-history.ts, solo-draft-history-panel.tsx, solo-draft-explanation.tsx, solo-draft.ts의 explanation타입, draft-series-recap-panel.tsx의 clipboard패턴, tests/solo-draft-history.test.mjs. 전역문서/대화/다른코드 폭넓게 읽지 않는다.

소유: 신규 web/app/solo-draft-history-text.ts, 신규 web/tests/solo-draft-history-text.test.mjs, 기존 web/app/solo-draft-history-panel.tsx. draft-lab.tsx는 호출부에 patchId/cutoff 두 prop 전달하는 한 줄만 변경 허용. web/package.json test에 신규 파일 등록만 허용. solo-draft-history.ts 및 explanation.tsx는 'never shared' 주석을 '명시적 글복사만 허용, 영속/방/링크 없음'으로 수정만 허용. 신규 docs/SOLO_HISTORY_TEXT_2026-11-19.md. 다른파일수정 금지.

목적: 현재 화면에 남은 실제 상대 자동 확정 이력을 친구에게 읽기 쉬운 한국어 일반 글로 보낼 수 있게 한다. 현재 세트 frozen/pruned history를 받는다. 재추천/재계산/explain/simulate/모델 호출 절대없음. 저장형식/URL/룸/서버 변경없음. JSON버튼 대신 '자동 선택 복기 복사', clipboard 거부/미지원시 readonly textarea수동복사. 기본 details접기 유지. 비어있으면 패널과공유없음.

순수 buildSoloHistoryText({history,patchId,cutoff,nameOf}) returns {ok:true,text}|{ok:false,reason}. 현재기준patch/cutoff표시, 차례순 밴/픽·진영·챔피언·기록근거·대안최대2 표시. 시즌근거는 현재강함아님, inferred_roles는 추론이며 사용자배정아님, fallback은 기록없음 고정규칙으로 분리. 설명null일땐 선택된챔피언과 '상세 설명 기록 없음'만 표시하고 이유를 추정하지 않는다. 일반 도구복기이며 실제팀선택/승률예측아님 한줄. 원시context/prefix/선수ID/JSON 내보내지 않는다. 이름/팀명은 control/newline/bidi 제거하고 제한길이; 출력상한. 원시record.reason의 임의문구는 복사하지 않는다. input불변.

방어: history최대20, 각turn1~20정수/유일, prefix.length=turn-1, 모든record.context동일/비어있지않음, 같은순서앞record champion이뒤prefix해당위치와일치, 설명이있으면 turn/champion이record와일치, evidenceenum/kind/side검증. 서로다른context/중복turn/설명불일치/알수없는근거는 부분복사말고 전체refuse. nameOf오류/잘못된이름으로 throw하면 UI를깨지말고refuse. patch/cutoff비어있거나invalid면refuse. 매개변수type유효성을적당히방어하고미지원상태명확히표시.

UI는copy token/latest context/useLayoutEffect cleanup으로 history/nameOf/patch/cutoff변경이나unmount뒤늦은promise가성공상태/옛textarea표시하지않게. 동기렌더에도입력일치가드. clipboard에 이미보낸글을나중에취소할수있다고주장하지않고자동클립보드삭제없음. manual fallback은 Selectable+readonly+한국어aria-label. copy상태긴설명없이동일디자인재사용.

단위는일반구조실제record fixture/다른순서동일/내용불변/null설명/대안/시즌/메타/fallback/불일치전체거부/여러context/빈배열/텍스트inject제거/nameOfthrow를검사. 코드문자열검사 금지. SSR로버튼렌더유무 확인할수있음. Bash/tests/git/network/subagents금지, Codex가검사. 한도오류시실제reset기록·중단; 모델/유료우회금지. 응답은구현파일/미실행만짧게.
