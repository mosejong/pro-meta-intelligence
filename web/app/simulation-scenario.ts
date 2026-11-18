import {
  championKey,
  emptyChampionRoles,
  roleLabel,
  teamPicks,
  validateRoles,
  type ChampionRoles,
  type RoleAssignments,
} from "./champion-roles";
import { DRAFT_MODEL_VERSION, type DraftGame, type DraftSelection, type DraftSide } from "./draft-agent";
import { buildDraftComparisonSnapshot, evidenceIdentityOf, type DraftComparisonSnapshot } from "./draft-comparison";
import { MAX_DRAFT_FILE_BYTES } from "./draft-session";
import { isRadarReport, type OpponentTeam, type RadarReport } from "./radar-types";
import { parseRosterExport, rosterExport, ROSTER_EVIDENCE_SCOPE, type RosterCapture } from "./roster-comparison";
import { basisKey, rosterBasis, ROSTER_ROLES, type RosterRole } from "./roster-scenario";

/**
 * Simulation input readiness (manager-scenario v1), before any outcome is computed.
 *
 * Fixes one completed draft, the edited rosters of both teams and an explicit, user-assigned
 * champion for every role of each team. Roles are never inferred from pick order, champion
 * names, the other team's picks, bans or earlier games. The draft and roster are re-validated
 * with the existing draft-comparison replay (same report, same roster index). Nothing here calls
 * the assumption-based simulation core or produces a winner, effect, matchup or win rate.
 */

export const MANAGER_SCENARIO_ARTIFACT = "manager-scenario";
export const MANAGER_SCENARIO_SCHEMA = 1;
export const MAX_MANAGER_SCENARIO_BYTES = MAX_DRAFT_FILE_BYTES;
export const ROLE_SOURCE = "USER_ASSIGNED";
const FORMAT = "HARD_FEARLESS_5_BAN_5_PICK";
const BOUNDARY = "Simulation input readiness only. Champion roles are assigned by the user, never inferred from pick order. Player evidence is the embedded analysis snapshot's current player observations; no season-history file. No learned player/champion effect, matchup, rune, item, win rate or simulation outcome is computed or recorded.";

// Role helpers live in champion-roles.ts (shared with the A/B comparison); re-exported unchanged.
export { championKey, emptyChampionRoles, teamPicks, validateRoles };
export type { ChampionRoles, RoleAssignments };

export type SimulationInputSnapshot = {
  evidenceIdentity: string;
  model: string;
  patch: string;
  cutoff: string;
  fixtureOnly: boolean;
  /** Sorted `source_id@version#hash` entries of the report (same as the roster basis). */
  sourceVersions: string[];
  rosterEvidenceScope: typeof ROSTER_EVIDENCE_SCOPE;
  roleSource: typeof ROLE_SOURCE;
  draft: DraftComparisonSnapshot & { roster: RosterCapture };
  /** Complete, detached role → champion assignment of each team, keyed by team ID. */
  roles: Record<string, Record<RosterRole, string>>;
};

export type ReadinessIssueCode =
  | "NO_TEAMS" | "DRAFT_INCOMPLETE" | "DRAFT_INVALID" | "ROSTER_PENDING" | "ROSTER_INVALID" | "ROSTER_EMPTY_SLOT"
  | "ROLE_SHAPE" | "ROLE_UNASSIGNED" | "ROLE_NOT_TEAM_PICK" | "ROLE_DUPLICATE";
export type ReadinessIssue = { code: ReadinessIssueCode; message: string; teamId?: string; role?: RosterRole };
export type SimulationReadiness = { ok: true; snapshot: SimulationInputSnapshot } | { ok: false; issues: ReadinessIssue[] };

