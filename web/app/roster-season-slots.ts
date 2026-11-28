import type { RosterRole, RosterState } from "./roster-scenario";
import { resolveSeasonRef, type SeasonCardCatalog, type TeamSeasonSlots } from "./season-player-cards";

/**
 * Identity of a virtual-roster slot that holds a past-season player (roster-season-slots v1).
 *
 * Assigning a season player empties the current-player slot, so the current-snapshot views would
 * otherwise call it "빈칸". This names the season player instead and states the boundary: the current
 * publication's player evidence and annual records are never computed for it, and no current
 * roster player is substituted. Display only; nothing here feeds A/B, recommendation or simulation.
 *
 * - null: no season player in this slot (or a current player occupies it, which the lineup rules forbid).
 * - SEASON_UNRESOLVED: a reference is kept but the catalog is not loaded or no longer contains it.
 */
export type SeasonSlotIdentity =
  | { status: "SEASON"; card_id: string; player_name: string; season: number; role: RosterRole; game_count: number; team_names: string[] }
  | { status: "SEASON_UNRESOLVED" };

export type SeasonSlotInput = {
  lineups: TeamSeasonSlots;
  catalog: SeasonCardCatalog | null;
  rosters: RosterState;
  teamId: string;
  role: RosterRole;
};

/** Boundary shown next to a season slot in the current-snapshot evidence views. */
export const SEASON_SLOT_BOUNDARY = "시즌 기록은 ‘과거 시즌 선수로 구성하기’에서 확인 · 현재 발행본 선수 근거 미지원";

export const hasSeasonRef = (lineups: TeamSeasonSlots, teamId: string, role: RosterRole) =>
  Object.hasOwn(lineups, teamId) && !!lineups[teamId]?.[role];

export function seasonSlotIdentity({ lineups, catalog, rosters, teamId, role }: SeasonSlotInput): SeasonSlotIdentity | null {
  if (!hasSeasonRef(lineups, teamId, role) || rosters[teamId]?.[role]) return null;
  try {
    const card = resolveSeasonRef(lineups[teamId][role]!, role, catalog);
    return { status: "SEASON", card_id: card.id, player_name: card.player_name, season: card.season, role: card.role, game_count: card.game_count, team_names: [...card.team_names] };
  } catch { return { status: "SEASON_UNRESOLVED" }; }
}

/** "2015 MaRin · 시즌 선수", or a label that never names a (possibly wrong) player when unresolved. */
export const seasonSlotLabel = (identity: SeasonSlotIdentity) =>
  identity.status === "SEASON" ? `${identity.season} ${identity.player_name} · 시즌 선수` : "시즌 선수 배정됨 · 시즌 자료 미확인";

/**
 * Roster summary counts that keep season slots out of "빈칸": a slot without a current player is
 * either a season slot (it holds a season reference) or empty.
 */
export function rosterSlotCounts(slots: readonly { teamId: string; role: RosterRole; hasPlayer: boolean }[], lineups: TeamSeasonSlots) {
  let empty = 0, season = 0;
  for (const slot of slots) {
    if (slot.hasPlayer) continue;
    if (hasSeasonRef(lineups, slot.teamId, slot.role)) season += 1; else empty += 1;
  }
  return { empty, season };
}
