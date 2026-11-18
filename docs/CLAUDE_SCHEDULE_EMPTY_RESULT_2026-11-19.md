# 반복 일정 실패 메일 · 명시적 빈 일정 수용 결과 (2026-11-19)

담당: Claude (Opus 5.5). 범위: Python 일정 파서만. 커밋/푸시/배포/네트워크 요청 없음.
웹·공용 문서·package·CLI·health 코드는 수정하지 않았다(필요 없었음).

## 원인

run 44356201642의 진단 페이지(`outputs/schedule-diagnostics-44356201642/source-page.html`, 3.3 MB)는
정상적인 시즌 종료 상태였다. 파서가 `<time datetime>` 카드만 일정으로 인식하므로 0건이 되고,
`schedule page contains no semantic upcoming events`로 실패해 매 실행마다 실패 메일이 발송됐다.

실제 구조(로컬 분석):

- React streaming SSR. 본문 `<template id="B:1">` 자리에 `<div hidden id="S:1">`의 내용이
  `<script>$RC("B:1","S:1")</script>`로 교체되어 렌더링된다. 즉 빈 일정 섹션은 원문상 `hidden`
  div 안에 있지만 실제로는 화면에 표시된다.
- S:1 = [B:3 자리(완료 경기 카드) + `<section data-tag="empty">`]. 섹션의 표시 텍스트는 정확히
  `No More Upcoming Matches Available` / `Check back soon to find more matches`.
- S:3 = 완료된 Worlds 경기 카드 40개. `<time>`이 없고 점수 두 칸(`0`/`1` 등)과 VOD 링크가 있다.
- 같은 문구가 `self.__next_f` 번역 사전 스크립트에도 들어 있다(문자열 검색 금지 근거).
- 비교용 8월 정상 페이지 2개(`outputs/lolesports/raw/lol-esports-schedule/*.html`): 예정 카드에도
  같은 `role="separator"`가 있으나 점수 칸이 비어 있다. 카드 라벨 수 = 예정 카드 + 완료 카드.

## 변경 (`src/pro_meta_intelligence/ingestion/lolesports_schedule.py`)

1. `parse_schedule_page(body)` 추가: 정상 카드가 있으면 그대로 반환하고, 명시적 빈 일정이면 `()`를
   반환하며, 그 외에는 기존 메시지로 `SchedulePayloadError`를 낸다.
   `is_explicit_empty_schedule(body)`도 추가했다.
   기존 `parse_schedule_html`의 API·동작(0건이면 예외)은 그대로 두었다.
2. 어댑터는 `parse_schedule_page`를 사용한다. 명시적 빈 일정은 `events=()` snapshot이 된다.
   카드가 있었는데 모두 과거여서 필터된 경우는 기존대로 `no future events` 실패다.
3. 명시적 빈 일정 판정(모두 충족해야 함):
   - `<time>` 태그 0개, 시간 카드 파싱 실패(불완전 카드) 0개.
   - `section[data-tag="empty"]`의 **표시 텍스트**가 정확히 제목, 또는 제목+부제와 일치한다
     (추가 텍스트가 있으면 거부).
   - 해당 섹션과 조상이 숨김 상태가 아니어야 한다. script/style/template/noscript/head,
     `hidden`, `aria-hidden="true"`, `display:none`, `visibility:hidden`, `d_none`/`vis_hidden`/
     `hidden`/`sr-only` 클래스는 모두 증거에서 제외한다.
   - React streaming 경계 `S:n`은 다음 두 조건을 모두 만족할 때만 렌더링된 것으로 본다.
     실제 `<script>`의 마지막 실행문이 `$RC("B:m","S:n")`이어야 한다(주석이나 문자열 리터럴
     안의 호출은 무시). 그리고 placeholder `B:m`이 렌더링된 위치에 있어야 한다(재귀 검사).
   - 모든 `league • block` 카드 라벨이 완료 경기 카드(구분선 부모 안에 숫자 점수 2개)에 대응해야
     한다. 대응되지 않는 라벨은 시간 마크업이 바뀐 예정 카드일 수 있으므로 fail-closed한다.
