export type FreshnessLevel = "FRESH" | "AGING" | "STALE" | "UNKNOWN";

export type FreshnessPolicy = {
  freshHours: number;
  staleHours: number;
};

export type FreshnessStatus = {
  level: FreshnessLevel;
  ageHours: number | null;
  ageLabel: string;
};

function formatAge(ageHours: number) {
  if (ageHours < 1) return "1시간 이내";
  if (ageHours < 24) return `${Math.floor(ageHours)}시간 전`;
  return `${Math.floor(ageHours / 24)}일 전`;
}

export function snapshotFreshness(
  snapshotAt: string | null,
  checkedAt: string | null,
  policy: FreshnessPolicy,
): FreshnessStatus {
  if (!snapshotAt || !checkedAt || policy.freshHours < 0 || policy.staleHours < policy.freshHours) {
    return { level: "UNKNOWN", ageHours: null, ageLabel: "확인 중" };
  }

  const snapshotTime = Date.parse(snapshotAt);
  const checkedTime = Date.parse(checkedAt);
  if (!Number.isFinite(snapshotTime) || !Number.isFinite(checkedTime)) {
    return { level: "UNKNOWN", ageHours: null, ageLabel: "시각 확인 불가" };
  }

  const ageHours = Math.max(0, (checkedTime - snapshotTime) / (60 * 60 * 1000));
  const level = ageHours <= policy.freshHours
    ? "FRESH"
    : ageHours <= policy.staleHours
      ? "AGING"
      : "STALE";

  return { level, ageHours, ageLabel: formatAge(ageHours) };
}
