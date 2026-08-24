import type { MatchupBattlecard } from "./matchup-battlecard";
import type { OpponentPatchChange, OpponentPlayerProfile, OpponentRecentGame, OpponentTeam, RadarReport } from "./radar-types";

export type TargetProfile = {
  schema_version: "1";
  artifact_type: "team-target-profile";
  patch_id: string;
  cutoff: string;
  target: {
    team_id: string;
    team_name: string;
    leagues: string[];
    game_count: number;
    record: string;
    first_pick_rate: number;
  };
  focus: {
    priority_pick: { champion_id: string; role: string | null; game_rate: number } | null;
    frequent_ban: { champion_id: string; game_rate: number } | null;
    received_ban: { champion_id: string; game_rate: number } | null;
  };
  players: OpponentPlayerProfile[];
  recent_games: OpponentRecentGame[];
  patch_shift: {
    status: "OBSERVED" | "NO_BASELINE";
    previous_patch_id: string | null;
    previous_game_count: number;
    emerging: OpponentPatchChange[];
    cooling: OpponentPatchChange[];
  };
  series_tracking: {
    provider_series_id_available: boolean;
    series_count: number | null;
    boundary: string;
  };
  matchup: {
    own_team_id: string;
    own_team_name: string;
    protect_count: number;
    contested_count: number;
    deny_review_count: number;
    exchange_available: boolean;
    priority_score: number | null;
    staff_questions: string[];
  } | null;
  unknowns: string[];
  evidence: {
    match_ids: string[];
    draft_event_ids: string[];
    source_versions: Array<{ source_id: string; source_version: string; content_hash: string }>;
  };
  boundary: string;
};

const noSeriesBoundary = "공급자 데이터에 안정적인 시리즈 ID가 없어 경기를 임의로 시리즈로 묶지 않습니다.";

function unique(values: string[]) {
  return Array.from(new Set(values)).sort();
}

export function buildTargetProfile(
  report: RadarReport,
  target: OpponentTeam,
  battlecard?: MatchupBattlecard | null,
): TargetProfile {
  const comparison = target.patch_comparison ?? {
    status: "NO_BASELINE" as const,
    previous_patch_id: report.opponent_prep?.previous_patch_id ?? null,
    previous_game_count: 0,
    emerging: [],
    cooling: [],
  };
  const series = target.series_tracking ?? {
    provider_series_id_available: false,
    series_count: null,
    boundary: noSeriesBoundary,
  };
  const players = target.player_profiles ?? [];
  const recentGames = target.recent_games ?? [];
  const topPick = target.priority_picks[0];
  const topBan = target.frequent_bans[0];
  const receivedBan = target.received_bans[0];
  const matchupQuestions = battlecard
    ? unique([
      ...battlecard.protect.map((item) => item.staff_question),
      ...battlecard.contested.map((item) => item.staff_question),
      ...battlecard.deny_review.map((item) => item.staff_question),
      ...(battlecard.exchange ? [battlecard.exchange.staff_question] : []),
    ]).slice(0, 4)
    : [];

  return {
    schema_version: "1",
    artifact_type: "team-target-profile",
    patch_id: report.patch_id,
    cutoff: report.cutoff,
    target: {
      team_id: target.team_id,
      team_name: target.team_name,
      leagues: target.leagues,
      game_count: target.game_count,
      record: `${target.win_count}승 ${Math.max(0, target.game_count - target.win_count)}패`,
      first_pick_rate: target.first_pick_rate,
    },
    focus: {
      priority_pick: topPick ? { champion_id: topPick.champion_id, role: topPick.role ?? null, game_rate: topPick.game_rate } : null,
      frequent_ban: topBan ? { champion_id: topBan.champion_id, game_rate: topBan.game_rate } : null,
      received_ban: receivedBan ? { champion_id: receivedBan.champion_id, game_rate: receivedBan.game_rate } : null,
    },
    players,
    recent_games: recentGames,
    patch_shift: comparison,
    series_tracking: series,
    matchup: battlecard ? {
      own_team_id: battlecard.own_team.team_id,
      own_team_name: battlecard.own_team.team_name,
      protect_count: battlecard.protect.length,
      contested_count: battlecard.contested.length,
      deny_review_count: battlecard.deny_review.length,
      exchange_available: battlecard.exchange !== null,
      priority_score: battlecard.priority_context?.score ?? null,
      staff_questions: matchupQuestions,
    } : null,
    unknowns: [
      "공개 대회 기록은 현재 선수 컨디션이나 스크림 숙련도를 보여주지 않습니다.",
      "픽·밴 빈도만으로 T1의 다음 경기 의도를 추정하지 않습니다.",
      ...(series.provider_series_id_available ? [] : [noSeriesBoundary]),
    ],
    evidence: {
      match_ids: target.evidence.match_ids,
      draft_event_ids: unique([
        ...target.evidence.draft_event_ids,
        ...comparison.emerging.flatMap((item) => item.evidence_event_ids),
        ...comparison.cooling.flatMap((item) => item.evidence_event_ids),
      ]),
      source_versions: report.opponent_prep?.evidence_index.source_versions ?? report.evidence_index.source_versions,
    },
    boundary: "Public professional-match evidence for staff review; not a prediction of T1 draft intent or player readiness.",
  };
}

export function serializeTargetProfile(profile: TargetProfile) {
  return `${JSON.stringify(profile, null, 2)}\n`;
}