4. 정상 카드와 빈 마커가 함께 있으면 정상 카드를 우선한다. 단, 불완전 카드가 하나라도 있으면
   `schedule page mixes incomplete event cards with an end-of-feed marker`로 실패한다.
5. 기존 카드 파서에 있던 누수를 고쳤다. 열린 카드 뒤에 오는 다른 카드(시간 없는 완료 카드 등)의
   팀 정보가 앞 카드에 덮어쓰이거나 채워질 수 있었다. 이제 `section[data-tag]`, 리그 라벨 이후의
   팀 행, 또는 같은 슬롯의 반복을 만나면 카드를 닫는다. 실제 8월 정상 페이지 2개(38건, 40건)와
   기존 fixture에서 구 파서와 이벤트가 **완전히 동일함**을 로컬 비교로 확인했다.

스키마는 바꾸지 않았다. 빈 snapshot은 `events: []`, `quality: {event_count: 0, tbd_participant_count: 0}`이며
content_hash와 원본 HTML 아카이브로 출처를 보존한다.

## 계약 확인

- `publishing/health.py::_schedule_publication_check`: `events`가 list이면 통과한다. 빈 snapshot도
  `SCHEDULE_FEED_READY` 통과(테스트로 확인).
- `web/app/radar-types.ts::isScheduleSnapshot`: `events.every(...)`는 빈 배열에서 true이다. 필드를
  Python 테스트에서 미러링해 확인했다(웹 코드는 수정하지 않았고 TS 테스트도 실행하지 않았다).
- CLI `fetch-schedule`: 실제 어댑터에 가짜 transport만 주입해 확인했다. exit 0, `schedule.json`
  events 0건, 원본 HTML 아카이브 1건, change log `changes: []`(다음 경기 추정 없음), 진단 디렉터리
  미생성. 반대로 손상 카드+마커 페이지는 exit 4 `SOURCE_UNAVAILABLE`이며 기존 snapshot을
  바이트 단위로 보존하고 진단 HTML을 저장한다.

## 테스트

- NEW `tests/fixtures/lolesports_schedule_empty.html`: 실제 페이지의 구조를 최소 발췌한 것이다
  (streaming 경계 2개, 완료 카드 2개, empty 섹션, 번역 사전). 원본은 복사하지 않았다.
- NEW `tests/test_schedule_empty_state.py`: 수용 3건과 거부 다수(알 수 없는/오류/로그인 HTML, 번역
  사전만, 정적 텍스트, template/noscript/script 문자열, hidden/aria-hidden/display/visibility/
  클래스, 교체되지 않은 경계, 주석·문자열 안의 `$RC`, 점수 없는 완료 카드, 마커 섹션 추가 텍스트,
  손상 시간 카드+마커, 파싱 불가 time+마커, 시간 없는 예정 카드+마커, 정상+손상+마커, 과거 카드만),
  정상 우선, 기존 정상 일정 보존, CLI 성공/거부, health·웹 계약을 다룬다.
- Codex의 `tests/test_schedule_empty_review.py`(주석·문자열 `$RC` 무시)도 이 구현으로 통과한다.

실행 결과:

```
python -m pytest tests/test_schedule_empty_state.py tests/test_schedule_empty_review.py \
  tests/test_lolesports_schedule.py tests/test_cli.py tests/test_schedule_changes.py \
  tests/test_publication_watchdog.py tests/test_feed_health.py -q   → 139 passed
python -m pytest -q                                                → 535 passed
python -m ruff check / ruff format --check (변경 2개 파일)           → All checks passed
```

실제 진단 페이지에 로컬 적용하면 `is_explicit_empty_schedule == True`, labels 40 = completed 40,
경계 S:1 ← B:1 렌더링이 확인된다.

## 후속 수정 (Codex 독립 검증 2건)

