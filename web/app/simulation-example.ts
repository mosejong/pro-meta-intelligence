import { applyDraftSelection, draftSequence, type DraftSelection, type DraftSide } from "./draft-agent";
import type { OpponentTeam, RadarReport } from "./radar-types";
import type { LiveRoster } from "./roster-comparison";
import { basisKey, pairKey, rosterBasis, ROSTER_ROLES, type RosterRole } from "./roster-scenario";
import { SHARE_CHAMPIONS } from "./share-champion-ids";
import { buildSimulationReadiness, type SimulationInputSnapshot } from "./simulation-scenario";

/**
 * Authored example input for a first assumption experiment.
 *
 * A fixed, hand-written ban/pick list and an explicit role assignment, applied to the two teams the
 * user selected and their unchanged current roster. It is not an official match, a team strategy, a
 * meta recommendation or a player-ability signal. The result is only accepted when the existing
 * simulation readiness check passes on it; nothing here runs the model, the recommender or explain.
 */

/** Champion per role for the team playing each side (Data Dragon asset IDs). */
export const EXAMPLE_PICKS: Readonly<Record<DraftSide, Readonly<Record<RosterRole, string>>>> = {
  BLUE: { TOP: "Gnar", JUNGLE: "LeeSin", MID: "Orianna", BOTTOM: "Jinx", SUPPORT: "Leona" },
  RED: { TOP: "Renekton", JUNGLE: "Vi", MID: "Ahri", BOTTOM: "Ashe", SUPPORT: "Nautilus" },
};
/** Bans of each side by ban slot 1–5. Disjoint from the picks. */
export const EXAMPLE_BANS: Readonly<Record<DraftSide, readonly string[]>> = {
  BLUE: ["Akali", "Azir", "Caitlyn", "Draven", "Ezreal"],
  RED: ["Gwen", "Jax", "Kalista", "Lucian", "Rumble"],
};

export type SimulationExampleInput = {
  report: RadarReport;
  blueTeam: OpponentTeam | null;
  redTeam: OpponentTeam | null;
  firstPickSide: DraftSide;
  roster: LiveRoster | null;
  /** Past-season players on the current roster: never experiment input. */
  hasHistoricalPlayers?: boolean;
};
export type SimulationExample =
  | { ok: true; selections: DraftSelection[]; roles: Record<string, Record<RosterRole, string>>; snapshot: SimulationInputSnapshot }
  | { ok: false; message: string };

const SHARE_IDS = new Set(SHARE_CHAMPIONS.map(([, id]) => id));

/** Every example ID is a known champion asset and none repeats. */
export function exampleChampionsValid() {
  const all = [...Object.values(EXAMPLE_PICKS.BLUE), ...Object.values(EXAMPLE_PICKS.RED), ...EXAMPLE_BANS.BLUE, ...EXAMPLE_BANS.RED];
  return all.length === 20 && new Set(all.map((id) => id.toLowerCase())).size === 20 && all.every((id) => SHARE_IDS.has(id));
}

export type ExampleGuard = {
  /** Parent `canSelect` (session ready, not importing, both teams chosen, data loaded). */
  canSelect: boolean;
  roomActive: boolean;
  selections: number;
  games: number;
  pendingChampion: boolean;
  hasHistoricalPlayers: boolean;
};

/** Shared by the button and the parent handler: null when the example may be applied now. */
export function exampleBlockReason(guard: ExampleGuard): string | null {
  if (guard.roomActive) return "친구와 함께하는 방에서는 예시를 쓸 수 없습니다.";
  if (!guard.canSelect) return "자료와 저장 상태를 준비하는 중입니다.";
  if (guard.hasHistoricalPlayers) return "과거 시즌 선수가 있는 구성은 가정 실험 입력이 아닙니다.";
  if (guard.games > 0) return "이전 세트가 있어 예시를 쓸 수 없습니다. 새 시리즈에서만 쓸 수 있습니다.";
  if (guard.selections > 0 || guard.pendingChampion) return "진행 중인 밴픽이 있어 덮어쓰지 않습니다. 빈 첫 세트에서만 쓸 수 있습니다.";
  return null;
}

