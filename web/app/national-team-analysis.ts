import type { RadarReport } from "./radar-types";

// Manually reviewed facts; partial news coverage is never a complete draft dataset.
export const NATIONAL_REVIEW = {
  id: "usa-20260919",
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
  team_note: "미국전 보도에서는 1세트 상체 개입, 2세트 바텀 개입과 서포터 이동, 3세트 탑·미드 합류가 나타납니다. 다음 상대에게도 반복되는지 확인할 가설이며, 대표팀의 고정 성향으로 확정하지 않습니다.",
} as const;

export const NATIONAL_REVIEWS = [NATIONAL_REVIEW, {
  ...NATIONAL_REVIEW,
  id: "vietnam-20260920",
  match_source: "https://www.inven.co.kr/webzine/news/?news=321214",
  lineup_source: "https://www.inven.co.kr/webzine/news/?news=321214",
  match: "9월 20일 대한민국 vs 베트남",
  result: "대한민국 3–1 · 보도 기준",
  team_note: "베트남전은 앞선 상황의 교전 손실과 불리한 상황의 역전 장면이 모두 보도됐습니다. 다음 경기에서는 고립된 선수 발생 후 교전 중단 여부와 오브젝트 전후 합류를 나누어 확인하세요. 이 결과만으로 고정 성향이나 밴픽 효과를 확정하지 않습니다.",
}] as const;

export const nationalSubjects = [
  { name: "Zeus", role: "TOP", label: "탑" },
  { name: "Canyon", role: "JUNGLE", label: "정글" },
  { name: "Zeka", role: "MID", label: "미드" },
  { name: "Faker", role: "MID", label: "미드" },
  { name: "Gumayusi", role: "BOTTOM", label: "바텀" },
  { name: "Keria", role: "SUPPORT", label: "서포터" },
] as const;

const usaObservations = [
  { player: "Canyon", game: 1, champion: "Qiyana", fact: "탑 개입 이후 미드 추가 개입 보도", question: "다른 상대에게도 초반 상체 개입을 반복하는가?" },
  { player: "Zeka", game: 1, champion: "Ryze", fact: "미드 솔로 킬과 정글 연계 보도", question: "라인 주도권을 다른 라인 지원으로 연결하는가?" },
  { player: "Canyon", game: 2, champion: "Pantheon", fact: "초반 바텀 개입 후 재차 방문 보도", question: "바텀 우선 개입이 조합과 상대에 따라 달라지는가?" },
  { player: "Gumayusi", game: 2, champion: "Caitlyn", fact: "바드와 바텀 조합·상대 갱킹 대응 보도", question: "서포터가 이동할 때 바텀 라인을 어떻게 유지하는가?" },
  { player: "Keria", game: 2, champion: "Bard", fact: "여러 라인 로밍과 바텀 복귀 지원 보도", question: "다른 챔피언에서도 이른 로밍이 관찰되는가?" },
  { player: "Zeka", game: 3, champion: "TwistedFate", fact: "바텀 쪽 합류 지원 보도", question: "미드 합류 선택이 다음 세트에도 이어지는가?" },
  { player: "Zeus", game: 3, champion: "Shen", fact: "바텀 쪽 합류 지원 보도", question: "탑의 합류 역할이 다른 조합에서도 유지되는가?" },
] as const;

export const nationalObservations = [
  ...usaObservations.map((item) => ({ ...item, match_id: NATIONAL_REVIEW.id })),
  ...[
    { player: "Zeus", game: 1, champion: "Gragas", fact: "고립된 뒤 팀의 후속 교전 손실 보도", question: "선수 고립 이후 팀이 교전을 중단하는 조건은 무엇인가?" },
    { player: "Zeus", game: 3, champion: "Camille", fact: "탑 성장과 후반 아리 대상 진입 보도", question: "사이드 성장 이득을 본대 교전에 연결하는 시점은 언제인가?" },
    { player: "Keria", game: 3, champion: "Poppy", fact: "후반 교전에서 이즈리얼을 밀어내 딜 공백을 만든 장면 보도", question: "서포터의 진입 차단·딜러 분리가 어떤 교전 조건에서 나오는가?" },
    { player: "Canyon", game: 3, champion: "Nocturne", fact: "후반 바론 스틸 보도", question: "오브젝트 시도 전 시야와 진입 조건을 어떻게 확보하는가?" },
    { player: "Faker", game: 4, champion: "Anivia", fact: "상대 초반 개입에 대응한 장면 보도", question: "압박을 받는 상황에서 라인 유지와 합류 중 무엇을 선택하는가?" },
    { player: "Gumayusi", game: 4, champion: "Caitlyn", fact: "더블 킬과 마지막 한타 기여 보도", question: "불리한 교전 직후 딜러의 위치와 보호 자원은 어떻게 바뀌는가?" },
  ].map((item) => ({ ...item, match_id: "vietnam-20260920" })),
];

