import type { BatchResult, Spread } from "./experiment-batch";

/**
 * Plain-language summary of an already computed paired multi-seed batch (pure, read-only).
 *
 * Reads only the given BatchResult and the caller's label function; never runs the batch or the
 * single-run engine again and never mutates its input. Same result + same labels → same text.
 * The text keeps the model-internal boundary: no real win rate, real-game prediction or real
 * player/champion/rune/item effect is stated.
 */

const num = (value: number) => value.toLocaleString("ko-KR");
const signed = (value: number) => value > 0 ? `+${num(value)}` : num(value);
const spread = (s: Spread) => `최소 ${signed(s.min)}, 중앙 ${signed(s.median)}, 최대 ${signed(s.max)}`;

export const BATCH_SUMMARY_BOUNDARY =
  "이 글은 모델 내부 실험 결과입니다. 미리 정한 재현 번호로 같은 모델을 돌린 것이며 표본 통계·실제 승률·실전 예측이 아닙니다. 실제 선수·챔피언·룬·아이템의 효과는 반영하지 않았습니다.";

export function buildBatchSummaryText(result: BatchResult, label: (sourceId: string) => string): string {
  const { target, seeds, summary, context } = result;
  const first = seeds[0];
  const last = seeds[seeds.length - 1];
  const lines: string[] = [
    "[여러 재현 번호 가정 비교 요약]",
    `기준 A #${target.baselineRunId} 와 실행 B #${target.candidateRunId} 의 가정을 비교했습니다.`,
    `재현 번호 목록 ${result.seedListId} 중 ${first}~${last}번, 모두 ${seeds.length}쌍을 A와 B에 똑같이 사용했습니다. (규칙 ${result.ruleset})`,
  ];
  if (result.changeKind === "NONE") lines.push("A와 B의 가정이 같아서 모든 쌍의 차이가 0입니다.");
  else if (summary.allZero) lines.push("가정은 다르지만 이 재현 번호 목록에서는 차이가 모두 0이었습니다.");
  lines.push("");
  for (const id of context.teamOrder) {
    const wins = summary.wins[id];
    lines.push(`- ${label(id)}: 모델 안에서 이긴 횟수 A ${wins.a}/${summary.denominator}번 → B ${wins.b}/${summary.denominator}번`);
    lines.push(`  자원 차이(B−A): ${spread(summary.gold[id])}`);
    lines.push(`  킬 차이(B−A): ${spread(summary.kills[id])}`);
  }
  lines.push(`- 경기 끝난 분 차이(B−A): ${spread(summary.minute)}`);
  lines.push("");
  lines.push(BATCH_SUMMARY_BOUNDARY);
  return lines.join("\n");
}
