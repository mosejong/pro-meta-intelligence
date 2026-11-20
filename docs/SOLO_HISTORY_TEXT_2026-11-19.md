# 자동 선택 복기 일반 글 복사 (2026-11-19)

## 구현
- `web/app/solo-draft-history-text.ts`: 순수 `buildSoloHistoryText({history, patchId, cutoff, nameOf})` → `{ok:true,text}` | `{ok:false,reason}`.
  - 머리말: 자동 확정 개수, 기준 패치·자료 기준 시각, "일반 연습 도구의 규칙 복기이며 실제 팀의 선택이나 승률 예측이 아닙니다."
  - 차례순: `N번째 차례 · 진영 밴/픽 · 챔피언`, 근거, (픽) 추론 포지션(사용자 배정 아님), 포지션 근거 부족, 다른 후보 최대 2개.
  - 시즌 근거는 "현재 패치의 강함 아님", FALLBACK은 "사용할 기록 없음 · 고정 규칙"으로 따로 표기.
  - 설명 null: 챔피언과 "상세 설명 기록 없음"만. `record.reason`, context, prefix, 선수 ID, JSON은 출력하지 않음.
  - 이름/팀명: 제어·서식(bidi/zero-width 포함)·줄바꿈 제거, 40자 제한. 전체 8000자 초과 시 거부.
  - 거부(부분 복사 없음): EMPTY, INVALID_BASIS, INVALID_HISTORY(20개 초과, turn 비정수/범위밖/중복, prefix 길이≠turn-1, 빈 context), MIXED_CONTEXT, INCONSISTENT_ORDER(앞 기록 챔피언/prefix가 뒤 prefix와 불일치), EXPLANATION_MISMATCH(turn/champion), UNKNOWN_EVIDENCE(evidence/kind/side/scope/role enum), INVALID_NAME(nameOf throw·비문자열·빈 이름), TOO_LONG.
- `web/app/solo-draft-history-panel.tsx`: 기본 접힌 details 유지, `자동 선택 복기 복사` 버튼. copy token + useLayoutEffect cleanup + 입력 일치 가드로 늦은 promise가 옛 상태/textarea를 표시하지 않음. clipboard 미지원/거부 시 readonly textarea(포커스 시 전체 선택, 한국어 aria-label). 자동 클립보드 삭제 없음. 비어 있으면 패널·공유 없음.
- `draft-lab.tsx`: 호출부에 `patchId={report.patch_id}`, `cutoff={report.cutoff ?? ""}` 전달만.
- 주석: history/explanation 'never shared' → '명시적 글 복사만 허용, 영속/방/링크 없음'.

## 검증 / 한계
- Claude는 검사를 실행하지 않았다. Codex가 관련12개, 타입검사, 변경lint, Pages계약5개를 확인했다. 전체웹436개도 통과했다.
- 기존 SSR·브라우저의 버튼 없음 검사를 명시적 글복사 버튼1개 허용으로 갱신했다. 밴픽을 수정하는 입력·링크는 없다.
- 패널 자체 렌더(요약 줄)는 기존처럼 `nameOf`를 직접 호출하므로, nameOf가 throw하면 글 복사는 거부되지만 기존 화면 렌더 동작은 그대로임.


Codex가 readBasis의 trim 때문에 줄바꿈이 포함된 기준값도 허용되는 실패를 확인했다.
원문 공백/제어문자를 거부하고 패치 형식·timezone 포함 ISO 시각·파싱 가능 여부를 검사한다.
주입 테스트의 실제 bidi 문자와 제어문자 정규식은 lint에 맞춰 escape/코드포인트 검사로 바꿨다.

실제 Chrome: 데스크톱 기존복기2개+신규복사2개=4개 통과. 모바일 폭 신규2개 통과.
모바일 캡처를 보고 버튼44px·수동복사 영역 간격/가독성을 보완한 뒤 같은2개를 다시 통과했다.
가로넘침 없음도 확인했다. 실제 iOS/Android 기기 검증은 아니다.
캡처: outputs/solo-history-readable-copy-mobile-20261119.png.

전체 첫 sandbox 실행은 junction EPERM과 로컬 HTTP EACCES 두 환경 실패였다.
테스트를 느슨하게 바꾸지 않고 일반 권한에서 다시 실행해436/436 통과했다.
로그: outputs/web-history-copy-integration-allowed-20261119.log.
제품브랜치 push/배포 없음. 기록 영속저장/공유링크/친구방에는 연결하지 않았다.