/**
 * Build the example for the selected pair. Pure: the inputs are neither changed nor frozen, the
 * returned selections/roles are fresh and separate from the (frozen) readiness snapshot. The
 * snapshot is only for showing and checking the preview; the parent never publishes it.
 */
export function buildSimulationExample(input: SimulationExampleInput): SimulationExample {
  const { report, blueTeam, redTeam, firstPickSide, roster } = input;
  if (input.hasHistoricalPlayers) return { ok: false, message: "과거 시즌 선수가 있는 구성은 가정 실험 입력이 아닙니다." };
  if (firstPickSide !== "BLUE" && firstPickSide !== "RED") return { ok: false, message: "첫 선택 진영이 올바르지 않습니다." };
  if (!blueTeam || !redTeam) return { ok: false, message: "블루·레드 팀을 먼저 선택하세요." };
  if (blueTeam.team_id === redTeam.team_id) return { ok: false, message: "서로 다른 두 팀을 선택하세요." };
  const teams = report.opponent_prep?.teams ?? [];
  if (![blueTeam, redTeam].every((team) => teams.some((known) => known.team_id === team.team_id))) {
    return { ok: false, message: "선택한 팀이 현재 자료에 없습니다." };
  }
  if (!roster) return { ok: false, message: "현재 선수 구성이 아직 준비되지 않았습니다. 선수 구성 탭에서 두 팀을 확인하세요." };
  if (basisKey(roster.basis) !== basisKey(rosterBasis(report)) || pairKey(roster.teamIds) !== pairKey([blueTeam.team_id, redTeam.team_id])) {
    return { ok: false, message: "현재 선수 구성이 이 자료·두 팀과 맞지 않습니다. 선수 구성 탭에서 두 팀을 확인하세요." };
  }
  if (!exampleChampionsValid()) return { ok: false, message: "예시 챔피언 목록이 올바르지 않습니다." };

  // Same rules path as manual play: every turn goes through applyDraftSelection in sequence order.
  let selections: DraftSelection[] = [];
  for (const turn of draftSequence(firstPickSide)) {
    const id = turn.kind === "PICK" ? EXAMPLE_PICKS[turn.side][ROSTER_ROLES[turn.slot - 1]] : EXAMPLE_BANS[turn.side][turn.slot - 1];
    const next = applyDraftSelection(selections, id, [], firstPickSide);
    if (next.length !== selections.length + 1) return { ok: false, message: "예시 밴픽을 규칙대로 채우지 못했습니다." };
    selections = next;
  }
  const roles = {
    [blueTeam.team_id]: { ...EXAMPLE_PICKS.BLUE },
    [redTeam.team_id]: { ...EXAMPLE_PICKS.RED },
  };
  // Readiness gets detached copies so its frozen snapshot never shares objects with the caller.
  const readiness = buildSimulationReadiness({
    report, blueTeam, redTeam, firstPickSide, games: [],
    selections: structuredClone(selections),
    roster: { basis: structuredClone(roster.basis), rosters: structuredClone(roster.rosters) },
    roles: structuredClone(roles),
  });
  if (!readiness.ok) {
    const empty = readiness.issues.filter((issue) => issue.code === "ROSTER_EMPTY_SLOT" && issue.teamId);
    if (empty.length) {
      const names = [...new Set(empty.map((issue) => issue.teamId === blueTeam.team_id ? blueTeam.team_name : redTeam.team_name))];
      return { ok: false, message: `현재 선수 구성에 빈 자리가 있습니다. 다른 선수로 자동으로 채우지 않습니다. 선수 구성 탭에서 ${names.join(", ")}을(를) 확인하세요.` };
    }
    return { ok: false, message: readiness.issues.map((issue) => issue.message).slice(0, 3).join(" ") };
  }
  return { ok: true, selections, roles, snapshot: readiness.snapshot };
}
