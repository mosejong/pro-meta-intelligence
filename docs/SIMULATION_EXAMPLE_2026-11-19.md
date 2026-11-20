# 현재 팀으로 가정 실험 예시 입력 (2026-11-19)

## 무엇
SIMULATION 탭 준비 구역 앞에 기본 접힌 `처음이라면 예시로 체험` 하나. 사용자가 `이 예시로 입력 준비`를 누를 때만, 선택한 실제 두 팀의 빈 첫 세트에 작성자 고정 밴픽 20개와 역할 10개를 한 번 배정한다. 실제 경기·팀 전략·메타 추천·선수 능력이 아니다.

## 작성자 고정 입력 (`web/app/simulation-example.ts`)
- 픽(블루 진영 팀): TOP Gnar / JUNGLE LeeSin / MID Orianna / BOTTOM Jinx / SUPPORT Leona
- 픽(레드 진영 팀): Renekton / Vi / Ahri / Ashe / Nautilus
- 밴: BLUE Akali, Azir, Caitlyn, Draven, Ezreal / RED Gwen, Jax, Kalista, Lucian, Rumble
- 모든 ID는 `SHARE_CHAMPIONS` asset ID로 검증, 20개 중복 없음.
- 20턴은 `draftSequence(firstPickSide)` 순서대로 `applyDraftSelection`으로 만든다(BLUE/RED 선픽 모두). 별도 규칙 구현 없음.
- 역할은 알려준 고정 배정(USER_ASSIGNED 경로)이며 픽 순서·선수 기록에서 추론하지 않는다. 적용 뒤 일반 포지션 UI로 수동 수정 가능.

## 검증
`buildSimulationExample({report, blueTeam, redTeam, firstPickSide, roster, hasHistoricalPlayers})`는 순수 함수다.
- 팀 없음/같은 팀/현재 자료에 없는 팀/잘못된 선픽 진영 거부.
- roster 없음, LiveRoster basis 또는 teamIds가 현재 report·두 팀과 불일치하면 거부.
- 기존 `buildSimulationReadiness`(빈 슬롯·중복·다른 팀 선수·역할 검사)를 그대로 통과해야 ok. 빈 자리는 다른 선수/관측으로 자동 보충하지 않고 확인할 팀 이름만 안내.
- 과거 시즌 선수가 있으면 별도 거부(과거 선수 guard 우회 없음).
- 입력 객체는 변경·동결하지 않으며, readiness에는 복사본을 넘겨 반환 selections/roles와 동결 snapshot이 분리된다. snapshot은 미리보기 검증용이고 부모에 readyInput으로 게시하지 않는다.

## 부모 적용 (`web/app/draft-lab.tsx`)
- 버튼과 handler가 같은 `exampleBlockReason` 사용: 친구방, 준비·복원·자료 로딩(`!canSelect`), 과거 선수, 이전 세트(games>0), 현재 밴픽(selections>0)·올려놓은 챔피언이 있으면 적용 금지와 짧은 사유. 기존 작업 덮어쓰기·자동 reset 없음.
- handler는 현재 부모 값으로 동기 재검증 후에만 적용.
- 일반 첫 선택과 같은 시리즈 고정: `seriesReport`가 없으면 현재 표시 report를 `structuredClone`으로 고정(liveReport로 교체하지 않음). 미리보기와 적용이 같은 `report` 기준.
- `selections`와 `positionState`(현재 positionContext, 역할 새 객체 복사, unassigned 빈값)만 한 번에 설정. 임시 UI(올려놓기, 검사 focus, 자동 선택 기록, 타이머, 검색어)만 정리.
- 로스터·시즌 선수·팀·선픽·이전 세트·보관함·기준 A·기존 실행은 바꾸지 않는다. `readyInput`을 직접 설정하지 않고 기존 readiness 패널이 새 입력을 검사해 게시한다. 모델·추천기·explain은 호출하지 않고 실험은 사용자가 직접 실행한다.

## UI
접힌 details, 양 팀 이름, 역할·챔피언·현재 선수 이름 미리보기, 밴 목록, 안내 문구, 44px 버튼, 키보드 접근, 640px 이하 1열, 넘침 방지(`simulation-example.css`). 새 상단 메뉴 없음.

## 테스트
`web/tests/simulation-example.test.mjs`(실제 공개 feed + 현재 관측 기본 roster): BLUE/RED 선픽 각 20턴 합법·중복 없음·5픽5밴, 10명·10역할 ready, 역할 정확 매핑, 누락/basis 불일치/다른 팀/빈 슬롯/중복/잘못된 선픽/과거 선수 거부, 입력 불변·snapshot 분리, guard 사유, 패널 초기 접힘·버튼 markup. `npm test` 목록 끝에 등록.

## 알려진 한계
- 예시는 하나의 고정 구성뿐이며 현재 패치 챔피언 가용성/밸런스를 반영하지 않는다.
- 현재 관측 roster가 불완전한 팀 조합에서는 사용할 수 없다(자동 보충 안 함).
- 이전 세트가 있는 시리즈(fearless 잠금)에는 적용하지 않는다.
- 부모 handler의 guard/적용 순서는 단위 테스트가 아닌 실제 브라우저 검증에 맡긴다.


## Codex 검증 결과

신규8개·타입·변경lint·Pages5개 및 실제 npm test474/474 통과.
로그 outputs/web-simulation-example-integration-20261119.log.
PC/모바일8개에서 BLUE/RED선픽 각각예시준비→자료고정→10명로스터불변→10역할저장/새로고침
복원→이전세트가드, 올려놓기/확정작업덮어쓰기금지,2015마린배정시가드유지를확인했다.

준비표시만으로실험체험완료라하지않고, 추가PC/모바일2개에서는예시입력의명시실행버튼을눌러
실행#1/모델내부종료결과까지도확인했다. 자동실행은하지않는다. 첫추가검사준비의cwd실수로
이전검사만반복한실행은이새단언의근거로쓰지않고, 파일수정후별도2개통과를확인했다.

캡처 outputs/simulation-example-preview-mobile-20261119.png,
outputs/simulation-example-result-mobile-20261119.png. 실제휴대폰기기검증/재미·효용평가는아니다.
고정예시의승패가실제팀강함을반영하는것도아니다. 제품push/머지/배포없음.
