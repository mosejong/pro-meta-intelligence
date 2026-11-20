# 연습 보관함 이름 바꾸기

Claude Opus5.5 medium. 다음 좁은 UX 구현: 기존 저장 연습을 삭제/재생성하지 않고 이름만 변경. 기존 practice IDB 구조/버전/최대5개/모든 schema v1,v2,v3 호환 유지. save/read의 현재/시즌 로스터 bundle 검증 재사용, 손상항목을 정상으로 덮어쓰지 말것.

소유 web/app/draft-practice-library.ts, draft-practice-library-panel.tsx, 신규 web/tests/practice-rename.test.mjs, docs/CLAUDE_PRACTICE_RENAME_RESULT_2026-11-19.md. 기존 테스트/package/다른파일/git/네트워크/설치/fulltest/browser/하위agent 금지.

rename(id,newName) 추가: readwrite 트랜잭션으로 기존 body+entry 검증/중복이름 검증 및 entry.name만 갱신. id/created_at/body/summary/schema/다른항목/현재편집상태 그대로. 이름변경 자체로 overwrite나추가슬롯사용없음. 같은 자신의 이름은 허용하지만 다른항목 이름중복은 기존NFC/case/공백기준으로 거부. 빈/길이/제어문자 검증 기존 함수 재사용. 동시탭 rename/save가 중복이름을 만들지 못해야함. 실패/timeout/abort/삭제된ID시 기존값보존.

UI 각 정상항목 이름바꾸기 버튼과 작은 inline 명시입력/적용/취소, 기본은숨김. Enter적용/Escape취소, 취소는아무것도변경하지 않음. locked/busy/손상엔트리 차단. 팀/밴픽/방상태 변경으로 pending작업무효화, 지연완료가새화면에옛성공메시지표시하지않게 기존generation/gate 재사용. 새이름 UI는 IDB commit후만, 실패시원래이름그대로+기존error문구. 로드/삭제확인과경합하지않음. 새로운 확인모달남발금지. 일반한국어명칭/기존CSS 재사용.

관련단위만시도, 승인단계거부는반복없이보고. 신규단위는 현재/시즌bundle body불변/구버전/중복/자기이름/삭제/손상/동시rename-save를검증. 한도오류시정확한세션/reset기록후종료. 추가과금/모델우회없음. 구현완료/미검증구분.
