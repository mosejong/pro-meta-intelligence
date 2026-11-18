import type { TeamRoles } from "./champion-roles";
import type { DraftComparisonSnapshot } from "./draft-comparison";
import { championKey } from "./player-pool-evidence";
import type { SeasonChampion } from "./player-season-history";
import type { RosterCapture } from "./roster-comparison";
import { pairKey, ROSTER_ROLES, type RosterRole } from "./roster-scenario";
import { assignedChampionEvidence, type AssignedEvidenceRow, type LoadedSeasonHistory } from "./simulation-player-evidence";
import type { SimulationInputSnapshot } from "./simulation-scenario";

/**
 * A/B player · champion observation differences (pure, display only).
 *
 * Both A and B must carry a recorded roster and explicit user-assigned roles. The currently loaded,
 * validated season file is applied to each of them separately with the existing assigned-champion
 * helper (exact source team ID + player ID, same role only), so this is a *current* supplementary
 * reference: it never claims the file was frozen with A, and nothing here is written to the A/B
 * file. Counts are observations — never an effect, rating, proficiency or win rate.
 *
 * Next-set remaining observed pool: from the player's full annual champion list in that role, the
 * picks of both teams in previous sets and in this set are locked (Fearless). This set's bans are
 * NOT removed because bans reset for the next set. Unknown players stay unknown (never 0).
 */

export type RolesSnapshot = DraftComparisonSnapshot & { roster: RosterCapture; roles: TeamRoles };
export const hasRoleRecord = (snapshot: DraftComparisonSnapshot | null): snapshot is RolesSnapshot =>
  Boolean(snapshot?.roster && snapshot.roles);

export type NextSetPool = {
  /** Unique champions the player was observed on in this role over the season (denominator). */
  observed_unique: number;
  /** Observed champions still pickable in the next set. */
  available: number;
  /** Still-pickable observed champions, most games first (then by id). */
  remaining: SeasonChampion[];
  /** Observed champions locked for the next set (asset ids as recorded in the file). */
  locked: string[];
};

export type SideEvidence = { row: AssignedEvidenceRow; pool: NextSetPool | null };

export type ComparisonEvidenceRow = {
  team_id: string;
  team_name: string;
  role: RosterRole;
  /** Side the team plays in A and in B (a side swap keeps the team-ID meaning). */
  side_a: "BLUE" | "RED";
  side_b: "BLUE" | "RED";
  a: SideEvidence;
  b: SideEvidence;
  player_changed: boolean;
  champion_changed: boolean;
  /** Same player only: observed champions locked in B but open in A, and the reverse. */
  newly_locked: string[];
  reopened: string[];
  changed: boolean;
};

export type ComparisonEvidenceHold = "ROLES_MISSING" | "PAIR_CHANGED" | "EVIDENCE_MISMATCH" | "BASIS_MISMATCH";
export type ComparisonEvidence =
  | { ok: true; rows: ComparisonEvidenceRow[] }
  | { ok: false; code: ComparisonEvidenceHold; message: string };

/** Picks of both teams in previous sets (snapshot.locks) and in this set; this set's bans excluded. */
export function nextSetLocks(snapshot: Pick<DraftComparisonSnapshot, "locks" | "selections">) {
  const keys = new Set(snapshot.locks.map(championKey));
  for (const selection of snapshot.selections) if (selection.kind === "PICK") keys.add(championKey(selection.champion_id));
  return keys;
}

const byGames = (left: SeasonChampion, right: SeasonChampion) =>
  right.games - left.games || (championKey(left.champion_id) < championKey(right.champion_id) ? -1 : championKey(left.champion_id) > championKey(right.champion_id) ? 1 : 0);

