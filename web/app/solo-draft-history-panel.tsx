import { SoloAutoSummary, SoloDraftExplanationBody } from "./solo-draft-explanation";
import type { SoloAutoHistory } from "./solo-draft-history";
import "./solo-draft-explanation.css";

/** Collapsed, read-only review of every real auto-confirmed opponent turn still on the current board. */
export function SoloDraftHistoryPanel({ history, nameOf }: { history: SoloAutoHistory; nameOf: (id: string) => string }) {
  if (!history.length) return null;
  const ordered = [...history].sort((a, b) => a.turn - b.turn);
  return <details className="solo-history">
    <summary>{`이번 세트 자동 선택 복기 (${ordered.length})`}</summary>
    <p>상대가 자동으로 확정한 차례만 표시합니다. 각 설명은 확정 직전에 만든 기록이며 이후 자료로 다시 계산하지 않습니다.</p>
    <ol>{ordered.map(record => <li key={record.turn}>
      <details>
        <summary>{`${record.turn}번째 차례 · ${nameOf(record.champion_id)}`}</summary>
        <p><SoloAutoSummary record={record} /></p>
        {record.explanation ? <SoloDraftExplanationBody explanation={record.explanation} nameOf={nameOf} /> : <p>이 차례에는 상세 설명 기록이 없습니다.</p>}
      </details>
    </li>)}</ol>
  </details>;
}