export type SimulationReadinessInput = {
  report: RadarReport;
  blueTeam: OpponentTeam | null;
  redTeam: OpponentTeam | null;
  selections: DraftSelection[];
  games: DraftGame[];
  firstPickSide: DraftSide;
  /** `{ basis, rosters }` keyed by team ID (LiveRoster or a file roster). null = not ready. */
  roster: { basis: unknown; rosters: unknown } | null;
  roles: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Readiness of the current (or a file's) input. The draft and roster go through the existing
 * comparison snapshot (rules replay, report team records, roster index of the same report); this
 * adds a complete roster requirement and explicit role assignments. The result is a detached,
 * frozen copy: later draft, roster or role edits never reach it.
 */
export function buildSimulationReadiness(input: SimulationReadinessInput): SimulationReadiness {
  const { report, blueTeam, redTeam, selections, games, firstPickSide, roster, roles } = input;
  if (!blueTeam || !redTeam) return { ok: false, issues: [{ code: "NO_TEAMS", message: "블루·레드 팀을 선택하세요." }] };
  if (!Array.isArray(selections) || selections.length !== 20) {
    return { ok: false, issues: [{ code: "DRAFT_INCOMPLETE", message: `밴픽 20개를 완료하면 역할을 배정할 수 있습니다. 현재 ${Array.isArray(selections) ? selections.length : 0}/20개입니다.` }] };
  }
  if (!roster) return { ok: false, issues: [{ code: "ROSTER_PENDING", message: "가상 로스터를 확인하는 중입니다." }] };
  const draft = buildDraftComparisonSnapshot({ report, blueTeam, redTeam, selections, games, firstPickSide, roster });
  if (!draft.ok) {
    const code = draft.message.startsWith("가상 로스터") ? "ROSTER_INVALID" : "DRAFT_INVALID";
    return { ok: false, issues: [{ code, message: draft.message }] };
  }
  const capture = draft.snapshot.roster;
  if (!capture) return { ok: false, issues: [{ code: "ROSTER_PENDING", message: "가상 로스터가 기록되지 않았습니다." }] };
  const issues: ReadinessIssue[] = [];
  for (const side of ["BLUE", "RED"] as const) {
    const team = draft.snapshot.teams[side];
    for (const role of ROSTER_ROLES) if (!capture.teams[team.id]?.[role]) {
      issues.push({ code: "ROSTER_EMPTY_SLOT", teamId: team.id, role, message: `${team.name} ${roleLabel[role]}: 로스터 선수가 비어 있습니다. 가상 로스터에서 채우세요.` });
    }
  }
  const validated = validateRoles(roles, draft.snapshot);
  if (!validated.ok) issues.push(...validated.issues);
  if (issues.length || !validated.ok) return { ok: false, issues };
  const basis = rosterBasis(report);
  return { ok: true, snapshot: deepFreeze({
    evidenceIdentity: draft.snapshot.evidenceIdentity,
    model: draft.snapshot.model,
    patch: report.patch_id,
    cutoff: report.cutoff,
    fixtureOnly: report.fixture_only,
    sourceVersions: [...basis.source_versions],
    rosterEvidenceScope: ROSTER_EVIDENCE_SCOPE,
    roleSource: ROLE_SOURCE,
    draft: { ...draft.snapshot, roster: capture },
    roles: validated.roles,
  }) };
}

/**
 * Canonical input identity (excluding the large evidence fingerprint, compared separately):
 * teams by side, first selection, previous games, selections, roster IDs and roles by team ID.
 */
export function simulationInputKey(snapshot: SimulationInputSnapshot) {
  const { draft } = snapshot;
  const ids = draft.roster.team_ids;
  return JSON.stringify({
    model: snapshot.model, patch: snapshot.patch, cutoff: snapshot.cutoff, sources: snapshot.sourceVersions,
    blue: draft.teams.BLUE.id, red: draft.teams.RED.id, first: draft.firstPickSide,
    games: draft.games.map((game) => [game.blue_team_id, game.red_team_id,
      game.selections.map((item) => [item.side, item.kind, item.slot, championKey(item.champion_id)])]),
    selections: draft.selections.map((item) => [item.side, item.kind, item.slot, championKey(item.champion_id)]),
    roster: ids.map((id) => ROSTER_ROLES.map((role) => { const slot = draft.roster.teams[id][role]; return slot ? [slot.source_team_id, slot.player_id] : null; })),
    roles: ids.map((id) => ROSTER_ROLES.map((role) => championKey(snapshot.roles[id][role]))),
  });
}

/** Same input means same evidence and the same canonical input; no outcome is compared. */
export function sameSimulationInput(a: SimulationInputSnapshot, b: SimulationInputSnapshot) {
  return a.evidenceIdentity === b.evidenceIdentity && simulationInputKey(a) === simulationInputKey(b);
}

/** Two independent 32-bit FNV-1a passes. A consistency check against edits, not a security signature. */
function fingerprint(text: string) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 16777619) >>> 0;
    b = Math.imul(b ^ code, 0x01000193) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** Readiness result recorded in the file; recomputed on replay so an edited result is rejected. */
function readinessRecord(snapshot: SimulationInputSnapshot) {
  return {
    status: "READY",
    role_source: ROLE_SOURCE,
    roster_evidence_scope: ROSTER_EVIDENCE_SCOPE,
    season_history_included: false,
    outcome_computed: false,
    set_number: snapshot.draft.games.length + 1,
    team_ids: [...snapshot.draft.roster.team_ids],
    input_fingerprint: fingerprint(simulationInputKey(snapshot)),
  };
}

export type ManagerScenarioExport = { ok: true; text: string; bytes: number } | { ok: false; message: string };

const TOP_KEYS = ["artifact_type", "schema_version", "format", "model_version", "patch_id", "cutoff", "evidence", "analysis_snapshot", "input", "readiness", "boundary"] as const;
const INPUT_KEYS = ["blue_team", "red_team", "first_pick_side", "previous_games", "selections", "roster", "champion_roles"] as const;

/** One embedded report, the fixed input and its readiness record. No winner or outcome field exists. */
export function serializeManagerScenario(report: RadarReport, snapshot: SimulationInputSnapshot): ManagerScenarioExport {
  if (evidenceIdentityOf(report) !== snapshot.evidenceIdentity) return { ok: false, message: "현재 분석 데이터가 고정한 입력과 다릅니다. 입력을 다시 고정한 뒤 저장하세요." };
  const { draft } = snapshot;
  const text = JSON.stringify({
    artifact_type: MANAGER_SCENARIO_ARTIFACT,
    schema_version: MANAGER_SCENARIO_SCHEMA,
    format: FORMAT,
    model_version: snapshot.model,
    patch_id: report.patch_id,
    cutoff: report.cutoff,
    evidence: { source_versions: report.opponent_prep?.evidence_index.source_versions ?? report.evidence_index.source_versions },
    analysis_snapshot: report,
    input: {
      blue_team: { team_id: draft.teams.BLUE.id, team_name: draft.teams.BLUE.name },
      red_team: { team_id: draft.teams.RED.id, team_name: draft.teams.RED.name },
      first_pick_side: draft.firstPickSide,
      previous_games: draft.games,
      selections: draft.selections,
      roster: rosterExport(draft.roster),
      champion_roles: Object.fromEntries(draft.roster.team_ids.map((id) => [id, { ...snapshot.roles[id] }])),
    },
    readiness: readinessRecord(snapshot),
    boundary: BOUNDARY,
  }, null, 2);
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > MAX_MANAGER_SCENARIO_BYTES) return { ok: false, message: "시나리오 파일이 16MB를 넘어 저장하지 않았습니다." };
  return { ok: true, text, bytes };
}

