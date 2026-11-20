# 가정값 링크 — Claude 구현, Codex 독립 검증

검토결과 outputs/claude-next-simulation-slice-review-20261120-result.json(세션86f56225-a73a-4335-bb70-552798b8970a)은 completed/is_error=false. 검토의'재현입력'명칭은채택하지않는다. 이기능은 **가정값만 공유**이며 고정밴픽/로스터/역할/근거/실험원본을보내는기능이아니다. 실험A/B호환성관문완화없음.

Codex가직접확인: experiment-replay.ts coreInputOf는sorted sourceIDs를team_a/team_b에대응시키고 seed와각팀3가정만 simulateManager에전달한다. 따라서같은추상모델숫자결과는재현가능하지만 같은실험근거가복원됐다고말하면안된다. draft-share-panel은#draft=만처리하므로별도#experiment=를사용하면기존v1은그대로둘수있다.

소유: 신규 web/app/experiment-input-link.ts, 신규 web/app/experiment-input-link-panel.tsx, 기존 web/app/experiment-replay-panel.tsx, 신규 web/tests/experiment-input-link.test.mjs, 기존 web/tests/experiment-replay.test.mjs(지원범위SSR안내만), web/package.json(test목록에신규파일추가만), 신규 docs/EXPERIMENT_INPUT_LINK_2026-11-20.md. CSS는기존styles재사용, 어려우면기존experiment-replay-panel.css만최소추가. 다른제품/engine/비교/룸/기존draft링크/저장schema변경금지.

최소읽기: 위관련코드, experiment-result-share-panel.tsx의copy token/rewind가드, draft-share.ts의strict base64url/UTF8/크기/안전origin패턴, 기존experiment-comparison-text.test.mjs 실제신뢰run fixture. 전체기획읽지말것.

1 순수create/parse/gate. 스키마 experiment-assumptions v1/ruleset/patch/정렬된두public source팀ID/seed/팀당lane·tempo·teamfight 숫자만. 배열팀record 형식선호. 정확keys/type/ownfields/팀2개·중복없음/finite범위[-1,1]/seed0..2^32-1/문자열크기/원시bytes/url길이/strict canonical unpadded base64url/fatalUTF8 검증. JSON에추가key나버전/규칙틀림거부. 기존안전HTTPS또는localhostHTTP만create. parse는주소의own #experiment=만. 서명없음·사용자가편집가능한숫자이므로완전성/원본provenance보증이라주장금지. malformed tampering거부이지유효한숫자수정을암호학적으로검출하는것아님.

2 create는이페이지에서만든trusted 완료run만받고현재입력란이아닌run고정값을사용. run복사/구조모방거부. sourceIDs외playerID/roster/selection/role/evidencekey/개별관측/결과/승률/rawJSON은payload없음. 모델/배치재실행없음. 반환roundtrip검사.

3 incomingpreview는링크에서온값임을명시하고명시'가정값 적용'버튼만inputseed/drafts를바꿈. readyInput없음·blocked(룸/restore/loading/과거선수가드) 또는patch/팀pair불일치면적용금지. 팀은side가아닌sourceID대응으로side swap도올바름. unknown팀ID를화면원문출력하지말고팀1/팀2로표현하거나ready될때이름해결. 이준비조건을우회해임의기본선수/역할을채우면안됨. 적용은현재두팀숫자만바꾸며다른팀draft엔트리/현재고정run/기준A/밴픽·로스터·roles·playback·storage를그대로둔다. 자동실행·URL자동적용없음.

4 numerics 중요: 기존parseAssumption은지수표기문자열을거부한다. 원본입력 '.0000001'이나더작은finite숫자는유효한데String(number)는1e-7처럼된다. apply때**손실없는plain decimal 문자열**로바꿔기존parser에검증하며 반올림/clamp로값바꾸지말것. 원본'-0'/'.1000'도정규화가능하나숫자동일성보존. 숫자JSON지수표기는유효숫자로받아도apply문자열은기존parser와호환돼야함. Number.MIN_VALUE 포함테스트.

5 UI는모델설명과구분된기본접힘details에'가정값만 공유'명칭, 완료run의'가정값 링크 복사'. 준비/실행결과없는incoming도미리보기와이유는볼수있어야한다. 문구: '밴픽·선수·역할·분석자료·실험원본은 포함하지 않습니다. 받은쪽에서입력준비후가정값만적용하고직접실행해야합니다.' 기존모델설명도새기능사실과일치하게최소수정. 입력원본영속저장은없다는사실보존. 링크는전체실험재현/근거공유/실전승률아님. 자동복사거부시readonly URL 직접선택. copy는newrun/rewind/unmount/href변경으로stale응답차단. incoming변경시이전preview적용금지. 동작중다른hash(#draft=포함) 삭제/덮어쓰기없음. URL적용후없애기필요없으므로이작업은hash를변경하지않아도된다. 44pxtarget/기존톤/모바일가로넘침없음.

6 tests: 실제buildExperimentRun으로완료create/parse/gate/apply값의strictparser호환+samecore result, side reverse mapping, src뒤input변경에도고정값, 미완료·같은내용untrusted·다른patch/team/규칙·여분keys·팀중복·큰payload·잘못UTF8/base64·비안전createorigin거부, 매우작은finite값plain문자열roundtrip. noJSON/privatefields. SSR초기copy/applydisabled·지원범위문구. 기존draft-share테스트보존. 새파일은.mjs이고package경로슬래시'/'유지. Codex가새PC/모바일순서·명시적용·늦은clipboard race E2E를독립작성한다.

도구Read/Edit/Write/Glob/Grep만. Bash/tests/git/network/subagent없음. 구현·수정은Claude, Codex는검증만. quota시실제오류/reset남기고중단, 다른모델/계정/유료우회금지. 완료보고짧게변경파일/미실행/남은위험.
