import { ROSTER_ROLES, type RosterRole } from "./roster-scenario";
import type { SeasonCard, SeasonCardCatalog, SeasonSlots } from "./season-player-cards";

/**
 * "역할별 최다 출전 구성": per observed team (source_id + season + team_id, never merged by name),
 * the card with the largest game_count in each role. Sample size is not strength, and this is not
 * an official starting lineup. Ties, empty roles and one player in two roles are rejected, never guessed.
 */
export type SeasonTeamPresetStatus = "READY" | "INCOMPLETE" | "TIED" | "DUPLICATE_PLAYER";
export type SeasonTeamPreset = {
  key: string; source_id: string; season: number; team_id: string;
  /** Original spellings as recorded on the team's cards (exact strings, deduplicated). */
  team_names: string[];
  /** Chosen card per role; null when the role is empty or tied. */
  picks: Record<RosterRole, SeasonCard | null>;
  status: SeasonTeamPresetStatus;
  emptyRoles: RosterRole[]; tiedRoles: RosterRole[];
};
const teamKey = (c: Pick<SeasonCard, "source_id" | "season" | "team_id">) => JSON.stringify([c.source_id, c.season, c.team_id]);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Teams observed in one season, in an order independent of catalog card order. Input is not mutated. */
export function observedSeasonTeams(catalog: SeasonCardCatalog, season: number): SeasonTeamPreset[] {
  const groups = new Map<string, SeasonCard[]>();
  for (const card of catalog.cards) {
    if (card.season !== season) continue;
    const key = teamKey(card);
    const list = groups.get(key);
    if (list) list.push(card); else groups.set(key, [card]);
  }
  const teams: SeasonTeamPreset[] = [];
  for (const [key, cards] of groups) {
    const { source_id, team_id } = cards[0];
    const picks = { TOP: null, JUNGLE: null, MID: null, BOTTOM: null, SUPPORT: null } as Record<RosterRole, SeasonCard | null>;
    const emptyRoles: RosterRole[] = [], tiedRoles: RosterRole[] = [];
    for (const role of ROSTER_ROLES) {
      const inRole = cards.filter(c => c.role === role);
      if (!inRole.length) { emptyRoles.push(role); continue; }
      const max = Math.max(...inRole.map(c => c.game_count));
      const top = inRole.filter(c => c.game_count === max);
      if (top.length > 1) tiedRoles.push(role); else picks[role] = top[0];
    }
    const chosen = ROSTER_ROLES.map(r => picks[r]).filter((c): c is SeasonCard => !!c);
    const duplicate = new Set(chosen.map(c => c.player_id)).size !== chosen.length;
    const status: SeasonTeamPresetStatus = emptyRoles.length ? "INCOMPLETE" : tiedRoles.length ? "TIED" : duplicate ? "DUPLICATE_PLAYER" : "READY";
    const team_names = [...new Set(cards.flatMap(c => c.team_names))].sort(cmp);
    teams.push({ key, source_id, season, team_id, team_names, picks, status, emptyRoles, tiedRoles });
  }
  return teams.sort((a, b) => cmp(a.team_names[0] ?? "", b.team_names[0] ?? "") || cmp(a.team_id, b.team_id) || cmp(a.source_id, b.source_id));
}

const roleKo: Record<RosterRole, string> = { TOP: "탑", JUNGLE: "정글", MID: "미드", BOTTOM: "바텀", SUPPORT: "서포터" };
export function presetBlockReason(team: SeasonTeamPreset): string | null {
  if (team.status === "INCOMPLETE") return `${team.emptyRoles.map(r => roleKo[r]).join("·")} 기록이 없어 한 번에 배정할 수 없습니다. 역할별로 직접 골라 주세요.`;
  if (team.status === "TIED") return `${team.tiedRoles.map(r => roleKo[r]).join("·")} 최다 출전이 동률이라 임의로 고르지 않습니다. 역할별로 직접 골라 주세요.`;
  if (team.status === "DUPLICATE_PLAYER") return "같은 선수가 두 역할의 최다 출전이라 한 번에 배정할 수 없습니다. 역할별로 직접 골라 주세요.";
  return null;
}

/** Exact refs for all five roles, or an error. Re-checks that every card belongs to the same source/season/team. */
export function seasonPresetSlots(team: SeasonTeamPreset, catalog: SeasonCardCatalog): { ok: true; slots: SeasonSlots } | { ok: false; error: string } {
  const blocked = presetBlockReason(team);
  if (blocked) return { ok: false, error: blocked };
  const slots = {} as SeasonSlots, players = new Set<string>();
  for (const role of ROSTER_ROLES) {
    const pick = team.picks[role];
    const card = pick && catalog.cards.find(c => c.id === pick.id && c.player_id === pick.player_id && c.role === role);
    if (!card || teamKey(card) !== team.key || card.source_id !== team.source_id || card.season !== team.season || card.team_id !== team.team_id) return { ok: false, error: "구성 카드가 같은 시즌·팀 기록으로 확인되지 않아 적용하지 않았습니다." };
    if (players.has(card.player_id)) return { ok: false, error: "같은 선수가 두 역할에 있어 적용하지 않았습니다." };
    players.add(card.player_id);
    slots[role] = { catalog_id: catalog.catalog_id, card_id: card.id, player_id: card.player_id };
  }
  return { ok: true, slots };
}
