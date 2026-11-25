/**
 * Plain-language header text for a feed state label. The English labels stay as internal keys
 * (other code compares against them); visitors see the data date instead of pipeline jargon.
 */
export function feedDisplayLabel(label: string, cutoff: string | null | undefined): string {
  const date = cutoffDay(cutoff);
  if (label === "LIVE PUBLISHED FEED" || label === "STALE · REVIEW ONLY") return date ? `공개 경기 기준 ${date}` : "공개 경기 기록";
  if (label === "FEED CONNECTING") return "데이터 불러오는 중";
  if (label === "PUBLISHED DEMO FEED") return "예시 데이터";
  if (label === "DEMO FALLBACK") return "예시 데이터 · 실제 기록 불러오기 실패";
  if (label === "LOCAL FILE") return "불러온 파일";
  if (label === "INVALID LOCAL FILE") return "파일 확인 필요";
  if (label.startsWith("REFRESH FAILED")) return "새로고침 실패 · 이전 데이터";
  return label;
}

/** Month/day of the cutoff in Korea time (the audience's calendar). */
function cutoffDay(cutoff: string | null | undefined): string | null {
  const time = typeof cutoff === "string" ? Date.parse(cutoff) : NaN;
  if (!Number.isFinite(time)) return null;
  const kst = new Date(time + 9 * 3600 * 1000);
  return `${kst.getUTCMonth() + 1}/${kst.getUTCDate()}`;
}
