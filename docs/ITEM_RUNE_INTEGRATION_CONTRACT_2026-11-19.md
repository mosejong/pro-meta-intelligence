# 룬·아이템 연결 계약 보완 · 2026-11-19

## 공식 문서 재확인

Riot LoL 문서 https://developer.riotgames.com/docs/lol#items 를 11/19 조회했다. Data Dragon은 패치·언어별 정적 설명/구매·판매가격/조합/능력치를 제공하며 업데이트 지연 및 지역 클라이언트 버전 차이가 있을 수 있다. 정적 데이터는 선수 구매순서나 구도별 최적 빌드의 관측이 아니다. rune 관련 정적자산의 존재 안내는 확인했지만 이번 조회 본문에는 runesReforged의 정확한 endpoint계약을 확인하지 못했으므로 검증 완료로 쓰지 않는다. 원본 카탈로그는 새로 받지 않았다.

현 registry는 FETCH_VERSION_INDEX/FETCH_CHAMPION_CATALOG만 허용한다. 아이템/룬 수집 및 Riot Web API를 활성화하지 않았다. docs/ITEM_RUNE_NEXT_STEP_2026-11-18.md의 출처경계를 유지한다.

## 다음 연결용 계약 (설계, 구현 API 아님)

- StaticCatalogRef: source_id/version/locale/content_hash/retrieved_at/patch_id. ID는 문자열 원본으로 유지하고 외부 HTML 설명을 렌더링하기 전 정제한다. 패치/언어 불일치·삭제된 ID는 대체버전 몰래사용 없이 미지원.
- ObservedBuild: match/player/role/champion/opponent/patch 및 검증된 source refs. 시간별 purchase/sell/undo와 최종 inventory를 분리한다. 없는 timeline은 MISSING이며 최종6슬롯으로 구매순서를 역산하지 않는다.
- UserBuildPlan: 관측과 다른 명시 가정. 선택계획을 프로선수 추천/통계로 저장하지 않는다. 현재 모델에서 item/rune 효과는 NOT_MODELED.
- 화면연결: 선택챔피언 상세탭에서 정적정보와 관측표본을 구분, 없는관측은 안내. 기본 밴픽 화면에 수집설정/긴문서 노출 안함. 정적카드가 준비돼도 최적코어 추천으로 부르지 않는다.

## 출시 연결 관문

Riot 일반정책 https://developer.riotgames.com/policies/general (조회11/19, 표기갱신May29,2025)은 제품등록/변경검토와 수익화 승인상태를 규정한다. IP사용 게임에 대한 제한도 있어 매니저 확장을 이름만 simulator로 바꿔 승인된 것으로 취급하지 않는다. 이 문서는 법률판정이나 승인여부 인증이 아니다. 현재 외부제품등록 상태는 미확인이고 로컬분석/수용감사 작업은 계속한다. 실제 공개/광고/게임성 확대 전에 제품범위를 제출·확인할 준비항목으로 남긴다. 정책등록일/허용범위를 자동변경하지 않는다.