export type ManagerScenarioReplay = { ok: true; snapshot: SimulationInputSnapshot } | { ok: false; message: string };

/** File entry point: oversize files are rejected from metadata before reading. Never throws. */
export async function replayManagerScenarioFile(file: Pick<Blob, "size" | "text">): Promise<ManagerScenarioReplay> {
  if (!Number.isFinite(file.size) || file.size > MAX_MANAGER_SCENARIO_BYTES) return { ok: false, message: "시나리오 파일은 16MB 이하여야 합니다." };
  let text: string;
  try { text = await file.text(); } catch { return { ok: false, message: "파일을 읽지 못했습니다. 다시 선택하세요." }; }
  try { return replayManagerScenario(text); } catch { return { ok: false, message: "시나리오 파일의 내용이 올바르지 않습니다." }; }
}

/** Read-only replay: rebuild the input from the file's own report and require the same readiness record. */
export function replayManagerScenario(text: string): ManagerScenarioReplay {
  if (new TextEncoder().encode(text).byteLength > MAX_MANAGER_SCENARIO_BYTES) return { ok: false, message: "시나리오 파일은 16MB 이하여야 합니다." };
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { ok: false, message: "JSON 파일을 읽을 수 없습니다." }; }
  if (!isObject(value) || value.artifact_type !== MANAGER_SCENARIO_ARTIFACT) return { ok: false, message: "시뮬레이션 입력 시나리오 파일이 아닙니다." };
  if (value.schema_version !== MANAGER_SCENARIO_SCHEMA) return { ok: false, message: "지원하지 않는 시나리오 파일 버전입니다." };
  if (!exactKeys(value, TOP_KEYS) || value.format !== FORMAT) return { ok: false, message: "시나리오 파일에 지원하지 않는 항목이 있거나 형식이 다릅니다." };
  if (value.model_version !== DRAFT_MODEL_VERSION) return { ok: false, message: "분석 모델 버전이 달라 재현할 수 없습니다." };
  const report = value.analysis_snapshot;
  if (!isRadarReport(report) || !report.opponent_prep) return { ok: false, message: "분석 데이터가 없거나 손상되었습니다." };
  if (value.patch_id !== report.patch_id || value.cutoff !== report.cutoff) return { ok: false, message: "패치 또는 기준 시점이 분석 데이터와 일치하지 않습니다." };
  if (!isObject(value.evidence) || !exactKeys(value.evidence, ["source_versions"]) ||
    JSON.stringify(value.evidence.source_versions) !== JSON.stringify(report.opponent_prep.evidence_index.source_versions)) {
    return { ok: false, message: "파일의 출처 버전이 포함된 분석 데이터와 일치하지 않습니다." };
  }
  const raw = value.input;
  if (!isObject(raw) || !exactKeys(raw, INPUT_KEYS) || !isObject(raw.blue_team) || !isObject(raw.red_team)) return { ok: false, message: "입력 형식이 올바르지 않습니다." };
  const teams = report.opponent_prep.teams;
  const blueTeam = teams.find((team) => team.team_id === (raw.blue_team as Record<string, unknown>).team_id) ?? null;
  const redTeam = teams.find((team) => team.team_id === (raw.red_team as Record<string, unknown>).team_id) ?? null;
  if (!blueTeam || !redTeam) return { ok: false, message: "파일의 팀이 포함된 분석 데이터에 없습니다." };
  if ((raw.blue_team as Record<string, unknown>).team_name !== blueTeam.team_name || (raw.red_team as Record<string, unknown>).team_name !== redTeam.team_name) {
    return { ok: false, message: "팀 표시 이름이 파일 안의 분석 데이터와 다릅니다." };
  }
  const parsedRoster = parseRosterExport(raw.roster, report);
  if (!parsedRoster.ok) return { ok: false, message: `가상 로스터: ${parsedRoster.message}` };
  if (!isObject(parsedRoster.basis) || basisKey(parsedRoster.basis as never) !== basisKey(rosterBasis(report))) {
    return { ok: false, message: "가상 로스터: 자료 기준(패치·cutoff·출처)이 파일의 분석 데이터와 다릅니다." };
  }
  const result = buildSimulationReadiness({ report, blueTeam, redTeam, firstPickSide: raw.first_pick_side as DraftSide,
    selections: raw.selections as DraftSelection[], games: raw.previous_games as DraftGame[],
    roster: { basis: parsedRoster.basis, rosters: parsedRoster.rosters }, roles: raw.champion_roles });
  if (!result.ok) return { ok: false, message: result.issues.map((issue) => issue.message).join(" ") };
  if (JSON.stringify(readinessRecord(result.snapshot)) !== JSON.stringify(value.readiness)) {
    return { ok: false, message: "기록된 준비 결과가 입력을 다시 검증한 결과와 다릅니다." };
  }
  return result;
}
