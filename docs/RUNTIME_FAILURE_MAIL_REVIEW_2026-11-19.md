# 반복 Run failed 메일 · 원인 및 독립 검토

확인: Gmail의 최근 프로젝트 실패 알림 제목/실행 링크와 GitHub 실제 로그 대조. 메일 발송·삭제·읽음 처리·구독 설정 변경 없음. 원본 메일 헤더/추적 토큰/개인 주소는 이 문서에 저장하지 않는다.

## 원인

1. **반복 주원인: Refresh official schedule.** [실패 run 44356201642](https://github.com/mosejong/pro-meta-intelligence/actions/runs/44356201642)의 보관 HTML은 정상적인 공식 빈 일정 화면이었다. 예정 time 태그 0개, 완료 경기 카드와 React 스트리밍으로 표시되는 `section[data-tag=empty]`가 있었다. 기존 파서는 예정 카드를 찾지 못하면 오류로 처리해 예약마다 exit 4/SOURCE_UNAVAILABLE이 됐다. 마지막 일정 취득 시각이 갱신되지 않아 감시도 약 111시간 오래된 일정이라고 경고했다.
2. **Creator 빈 후보 감시 오판.** [watchdog 44262583725](https://github.com/mosejong/pro-meta-intelligence/actions/runs/44262583725)는 CREATOR_FEED_READY/SCHEDULE_PUBLICATION_FRESHNESS 실패였다. 정상 Radar 106개 항목에 검토 가능 후보가 0개여서 Creator builder가 명시적으로 NO_ELIGIBLE_CANDIDATES를 생성했지만 감시는 비어 있지 않은 후보를 필수로 요구했다.
3. **Hosted collector 한 건:** 앞서 인증 보관소 복원 중 GitHub artifact HTTP 503으로 발생했다. [run 44319466632](https://github.com/mosejong/pro-meta-intelligence/actions/runs/44319466632) 재실행은 성공했다. 이 한 건과 반복 일정 실패는 별개다.

메일 제목은 `Run failed`이며 웹 화면의 JavaScript 런타임 장애를 직접 입증하는 메일이 아니었다. 그렇다고 모든 공개 표면이 정상이라는 뜻도 아니다.

## Claude 구현 / Codex 독립 검토

- 정상 빈 일정은 정확한 렌더링 문구·구조·카드/스트리밍 조건을 확인한 경우에만 빈 events로 수용한다. 오류/번역 사전/숨긴 텍스트/손상 카드/과거 카드만 있는 응답은 계속 거부한다. 기존 함수·snapshot 스키마는 보존하고 adapter에 전체 페이지 해석을 연결했다.
- Codex는 주석/문자열 속 `$RC` 호출과 비실행 script type/src 반례를 재현했다. Claude가 실제 지원하는 inline JavaScript 교체문만 증거로 인정하도록 수정했다. HTML 정적 검사이며 브라우저 JS/CSP 실행을 완전히 재현하는 엔진은 아니다.
- 실제 실패 HTML 3,308,608바이트를 네트워크 없이 재생해 정상 빈 snapshot 0경기임을 확인했다. 실제 TypeScript `isScheduleSnapshot`도 이를 통과했다.
- 기존 fixture 2경기 및 보관된 정상 공식 HTML 38/40경기의 결과가 변경 전 파서와 정확히 같았다. 원본을 새로 요청하지 않았다.
- Creator 빈 결과는 paired Radar의 명시적 boolean false·출처 해시·현재 builder 출력 전체가 일치할 때만 EMPTY_CONFIRMED로 인정한다. 후보 유실/출처 불일치/손상 입력은 계속 실패하고 기존 신선도/안전/짝 검사도 유지했다.
- 독립 알림 수명주기 검사: Creator 오판이 없어져도 일정 만료는 UNHEALTHY로 남는다. 바뀐 실패 집합은 첫 알림 대상이고, 같은 실패 집합은 기존 정책대로 중복 알림을 억제한다. 일정까지 회복돼야 건강으로 전환한다. 알림을 일괄 끄지 않았다.
- 최종 독립 Python **546개**, ruff 검사·포맷 **116개 파일** 통과. Claude 실제 모델 Opus 5.5 medium, 구현 보고와 Codex 재검사는 구분했다.

## 운영 확인 관문

운영 전용 PR 통합 및 다음 공식 일정 갱신/감시 결과 확인이 남는다. 일정 소스는 최소 **6시간 간격**을 지켜야 하므로 마지막 실패 요청 시각(11/19 02:13 KST) 직후 수동 반복 요청하지 않는다. 기존 cron상 다음 일정 갱신은 09:17 KST, 감시는 09:43 KST이나 실제 GitHub 실행은 지연될 수 있다. 10:45 후속 확인에서 새 일정 취득·빈 일정·공개 건강과 이슈 #120 회복 여부를 대조한다. 현재 시점에는 완전 복구/메일 중단을 확정하지 않는다.

증거: `outputs/schedule-diagnostics-44356201642/`, `outputs/watchdog-44262583725/health.json`, `outputs/schedule-parser-compatibility-20261119.json`, `outputs/schedule-empty-offline-snapshot-20261119.json`, `outputs/runtime-mail-final-python-20261119.log`. 메일 알림은 과거 기록이므로 수정 뒤 과거 메일 자체가 사라지지 않는다.