/** Pool of one row: null when the player is unknown (never 0); a found player with 0 role games has an empty pool. */
export function nextSetPool(row: AssignedEvidenceRow, loaded: LoadedSeasonHistory, locks: ReadonlySet<string>): NextSetPool | null {
  if (row.status === "EMPTY" || row.status === "UNCONFIRMED") return null;
  const record = loaded.history.players.get(row.player_key)?.roles[row.role];
  const champions = record?.season.champions ?? [];
  const remaining = champions.filter((champion) => !locks.has(championKey(champion.champion_id))).map((champion) => ({ champion_id: champion.champion_id, games: champion.games })).sort(byGames);
  const locked = champions.filter((champion) => locks.has(championKey(champion.champion_id))).sort(byGames).map((champion) => champion.champion_id);
  return { observed_unique: champions.length, available: remaining.length, remaining, locked };
}

/** The existing helper reads only teams, roster, roles, patch and cutoff from its input. */
const asInput = (snapshot: RolesSnapshot) =>
  ({ cutoff: snapshot.cutoff, patch: snapshot.patch, draft: { teams: snapshot.teams, roster: snapshot.roster }, roles: snapshot.roles }) as unknown as SimulationInputSnapshot;

const sideOf = (snapshot: DraftComparisonSnapshot, teamId: string) => snapshot.teams.BLUE.id === teamId ? "BLUE" as const : "RED" as const;

/** Rows by B's BLUE team then RED team, TOP→SUPPORT, keyed by team ID. Pure; inputs are not mutated. */
export function compareAssignedEvidence(a: DraftComparisonSnapshot, b: DraftComparisonSnapshot, loaded: LoadedSeasonHistory): ComparisonEvidence {
  if (!hasRoleRecord(a) || !hasRoleRecord(b)) {
    return { ok: false, code: "ROLES_MISSING", message: "기준 A와 현재 B 모두 역할 배정 기록이 있어야 선수·챔피언 기록을 비교합니다." };
  }
  if (a.evidenceIdentity !== b.evidenceIdentity || a.model !== b.model) {
    return { ok: false, code: "EVIDENCE_MISMATCH", message: "A와 B의 분석 데이터(패치·기준 시각·출처)가 달라 비교를 보류합니다." };
  }
  if (pairKey(a.roster.team_ids) !== pairKey(b.roster.team_ids)) {
    return { ok: false, code: "PAIR_CHANGED", message: "A와 B의 팀 조합이 달라 팀 ID·역할 기준으로 비교하지 않습니다." };
  }
  const aRows = assignedChampionEvidence(asInput(a), loaded);
  const bRows = assignedChampionEvidence(asInput(b), loaded);
  if (!aRows.ok || !bRows.ok) {
    return { ok: false, code: "BASIS_MISMATCH", message: "연간 자료의 기준(패치·기준 시각·출처)이 A/B 입력과 달라 비교를 보류합니다." };
  }
  const aLocks = nextSetLocks(a), bLocks = nextSetLocks(b);
  const rows: ComparisonEvidenceRow[] = [];
  for (const side of ["BLUE", "RED"] as const) {
    const team = b.teams[side];
    for (const role of ROSTER_ROLES) {
      const aRow = aRows.rows.find((row) => row.team_id === team.id && row.role === role)!;
      const bRow = bRows.rows.find((row) => row.team_id === team.id && row.role === role)!;
      const aPool = nextSetPool(aRow, loaded, aLocks), bPool = nextSetPool(bRow, loaded, bLocks);
      const player_changed = aRow.player_key !== bRow.player_key;
      const champion_changed = championKey(aRow.champion_id) !== championKey(bRow.champion_id);
      let newly_locked: string[] = [], reopened: string[] = [];
      if (!player_changed && aPool && bPool) {
        const aOpen = new Set(aPool.remaining.map((item) => championKey(item.champion_id)));
        const bOpen = new Set(bPool.remaining.map((item) => championKey(item.champion_id)));
        newly_locked = aPool.remaining.filter((item) => !bOpen.has(championKey(item.champion_id))).map((item) => item.champion_id);
        reopened = bPool.remaining.filter((item) => !aOpen.has(championKey(item.champion_id))).map((item) => item.champion_id);
      }
      rows.push({
        team_id: team.id, team_name: team.name, role, side_a: sideOf(a, team.id), side_b: side,
        a: { row: aRow, pool: aPool }, b: { row: bRow, pool: bPool },
        player_changed, champion_changed, newly_locked, reopened,
        changed: player_changed || champion_changed || newly_locked.length > 0 || reopened.length > 0 || (aPool?.available ?? null) !== (bPool?.available ?? null),
      });
    }
  }
  return { ok: true, rows };
}