Codex의 `tests/test_schedule_empty_review.py`가 두 경우에서 실패했다. `<script type="application/json">$RC(...)</script>`와
`<script src="/unloaded-runtime.js">$RC(...)</script>`가 hidden 빈 섹션을 렌더링된 것으로 인정되게 만들었다.
브라우저는 이런 inline 본문을 실행하지 않는다.

수정(`_EmptyStateScanner`): `$RC` 교체 증거는 아래 조건을 모두 만족하는 script에서만 수집한다.

- `src` 속성 없음 (외부 src가 있으면 inline 본문은 실행되지 않음)
- `nomodule` 속성 없음. 현대 브라우저는 실행하지 않으므로 보수적으로 비실행 취급한다.
- `type`이 없거나 비어 있거나, classic JavaScript MIME(`text/javascript`, `application/javascript`,
  `application/ecmascript`, `text/ecmascript` 등)일 것. `application/json`, `text/plain`, 알 수 없는 type은
  비실행이다. `module`도 보수적으로 제외한다(React 교체 런타임은 classic script).
- `template`/`noscript`(및 보수적으로 `svg`/`math`/`textarea`/`xmp`) 안의 script는 제외한다.

비실행 script의 본문은 증거 텍스트, 카드 라벨, 점수 집계 어디에도 들어가지 않는다.
Codex 테스트와 독립 테스트 파일은 수정하지 않았다. 내 테스트에는 거부 6건(json/src/nomodule/
module/text/plain/template 안)과 수용 3건(명시적 classic type)을 추가했다.

재실행 결과:

```
python -m pytest tests/test_schedule_empty_state.py tests/test_schedule_empty_review.py \
  tests/test_lolesports_schedule.py tests/test_cli.py tests/test_schedule_changes.py \
  tests/test_publication_watchdog.py tests/test_feed_health.py -q   → 150 passed
python -m ruff check / ruff format (변경 2개 파일)                   → All checks passed / unchanged
```

오프라인 재생(로컬 파일만, 요청 없음) 결과:

- 실제 `source-page.html`: `explicit_empty=True`, labels 40 = completed 40. 여전히 빈 snapshot으로 수용된다.
- 8월 정상 페이지 2개: 구 파서와 이벤트가 동일하다(38건, 40건).

## 남은 한계

- 실제 일정 요청은 하지 않았다(소스 간격 미경과). 다음 정기 실행에서 실제로 성공하는지 확인해야 한다.
- 문구는 en-US 고정이다. 다른 locale은 빈 일정이어도 fail-closed된다(기존과 같은 실패).
- 완료 카드 판별은 "구분선 부모 안에 숫자 점수 2개"라는 현재 마크업에 의존한다. 소스가 점수
  마크업을 바꾸면 빈 일정도 다시 실패한다(안전한 방향).
- `opacity:0` 래퍼는 숨김으로 보지 않는다. 실제 페이지가 SSR 페이드인용으로 빈 섹션을
  `style="opacity:0"`로 감싸기 때문이다. CSS 클래스로 숨긴 경우(임의 클래스명)는 HTML만으로
  판별할 수 없다.
- `$RC` 실행 여부는 JS 파서 없이 휴리스틱으로 판정한다(마지막 실행문, 같은 줄 `//` 없음, 닫히지
  않은 `/*` 없음), 그리고 classic inline script(위 조건)에서만 인정한다. CSP 차단이나 JS
  비활성 환경은 HTML만으로 알 수 없다. React의 `$RX`(클라이언트 렌더 폴백/오류)는 렌더링으로 인정하지 않는다.
- 빈 snapshot에는 "명시적 빈 상태"라는 별도 필드가 없다(스키마 유지). 이전 snapshot에 미래 T1
  경기가 있었다면 change log에는 `EVENT_REMOVED`(REVIEW)가 기록된다. 의도된 기존 동작이다.
- 메일·구독 설정은 변경하지 않았다.
