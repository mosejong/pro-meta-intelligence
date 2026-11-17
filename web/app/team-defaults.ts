import type { OpponentTeam } from "./radar-types";

/**
 * Team-neutral, deterministic default ordering: no team name is special-cased.
 * The largest public sample comes first, then team name, then team ID as the tie-breaker,
 * so the result does not depend on feed order.
 */
export function compareTeamsForDefault(left: OpponentTeam, right: OpponentTeam) {
  return right.game_count - left.game_count
    || left.team_name.localeCompare(right.team_name, "en-US")
    || left.team_id.localeCompare(right.team_id, "en-US");
}

/** Opponent for `own`: never the same team; teams sharing a league with `own` come first. */
export function defaultOpponentFor(teams: OpponentTeam[], own: OpponentTeam | null) {
  const shares = (team: OpponentTeam) => Number(Boolean(own && team.leagues.some((league) => own.leagues.includes(league))));
  return teams
    .filter((team) => team.team_id !== own?.team_id)
    .sort((left, right) => shares(right) - shares(left) || compareTeamsForDefault(left, right))[0] ?? null;
}

/** Initial mock-draft matchup before the user (or a saved session) chooses teams. */
export function defaultDraftMatchup(teams: OpponentTeam[]) {
  const blue = teams.slice().sort(compareTeamsForDefault)[0] ?? null;
  return { blue, red: defaultOpponentFor(teams, blue) };
}
