import { useState, useSyncExternalStore } from "react";

/** Short first-visit guide on the team setup step. Dismissal is a per-browser convenience only. */
export const FIRST_VISIT_GUIDE_KEY = "pmi.firstVisitGuide.dismissed";

function readDismissed(): boolean {
  try { return globalThis.localStorage?.getItem(FIRST_VISIT_GUIDE_KEY) === "1"; } catch { return false; }
}

const noSubscribe = () => () => {};

export function FirstVisitGuide() {
  // The server snapshot counts as dismissed, so SSR renders nothing and hydration matches.
  const stored = useSyncExternalStore(noSubscribe, readDismissed, () => true);
  const [closed, setClosed] = useState(false);
  if (stored || closed) return null;
  const close = () => {
    try { globalThis.localStorage?.setItem(FIRST_VISIT_GUIDE_KEY, "1"); } catch { /* storage blocked: hide for this visit */ }
    setClosed(true);
  };
  return <aside className="first-visit-guide" lang="ko" aria-labelledby="first-visit-guide-title">
    <h3 id="first-visit-guide-title">처음이세요? 이렇게 하면 됩니다</h3>
    <ol>
      <li><b>두 팀</b>을 고르세요. 실제 프로 팀의 공개 기록을 씁니다.</li>
      <li>진행 방식에서 <b>내 팀</b>을 고르면 상대 차례는 자동으로 진행돼요.</li>
      <li>챔피언을 누르고 <b>확정</b> 버튼을 누르세요. 끝나면 결과와 선택 근거가 나와요.</li>
    </ol>
    <button type="button" onClick={close}>알겠어요</button>
  </aside>;
}