// ---- Fixed Korean explanations ---------------------------------------------------------

const roleLabel: Record<RosterRole, string> = { TOP: "탑", JUNGLE: "정글", MID: "미드", BOTTOM: "바텀", SUPPORT: "서포터" };
const SHOWN_NAMES = 3;

function names(ids: readonly string[], nameOf: (id: string) => string) {
  if (!ids.length) return "없음";
  const shown = ids.slice(0, SHOWN_NAMES).map(nameOf).join(", ");
  return ids.length > SHOWN_NAMES ? `${shown} 외 ${ids.length - SHOWN_NAMES}개` : shown;
}

/** Annual count text of one side: unknown and role-0 stay distinct from an observed 0. */
export function annualText(side: SideEvidence) {
  const { row } = side;
  if (row.status === "EMPTY") return "선수 빈칸";
  if (row.status === "UNCONFIRMED") return "기록 확인 불가";
  if (row.status === "ZERO_IN_ROLE") return `${roleLabel[row.role]} 0경기`;
  const season = row.scopes!.season;
  return `연간 ${season.picks}/${season.games}경기`;
}

const poolText = (pool: NextSetPool | null) => pool ? `${pool.available}/${pool.observed_unique}종` : "확인 불가";

/**
 * Fixed-template Korean sentences for one row. Only names, raw counts and set differences are
 * stated; no advantage, win, proficiency or strength is inferred.
 */
export function explainRow(row: ComparisonEvidenceRow, nameOf: (id: string) => string): string[] {
  const role = roleLabel[row.role];
  const { a, b } = row;
  const lines: string[] = [];
  if (row.player_changed) {
    lines.push(`선수 ${a.row.player_name || "빈칸"} → ${b.row.player_name || "빈칸"}: 같은 ${role} 역할이지만 기록 대상 선수가 달라 아래 횟수는 서로 다른 선수의 표본입니다. 실력 비교가 아닙니다.`);
  }
  if (row.champion_changed || row.player_changed) {
    lines.push(`챔피언 ${nameOf(a.row.champion_id)} ${annualText(a)} → ${nameOf(b.row.champion_id)} ${annualText(b)}.`);
  } else {
    lines.push(`챔피언 ${nameOf(b.row.champion_id)} 동일 · ${annualText(b)}.`);
  }
  if (a.row.status === "OBSERVED" && b.row.status === "OBSERVED") {
    const delta = b.row.scopes!.season.picks - a.row.scopes!.season.picks;
    if (row.champion_changed || row.player_changed) lines.push(`연간 관측 횟수 차이 ${delta > 0 ? "+" : ""}${delta}회 (분모 ${a.row.scopes!.season.games}→${b.row.scopes!.season.games}경기, 원시 횟수).`);
  }
  lines.push(`다음 세트 남은 관측 챔피언 ${poolText(a.pool)} → ${poolText(b.pool)}${row.player_changed && a.pool && b.pool ? " (선수가 달라 관측 목록 자체가 다릅니다)" : ""}.`);
  if (row.newly_locked.length) lines.push(`B에서 다음 세트에 새로 잠김: ${names(row.newly_locked, nameOf)}.`);
  if (row.reopened.length) lines.push(`B에서 다음 세트에 다시 열림: ${names(row.reopened, nameOf)}.`);
  return lines;
}
