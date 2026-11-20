# 가정값만 공유 링크 (2026-11-20)

과제: `docs/CLAUDE_EXPERIMENT_INPUT_LINK_TASK_2026-11-20.md`. 구현 Claude, 검증 Codex. 이 문서 작성 시점에 명령·테스트·lint·typecheck는 실행하지 않았다.

## 범위

- **가정값만 공유**한다. 고정 밴픽·로스터·역할·선수·분석자료·관측값·결과·승률·실행 원본은 보내지 않는다.
- 같은 추상 모델 숫자 결과는 받은 쪽이 같은 두 팀·패치 입력을 준비하고 직접 실행하면 재현된다(코어 입력은 seed + 정렬된 두 팀의 3가정뿐). 그러나 **같은 실험 근거가 복원됐다는 뜻이 아니다.** 전체 실험 재현·근거 공유·실전 승률이 아니다.
- 서명 없음. 숫자는 사용자가 고칠 수 있어 완전성/원본 provenance를 보증하지 않는다. 형식이 깨진·변조된 구조는 거부하지만 유효한 숫자의 수정은 검출하지 않는다.
- 실험 A/B 호환성 관문, 기존 `#draft=` v1 링크, 저장 schema, 엔진, 비교, 룸은 변경하지 않았다.

## 형식

주소 fragment `#experiment=<canonical unpadded base64url(UTF-8 JSON)>`.

```json
{"schema":"experiment-assumptions","version":1,"ruleset":"assumption-manager-v1","patch":"…","seed":7,
 "teams":[{"id":"<정렬상 앞 source team ID>","lane":0.5,"tempo":-0.2,"teamfight":1},{"id":"<뒤>","lane":-1,"tempo":0,"teamfight":0.3}]}
```

검증(`web/app/experiment-input-link.ts` `validateLinkData` / `parseExperimentInputLink`):
정확한 own key(여분·누락·`__proto__` 거부), schema/version/ruleset 일치, patch 1..64자, seed 정수 0..2^32-1, 팀 배열 정확히 2개·코드유닛 정렬·중복 없음, ID 1..128자·앞뒤 공백 없음, 가정값 finite number [-1,1](-0→0), 주소 ≤4000자, 원시 bytes ≤1500, base64url 재인코딩이 원문과 같아야 함(패딩·비정규 꼬리 bit 거부), fatal UTF-8, JSON.parse. 주소 자신의 `#experiment=`만 읽고 다른 hash(`#draft=` 포함)는 `NO_LINK`.

## 생성 (`createExperimentInputLink(href, run, shownMinute)`)

- `isTrustedRun`(이 페이지 `buildExperimentRun`/`cloneTrustedRun`)이고 결과까지 표시된 run만. 구조 복제·JSON 복사·모방 객체 거부.
- 값은 run의 고정 `teams[core].sourceId/assumptions`, `seed`, `snapshot.patch`에서만. 현재 입력란은 읽지 않는다. 모델·배치 재실행 없음.
- HTTPS 또는 localhost/127.0.0.1/[::1] HTTP에서만. search 제거, 생성 URL의 hash만 설정(페이지 주소는 건드리지 않음). 생성 후 parse 왕복이 같아야 반환.

## 적용 (`planExperimentLinkApply(link, readyInput, blocked)`)

- blocked(룸/복원/로딩; 과거 선수 가드 등은 부모가 `readyInput=null`로 전달) → 거부, readyInput 없음 → 거부(임의 선수/역할 채움 없음), 패치 불일치·팀 쌍 불일치 → 거부.
- 팀은 side가 아닌 source ID로 대응 → side swap도 올바름.
- 숫자 → **손실 없는 plain decimal** 문자열(`plainDecimal`: `String(x)`의 지수 표기를 자릿수 그대로 전개, 반올림/clamp 없음, -0→"0"). 기존 `parseAssumption`/`parseSeed`로 다시 검증해 같은 숫자여야 함. `Number.MIN_VALUE` → `0.` + 323개 0 + `5`.
- 패널에서 적용은 두 팀 가정값 텍스트와 시드 텍스트만 바꾼다. 다른 팀 draft 엔트리, 현재 고정 run, 기준 A, 밴픽·로스터·역할·재생·저장은 그대로. 자동 실행·URL 자동 적용 없음.

## UI (`web/app/experiment-input-link-panel.tsx`)

