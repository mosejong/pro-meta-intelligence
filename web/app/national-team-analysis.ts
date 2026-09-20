import type { RadarReport } from "./radar-types";

// Manually reviewed facts; partial news coverage is never a complete draft dataset.
export const NATIONAL_REVIEW = {
  checked_on: "2026-09-20",
  event: "2026 국가대표 평가전",
  schedule_source: "https://brena.or.kr/brena/notice.do?articleNo=2999&mode=view&srCategoryId=",
  match_source: "https://www.inven.co.kr/webzine/news/?news=321196",
  lineup_source: "https://www.osen.co.kr/article/G1112878541",
  match: "9월 19일 대한민국 vs 미국",
  result: "대한민국 3–0 · 보도 기준",
  patch: null,
  draft_rules: "UNVERIFIED",
  complete_drafts: 0,
} as const;

export const nationalSubjects = [
  { name: "Zeus", role: "TOP", label: "탑" },
  { name: "Canyon", role: "JUNGLE", label: "정글" },
  { name: "Zeka", role: "MID", label: "미드" },
  { name: "Faker", role: "MID", label: "미드" },
  { name: "Gumayusi", role: "BOTTOM", label: "바텀" },
  { name: "Keria", role: "SUPPORT", label: "서포터" },
] as const;

export const nationalObservations = [
  { player: "Canyon", game: 1, champion: "Qiyana", fact: "탑 개입 이후 미드 추가 개입 보도", question: "다른 상대에게도 초반 상체 개입을 반복하는가?" },
  { player: "Zeka", game: 1, champion: "Ryze", fact: "미드 솔로 킬과 정글 연계 보도", question: "라인 주도권을 다른 라인 지원으로 연결하는가?" },
  { player: "Canyon", game: 2, champion: "Pantheon", fact: "초반 바텀 개입 후 재차 방문 보도", question: "바텀 우선 개입이 조합과 상대에 따라 달라지는가?" },
  { player: "Gumayusi", game: 2, champion: "Caitlyn", fact: "바드와 바텀 조합·상대 갱킹 대응 보도", question: "서포터가 이동할 때 바텀 라인을 어떻게 유지하는가?" },
  { player: "Keria", game: 2, champion: "Bard", fact: "여러 라인 로밍과 바텀 복귀 지원 보도", question: "다른 챔피언에서도 이른 로밍이 관찰되는가?" },
  { player: "Zeka", game: 3, champion: "TwistedFate", fact: "바텀 쪽 합류 지원 보도", question: "미드 합류 선택이 다음 세트에도 이어지는가?" },
  { player: "Zeus", game: 3, champion: "Shen", fact: "바텀 쪽 합류 지원 보도", question: "탑의 합류 역할이 다른 조합에서도 유지되는가?" },
] as const;

export function nationalClubBaseline(report: RadarReport, playerName: string) {
  const subject = nationalSubjects.find((player) => player.name === playerName);
  if (!subject || report.fixture_only) return null;
  const matches = (report.opponent_prep?.teams ?? []).filter((team) => team.leagues.includes("LCK"))
    .flatMap((team) => (team.player_profiles ?? []).filter((player) =>
      player.player_name.trim().toLowerCase() === subject.name.toLowerCase() && player.role === subject.role)
      .map((player) => ({ team, player })));
  // No academy, fuzzy-name or first-row fallback; membership comes from this report.
  if (matches.length !== 1 || matches[0].player.game_count <= 0 || !matches[0].player.evidence_match_ids.length) return null;
  const { team, player } = matches[0];
  return { team_name: team.team_name, player_id: player.player_id, game_count: player.game_count,
    champions: player.champions.filter((pick) => pick.game_count > 0 && pick.evidence_event_ids.length > 0),
    evidence_match_ids: [...player.evidence_match_ids], patch: report.patch_id, cutoff: report.cutoff };
}

export const NATIONAL_JOURNAL_KEY = "pmi:national-observation-checks:v1";
export type NationalCheck = {
  id: string;
  created_at: string;
  subject: string;
  target: string;
  hypothesis: string;
  criterion: string;
  baseline: { patch: string; cutoff: string };
  timing: "UNVERIFIED_DEVICE_TIME";
  outcome: null | { recorded_at: string; verdict: "SUPPORTED" | "CONTRADICTED" | "INSUFFICIENT"; observation: string; source_url: string };
};

const subjects = new Set<string>(["대한민국 대표팀", ...nationalSubjects.map((player) => player.name)]);
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown, max = 500): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
function date(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)); }
function sourceUrl(value: unknown): value is string {
  if (!text(value, 2000)) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
}
function validCheck(value: unknown): value is NationalCheck {
  if (!record(value) || !text(value.id, 80) || !date(value.created_at) || !text(value.subject, 60) || !subjects.has(value.subject) ||
    !text(value.target, 160) || !text(value.hypothesis) || !text(value.criterion) || !record(value.baseline) ||
    !text(value.baseline.patch, 30) || !date(value.baseline.cutoff) || Date.parse(value.baseline.cutoff) >= Date.parse(value.created_at) ||
    value.timing !== "UNVERIFIED_DEVICE_TIME") return false;
  const outcome = value.outcome;
  return outcome === null || (record(outcome) && date(outcome.recorded_at) && Date.parse(outcome.recorded_at) >= Date.parse(value.created_at) &&
    ["SUPPORTED", "CONTRADICTED", "INSUFFICIENT"].includes(String(outcome.verdict)) && typeof outcome.verdict === "string" &&
    text(outcome.observation) && sourceUrl(outcome.source_url));
}

export function createNationalCheck(input: Omit<NationalCheck, "timing" | "outcome">): NationalCheck {
  const check = { ...input, timing: "UNVERIFIED_DEVICE_TIME" as const, outcome: null };
  if (!validCheck(check)) throw new Error("대상 경기·가설·판정 기준을 입력하고 분석 기준일을 확인하세요.");
  return check;
}

export function resolveNationalCheck(check: NationalCheck, outcome: NonNullable<NationalCheck["outcome"]>): NationalCheck {
  if (!validCheck(check) || check.outcome) throw new Error("이미 판정한 기록은 변경할 수 없습니다.");
  const resolved = { ...check, outcome };
  if (!validCheck(resolved)) throw new Error("실제 관찰과 https 근거 링크를 입력하세요. 판정 시각은 기록 이후여야 합니다.");
  return resolved;
}

export function parseNationalChecks(raw: string | null): NationalCheck[] {
  if (raw === null) return [];
  if (raw.length > 200_000) throw new Error("검증 기록 파일이 너무 큽니다.");
  const payload: unknown = JSON.parse(raw);
  if (!record(payload) || payload.schema_version !== "1" || payload.artifact_type !== "national-team-observation-checks" ||
    !Array.isArray(payload.checks) || payload.checks.length > 30 || !payload.checks.every(validCheck) ||
    new Set(payload.checks.map((check) => check.id)).size !== payload.checks.length) throw new Error("검증 기록 형식이 올바르지 않습니다.");
  return payload.checks;
}

export function serializeNationalChecks(checks: NationalCheck[]) {
  const raw = JSON.stringify({ schema_version: "1", artifact_type: "national-team-observation-checks", checks }, null, 2);
  parseNationalChecks(raw);
  return raw;
}
