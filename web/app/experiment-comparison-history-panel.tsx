"use client";

import { useId, useMemo } from "react";
import type { ExperimentRun } from "./experiment-replay";
import { comparisonDeltaSeries, experimentComparisonHistory } from "./experiment-comparison-history";
import { resourceChartGeometry } from "./experiment-resource-history";
import { ResourceChartView } from "./experiment-resource-history-panel";

type ExperimentComparisonHistoryPanelProps = {
  /** Frozen baseline A (kept in the comparison panel's memory). */
  baseline: ExperimentRun;
  /** Current run B. */
  run: ExperimentRun;
  /** Minute of B on screen; nothing is shown before B's end. */
  shownMinute: number;
};

const signed = (value: number) => value > 0 ? `+${value.toLocaleString("ko-KR")}` : value.toLocaleString("ko-KR");

/**
 * Collapsed A/B chart of each team's model-resource difference B − A at the same minute, over the
 * span both runs actually played. Uses the existing comparison gate and the single-run chart view;
 * no timer, model run, storage or URL change.
 */
export function ExperimentComparisonHistoryPanel({ baseline, run, shownMinute }: ExperimentComparisonHistoryPanelProps) {
  const baseId = useId();
  const history = useMemo(() => experimentComparisonHistory(baseline, run, shownMinute), [baseline, run, shownMinute]);
  if (history.status === "PENDING") return null;
  if (history.status === "REFUSED") return <p className="experiment-comparison-history-refused" role="note">
    같은 시각의 모델 자원 차이를 표시하지 않습니다: {history.refusals.map((r) => r.message).join(" ")}
  </p>;

  const series = comparisonDeltaSeries(history);
  const geo = resourceChartGeometry(series, 320, 160, { includeZero: true });
  const titleId = `${baseId}-diff-title`;
  const descId = `${baseId}-diff-desc`;
  const end = history.commonEndMinute;
  const labels = { team_a: `${history.teams[0].label} B−A`, team_b: `${history.teams[1].label} B−A` };
  const last = history.points[history.points.length - 1];
  const endText = history.teams.map((team, i) => `${team.label} ${signed(last.delta[i])}`).join(", ");
  const { a: endA, b: endB } = history.endMinutes;

  return <details className="experiment-comparison-history" data-common-end-minute={end}>
    <summary>같은 시각의 모델 자원 차이</summary>
    <p className="experiment-comparison-history-note">같은 팀의 B−A이며 두 팀 사이 격차가 아닙니다. 두 실행이 모두 진행된 구간만 비교합니다. 실제 골드·승률·선수 기여도가 아닙니다.</p>
    <p className="experiment-comparison-history-span">{endA === endB
      ? `두 실행 모두 ${end}분에 끝나 0~${end}분을 비교합니다.`
      : `A는 ${endA}분, B는 ${endB}분에 끝나 끝난 시각이 다릅니다. 두 실행이 모두 진행된 0~${end}분만 비교하며, 먼저 끝난 실행을 늘리거나 추정하지 않습니다.`}</p>
    {history.changeKind === "NONE" && <p className="experiment-comparison-history-kind">가정 변경이 없어 모든 분의 차이가 0입니다.</p>}
    {history.changeKind === "MULTIPLE" && <p className="experiment-comparison-history-kind">여러 가정을 함께 바꿨으므로 차이를 한 가정 탓으로 나눌 수 없습니다.</p>}
    <ResourceChartView series={series} geo={geo} labels={labels} titleId={titleId} descId={descId}
      title="같은 시각의 모델 자원 차이 B−A (실제 골드 아님)"
      desc={`0분부터 ${end}분까지 같은 팀의 실행 B 모델 자원에서 기준 A 모델 자원을 뺀 값입니다. 0이 기준선입니다. ${end}분: ${endText}.`}
      caption={`0분~${end}분 같은 팀의 모델 자원 차이 B−A (실제 골드 아님)`} format={signed} />
  </details>;
}

export default ExperimentComparisonHistoryPanel;