- 모델 설명 아래 별도 기본 접힘 `<details>` "가정값만 공유". 범위 문구: "밴픽·선수·역할·분석자료·실험원본은 포함하지 않습니다. 받은 쪽에서 입력 준비 후 가정값만 적용하고 직접 실행해야 합니다." + 서명 없음/증명 아님/재현·근거·승률 아님.
- "가정값 링크 복사": 결과까지 본 run에서만 활성. 자동 복사 실패/불가 시 readonly 주소 직접 선택. 새 run·되감기·unmount·주소 변경 시 늦은 clipboard 응답 무시(token + 시작 href 비교).
- 받은 링크 미리보기: "링크에서 받은 가정값 (현재 입력이 아님)". 입력 준비 전·실행 결과 없음에도 표시되고 거부 이유를 보여 준다. 현재 입력에 없는 팀 ID는 원문 대신 "팀 1/팀 2", 준비되면 팀 이름. 패치는 원문 대신 일치/불일치만.
- "가정값 적용": 클릭 시 주소를 다시 parse해 미리보기와 같은 링크일 때만 적용(이전 미리보기 적용 금지). hash는 읽기만 하며 변경·삭제하지 않는다.
- 기존 모델 설명을 "저장되지 않아 … 요약 글과 가정값·시드만 담은 링크를 복사할 수 있습니다. 실행 원본·밴픽·선수·역할·분석자료는 링크에 들어가지 않습니다."로 최소 수정. 입력 원본 영속 저장 없음 유지.
- CSS: `experiment-replay-panel.css`에 `.experiment-input-link*` 몇 줄(44px target, overflow-wrap). 복사 영역은 기존 `.experiment-result-share` 재사용.

## 테스트

- 신규 `web/tests/experiment-input-link.test.mjs` (package.json test 목록에 추가): 실제 `buildExperimentRun` 완료 run으로 create/parse 왕복, payload key·비공개 필드 부재, 미완료/untrusted(같은 내용 복제)/비안전 origin 거부, 실행 뒤 입력 변경에도 고정값, apply 텍스트의 strict parser 호환 + 같은 core input/result, side swap 대응, gate(not ready/blocked/patch/team pair), 여분 key·버전·규칙·팀 중복/정렬/개수·값 범위·타입, base64 패딩/비정규/UTF-8/크기/주소 길이, `#draft=`·다른 hash 무시, `plainDecimal`(Number.MIN_VALUE 포함) 및 JSON 지수표기/-0/0.1000, 기존 draft parser가 `#experiment=`를 받지 않음, SSR 초기 copy/apply disabled·범위 문구·기본 접힘.
- `web/tests/experiment-replay.test.mjs`: 모델 설명 문구 갱신에 맞춘 SSR 안내 assertion만 수정.

## 미실행 / 남은 위험

- 테스트·typecheck·lint·build 모두 미실행(지시상 명령 금지). Codex 검증 필요.
- 클라이언트 동작(hashchange 미리보기 갱신, 명시 적용, 늦은 clipboard race, 모바일 가로 넘침)은 SSR 단위테스트로 덮지 못함 → Codex E2E.
- `history.pushState/replaceState`는 이벤트가 없어 미리보기가 즉시 갱신되지 않을 수 있으나, 적용 시 주소를 다시 읽어 다른 링크면 적용하지 않는다.
- 생성 링크는 현재 페이지 hash(`#draft=` 등)를 대체한 새 주소 문자열이다(페이지 주소 자체는 불변).

## Codex 독립 검증 완료 — 2026-11-20

Claude 원구현 session9606c151-5781-4fc4-9f2d-1a6b0b140ec0 completed/is_error=false.
Codex는제품소스를수정하지않고 독립 tests/e2e/experiment-input-link-review.spec.mjs를추가했다.
최초lint에서테스트의긴소수literal 정밀도경고1개가나왔고, 같은Claude세션이 Number(문자열)표현으로
고쳤다. lint비활성화/프로덕션동작변경은없고극소수roundtrip검사는유지했다.

- 관련26개·TypeScript·변경파일/E2E lint 통과.
- Pages build 및계약5개통과. 기존500kB청크권고는남는다.
- 실제Chrome desktop2/mobile-width2 총4개통과. 새독립브라우저에서받은링크를미리보기하되
  입력준비전적용차단, 준비후명시적용, 직접실행전결과없음, 실행후같은추상모델최종값을확인했다.
- source의현재입력란을바꿔도완료run에서만든링크불변, 수신자적용이기존run/A/로스터/현재주소를
  바꾸지않음, MIN_VALUE를plain decimal로손실없이적용, 되감기/주소변경후늦은clipboard응답무효확인.
- 모바일일반입력화면캡처를위해첫시나리오만추가1회통과. 새기능검사5종이라는뜻이아니다.
- 실제 npm test **495/495 통과**, outputs/web-experiment-input-link-integration-20261120.log (76.57초).
  기존방재시작파일도이번에는통과했다. 과거단발실패원인을이번작업이고쳤다고주장하지않는다.
- 정상모바일캡처 outputs/assumption-input-link-normal-mobile-20261120.png, 극소수stress캡처
  outputs/assumption-input-link-received-mobile-20261120.png를구분해확인했다. 실제휴대폰검증은아니다.

주소가history.pushState/replaceState로바뀌면미리보기가즉시갱신되지않을수있는기존보고한계는남는다.
클릭시실제주소재검증과비동기복사완료시실제주소비교를읽어확인했고, 이벤트없는주소변경실기기
시나리오까지전부검증했다고주장하지않는다. side swap은순수실제run검사에서sourceID대응을확인했고
브라우저왕복은같은진영으로수행했다.
이기능은숫자가정전달이지고정근거·로스터·선수·실험원본의재현이나실전승률이아니다.
새source/API/키/서버/영속저장/제품push/merge/deploy 없음.