export function nationalMatchObservations(matchId: string, subject: string) {
  return nationalObservations.filter((item) => item.match_id === matchId
    && (subject === "대한민국 대표팀" || item.player === subject));
}

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
export const MAX_NATIONAL_FILE_BYTES = 200_000;
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
  if (new TextEncoder().encode(raw).byteLength > MAX_NATIONAL_FILE_BYTES) throw new Error("검증 기록 파일이 너무 큽니다.");
  const payload: unknown = JSON.parse(raw);
  if (!record(payload) || payload.schema_version !== "1" || payload.artifact_type !== "national-team-observation-checks" ||
    !Array.isArray(payload.checks) || payload.checks.length > 30 || !payload.checks.every(validCheck) ||
    new Set(payload.checks.map((check) => check.id)).size !== payload.checks.length) throw new Error("검증 기록 형식이 올바르지 않습니다.");
  return payload.checks.map(copyNationalCheck);
}

// Keep a canonical, bounded shape when comparing files from different serializers.
function copyNationalCheck(check: NationalCheck): NationalCheck {
  return { id: check.id, created_at: check.created_at, subject: check.subject, target: check.target,
    hypothesis: check.hypothesis, criterion: check.criterion,
    baseline: { patch: check.baseline.patch, cutoff: check.baseline.cutoff }, timing: check.timing,
    outcome: check.outcome ? { recorded_at: check.outcome.recorded_at, verdict: check.outcome.verdict,
      observation: check.outcome.observation, source_url: check.outcome.source_url } : null };
}

export function mergeNationalChecks(existing: NationalCheck[], incoming: NationalCheck[]): NationalCheck[] {
  const merged = new Map(parseNationalChecks(serializeNationalChecks(existing)).map((check) => [check.id, check]));
  for (const check of parseNationalChecks(serializeNationalChecks(incoming))) {
    const previous = merged.get(check.id);
    if (!previous) { merged.set(check.id, check); continue; }
    const sameCriteria = JSON.stringify({ ...previous, outcome: null }) === JSON.stringify({ ...check, outcome: null });
    const outcomesConflict = previous.outcome && check.outcome && JSON.stringify(previous.outcome) !== JSON.stringify(check.outcome);
    if (!sameCriteria || outcomesConflict) throw new Error("같은 기록의 예상·판정이 다릅니다. 파일 전체를 가져오지 않았습니다. 기존 기록과 원본 파일을 비교하세요.");
    if (!previous.outcome && check.outcome) merged.set(check.id, check);
  }
  if (merged.size > 30) throw new Error("가져온 기록을 합치면 30건을 넘습니다. 기존 기록은 변경하지 않았습니다.");
  return [...merged.values()].sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at)
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

export function saveNationalChecks(
  storage: Pick<Storage, "getItem" | "setItem">, expected: string | null, checks: NationalCheck[],
): string {
  const raw = serializeNationalChecks(checks);
  if (storage.getItem(NATIONAL_JOURNAL_KEY) !== expected) {
    throw new Error("다른 탭에서 기록이 변경됐습니다. 입력 중인 내용을 복사한 뒤 새로고침하세요. 저장하지 않았습니다.");
  }
  storage.setItem(NATIONAL_JOURNAL_KEY, raw);
  return raw;
}

export function serializeNationalChecks(checks: NationalCheck[]) {
  const raw = JSON.stringify({ schema_version: "1", artifact_type: "national-team-observation-checks", checks }, null, 2);
  parseNationalChecks(raw);
  return raw;
}
