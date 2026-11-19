# 자동 선택 복기 TXT 저장 (2026-11-20, Claude 구현 / Codex 독립 검증 완료)

과제: docs/CLAUDE_SOLO_HISTORY_DOWNLOAD_TASK_2026-11-20.md

## 무엇
자동 선택 복기 패널에 명시 버튼 '자동 선택 복기 저장'. 패널이 이미 memo한 `buildSoloHistoryText` 결과(`share.text`, 복사와 같은 글)를
`draft-choice-review.txt`(`text/plain;charset=utf-8`)로 브라우저에 저장 요청한다. 설명 재계산·다른 내용 생성 없음.
앱 저장소·시나리오 스키마·방·링크 변화 없음. 새로고침 후 복기 복원은 여전히 미지원(이전 영속 제안은 미구현).

## 파일
- `web/app/solo-draft-history-panel.tsx`
  - export `requestSoloHistoryDownload(text, env?)` → `REQUESTED | UNAVAILABLE | FAILED`. 주입 가능한 doc/urls/makeBlob/schedule(테스트용).
  - document/body/Blob/createObjectURL/revokeObjectURL/anchor.download 기능 확인 → 없으면 UNAVAILABLE. 빈 글도 UNAVAILABLE.
  - Blob URL → 숨김 anchor append → click → 항상 remove. 성공 시 1초 뒤 revoke, click/생성 실패 시 즉시 revoke 후 FAILED. 예외를 밖으로 던지지 않음.
  - 버튼은 `share.ok`일 때만 활성. 거부 시 복사 버튼과 같은 사유 hint(`aria-describedby`) 공유, 부분 파일 없음.
  - 상태는 별도 `role="status"`. 문구는 '브라우저에 … 저장을 요청했어요. 실제 저장 여부와 위치는 브라우저에서 확인하세요.'(OS 저장 성공 주장 없음).
  - 상태는 history/nameOf/patchId/cutoff가 정확히 같을 때만 표시 → 하나라도 바뀌면 사라짐. 복사 상태·copyToken·늦은 완료 가드·수동 복사 textarea는 손대지 않음.
  - mount/update/reload 시 자동 다운로드 없음(클릭 핸들러에서만 호출).
- `web/app/solo-draft-history.ts`, `web/app/solo-draft-history-text.ts`: 주석만. '명시적 사람이 읽는 내보내기(복사/.txt) 허용, 앱 저장·복원·링크·방 없음'으로 좁게 수정.
- `web/tests/solo-draft-history-text.test.mjs` (기존): SSR 버튼 2개·초기 상태 문구 없음·빈 기록 ""·basis 거부/MIXED_CONTEXT 시 저장 버튼 비활성과 hint 연결,
  가짜 환경으로 내용=복사 글·파일명·MIME·anchor 제거·지연 revoke, 기능 없음/생성 실패/클릭 실패 처리, 주석 사실성·패널에 storage/URL 접근 없음.
- CSS 변경 없음: 기존 `.solo-history-share button` 규칙이 44px를 이미 적용. 두 버튼은 inline이라 좁은 폭에서 줄바꿈.
- package.json 변경 없음(기존 테스트 파일).

## 미실행
명령/테스트/typecheck/lint/브라우저 미실행(과제 규칙).

## 리스크 / Codex 확인 필요
- 실제 다운로드 파일 내용과 수동 복사 textarea 글 일치, 되돌리기 후 이전 차례가 파일에 없는지는 브라우저 E2E 필요.
- 일부 모바일 브라우저(특히 iOS Safari)는 `download` 속성을 무시하고 새 탭에서 열 수 있음 → REQUESTED로 표시되며 문구가 저장 완료를 주장하지 않음.
- BOM 없음(복사 글과 바이트 동일 유지). 아주 오래된 Windows 메모장에서는 한글이 깨질 수 있음.
- 거부 사유 문구는 기존 '…복사하지 않아요'를 공유(테스트 고정 문구라 변경하지 않음).
- 버튼 줄바꿈 시 세로 간격이 없음(기능 영향 없음, CSS는 44px 목적일 때만 소유).

## Codex 독립 검증
관련15/15·typecheck·변경lint·Pages 빌드 통과. 기존 SSR 한 버튼 기대값 실패는 동일 Claude가 두 명시 동작으로 수정했고 관련 검사를 다시 통과했다.
독립 다운로드 검사4개와 기존 클립보드 검사4개를 PC/모바일에서 실행해 8/8 통과(54.7초).
실제 내려받은 UTF8 파일이 수동 복사 글과 정확히 같고, 되돌린 차례는 다음 파일에 없음을 확인했다.
다운로드 실패 후에도 밴픽과 복사가 유지되며, 주소·localStorage 불변, 44px·모바일 가로 넘침 없음을 확인했다.
늦은 클립보드 완료의 무효화도 기존 검사로 재확인했다. 모바일 캡처 육안 검토 완료.
실제 휴대폰/iOS Safari 저장은 미확인. 전체웹526은 직전 체크포인트이며 이번에는 범위 검사만 했다.
제품 원격 게시·배포·새 자료 수집 없음. 앱 내부 복기 저장/복원 기능은 여전히 미지원.

Pages 계약 검사5/5 통과.
