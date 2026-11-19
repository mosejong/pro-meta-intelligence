"use client";

import { useId, useMemo } from "react";
import { CORE_TEAM_IDS, type ExperimentRun } from "./experiment-replay";
import { resourceChartGeometry, resourceHistory } from "./experiment-resource-history";

type ExperimentResourceHistoryPanelProps = {
  /** Run made on this page by an explicit click. Only its fixed record is read. */
  run: ExperimentRun;
  /** Minute currently shown by the replay. Nothing after it is drawn. */
  shownMinute: number;
};

const ko = (value: number) => value.toLocaleString("ko-KR");
// Line style per core team so the chart never depends on colour alone.
const DASH: Record<(typeof CORE_TEAM_IDS)[number], string | undefined> = { team_a: undefined, team_b: "6 4" };
const STYLE_TEXT: Record<(typeof CORE_TEAM_IDS)[number], string> = { team_a: "실선", team_b: "점선" };

/**
 * Collapsed, display-only chart of the two teams' model resources from minute 0 to the shown minute.
 * Reads replay frames of the fixed run; no timer, no model run, no storage.
 */
export function ExperimentResourceHistoryPanel({ run, shownMinute }: ExperimentResourceHistoryPanelProps) {
  const baseId = useId();
  const history = useMemo(() => resourceHistory(run, shownMinute), [run, shownMinute]);
  if (!history) return null;
  const geo = resourceChartGeometry(history);
  const titleId = `${baseId}-resource-title`;
  const descId = `${baseId}-resource-desc`;
  const last = history.points[history.points.length - 1];
  const nowText = CORE_TEAM_IDS.map((core) => `${history.teams[core].label} ${ko(last.gold[core])}`).join(", ");

  return <details className="experiment-resource-history" data-shown-minute={history.shownMinute}>
    <summary>지금까지의 모델 자원 흐름</summary>
    <p className="experiment-resource-history-note">실제 골드가 아닌 모델 자원이며, 현재 재생 시각({history.shownMinute}분)까지의 고정 기록입니다. 모델을 다시 계산하지 않습니다(재실행 없음). 이미 만든 실행의 재생 기록만 읽습니다.</p>
    <ul className="experiment-resource-history-legend" aria-label="선 구분">{CORE_TEAM_IDS.map((core) =>
      <li key={core} data-core={core}>
        <svg width="28" height="10" aria-hidden="true" focusable="false"><line x1="1" y1="5" x2="27" y2="5" className={`line ${core}`} strokeDasharray={DASH[core]} /></svg>
        {history.teams[core].label} <small>({STYLE_TEXT[core]})</small>
      </li>)}
    </ul>
    <svg className="experiment-resource-history-chart" role="img" aria-labelledby={`${titleId} ${descId}`}
      viewBox={`0 0 ${geo.width} ${geo.height}`} preserveAspectRatio="xMidYMid meet">
      <title id={titleId}>모델 자원 흐름 (실제 골드 아님)</title>
      <desc id={descId}>0분부터 {history.shownMinute}분까지 두 팀의 모델 자원입니다. 현재 {nowText}.</desc>
      <line className="axis" x1={geo.plot.left} y1={geo.plot.bottom} x2={geo.plot.right} y2={geo.plot.bottom} />
      <line className="axis" x1={geo.plot.left} y1={geo.plot.top} x2={geo.plot.left} y2={geo.plot.bottom} />
      {geo.xTicks.map((tick) => <text key={`x${tick.minute}`} className="tick" x={tick.x} y={geo.plot.bottom + 16}
        textAnchor={tick.x === geo.plot.left ? "start" : "end"}>{tick.minute}분</text>)}
      {geo.yTicks.map((tick) => <text key={`y${tick.value}`} className="tick" x={geo.plot.left - 4} y={tick.y + 4} textAnchor="end">{ko(tick.value)}</text>)}
      {CORE_TEAM_IDS.map((core) => <g key={core} data-core={core}>
        <polyline className={`line ${core}`} points={geo.lines[core]} fill="none" strokeDasharray={DASH[core]} />
        {core === "team_a"
          ? <circle className={`dot ${core}`} cx={geo.current[core].x} cy={geo.current[core].y} r={3} />
          : <rect className={`dot ${core}`} x={geo.current[core].x - 3} y={geo.current[core].y - 3} width={6} height={6} />}
      </g>)}
    </svg>
    <details className="experiment-resource-history-values">
      <summary>분별 값 보기</summary>
      <div className="experiment-resource-history-scroll">
        <table>
          <caption>0분~{history.shownMinute}분 모델 자원 (실제 골드 아님)</caption>
          <thead><tr><th scope="col">분</th>{CORE_TEAM_IDS.map((core) => <th key={core} scope="col">{history.teams[core].label}</th>)}</tr></thead>
          <tbody>{history.points.map((point) => <tr key={point.minute}>
            <th scope="row">{point.minute}분</th>
            {CORE_TEAM_IDS.map((core) => <td key={core}>{ko(point.gold[core])}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
    </details>
  </details>;
}

export default ExperimentResourceHistoryPanel;
