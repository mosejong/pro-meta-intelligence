export type RadarMetrics = {
  current_pick_count: number;
  prior_pick_count: number;
  current_pick_presence: number;
  prior_pick_presence: number;
  pick_presence_delta: number;
  current_distinct_team_count: number;
  prior_distinct_team_count: number;
  current_demand: number;
  prior_demand: number;
  demand_velocity: number;
  team_concentration: number | null;
  regional_divergence: number | null;
  most_divergent_region: string | null;
  most_divergent_region_delta: number | null;
};

export type RegionPresence = {
  region: string;
  match_count: number;
  pick_count: number;
  pick_presence: number;
  delta_from_global: number;
  sample_eligible: boolean;
};

export type RadarEntry = {
  rank: number;
  champion_id: string;
  role: string;
  eligible_for_review: boolean;
  quality_flags: string[];
  metrics: RadarMetrics;
  region_presence: RegionPresence[];
  evidence_event_ids: string[];
};

export type OpponentChampionTendency = {
  champion_id: string;
  role?: string;
  game_count: number;
  game_rate: number;
  phase_1_count: number;
  phase_2_count: number;
  evidence_event_ids: string[];
};

export type OpponentPlayerProfile = {
  player_id: string;
  player_name: string;
  role: string;
  roster_status?: "CURRENT" | "OTHER_OBSERVED";
  game_count: number;
  champions: Array<{
    champion_id: string;
    game_count: number;
    game_rate: number;
    evidence_event_ids: string[];
  }>;
  evidence_match_ids: string[];
};

export type OpponentRecentGame = {
  match_id: string;
  observed_at: string;
  league: string;
  tournament: string;
  side: string;
  opponent_team_id: string;
  opponent_team_name: string;
  result: "WIN" | "LOSS";
  first_pick: boolean;
  picks: Array<{
    champion_id: string;
    role: string;
    player_id: string | null;
    player_name: string | null;
    sequence: number;
    evidence_event_id: string;
  }>;
};

export type OpponentPatchChange = {
  champion_id: string;
  role: string;
  current_game_count: number;
  previous_game_count: number;
  current_game_rate: number;
  previous_game_rate: number;
  delta: number;
  evidence_event_ids: string[];
};

export type OpponentTeam = {
  team_id: string;
  team_name: string;
  team_name_aliases: string[];
  leagues: string[];
  game_count: number;
  win_count: number;
  win_rate: number;
  first_pick_count: number;
  first_pick_rate: number;
  side_stats: Record<string, { game_count: number; win_count: number; win_rate: number | null }>;
  priority_picks: OpponentChampionTendency[];
  frequent_bans: OpponentChampionTendency[];
  received_bans: OpponentChampionTendency[];
  first_rotations: Array<{
    side: string;
    champions: string[];
    game_count: number;
    evidence_match_ids: string[];
  }>;
  player_profiles?: OpponentPlayerProfile[];
  recent_games?: OpponentRecentGame[];
  patch_comparison?: {
    status: "OBSERVED" | "NO_BASELINE";
    previous_patch_id: string | null;
    previous_game_count: number;
    emerging: OpponentPatchChange[];
    cooling: OpponentPatchChange[];
  };
  series_tracking?: {
    provider_series_id_available: boolean;
    series_count: number | null;
    boundary: string;
  };
  quality_flags: string[];
  evidence: {
    match_ids: string[];
    draft_event_ids: string[];
    first_observed_at: string;
    last_observed_at: string;
  };
};

export type OpponentPrep = {
  schema_version: "1";
  artifact_type: "opponent-prep-pack";
  fixture_only: boolean;
  cutoff: string;
  patch_id: string;
  previous_patch_id?: string | null;
  team_count: number;
  config: {
    maximum_games_per_team: number;
    minimum_games_for_review: number;
    top_champions: number;
    profile_team_names?: string[];
  };
  boundary: string;
  formulae: Record<string, string>;
  evidence_index: {
    source_versions: Array<{ source_id: string; source_version: string; content_hash: string }>;
  };
  teams: OpponentTeam[];
};

export type ScheduleParticipant = {
  name: string;
  code: string;
};

export type ScheduleEvent = {
  event_id: string;
  start_at: string;
  league: string;
  block: string;
  best_of: number | null;
  participants: [ScheduleParticipant, ScheduleParticipant];
};

export type ScheduleSnapshot = {
  schema_version: "1";
  artifact_type: "pro-schedule-snapshot";
  source_id: string;
  source_url: string;
  retrieved_at: string;
  available_at: string;
  content_hash: string;
  locale: string;
  league_slugs: string[];
  events: ScheduleEvent[];
  quality: {
    event_count: number;
    tbd_participant_count: number;
  };
  boundary: string;
};

export type ScheduleChange = {
  change_id: string;
  detected_at: string;
  type: string;
  severity: "INFO" | "REVIEW" | "ACTION_REQUIRED";
  summary: string;
  correlation_method: "EVENT_ID" | "SAME_SLOT" | "SAME_CONFIRMED_OPPONENT" | "UNMATCHED";
  fields_changed: string[];
  previous_event: ScheduleEvent | null;
  current_event: ScheduleEvent | null;
};

export type ScheduleChangeLog = {
  schema_version: "1";
  artifact_type: "pro-schedule-change-log";
  source_id: string;
  watched_team: string;
  generated_at: string;
  previous_snapshot: { retrieved_at: string; content_hash: string } | null;
  current_snapshot: { retrieved_at: string; content_hash: string };
  latest_run: {
    status: "INITIALIZED" | "CHANGED" | "UNCHANGED";
    change_count: number;
    changes: ScheduleChange[];
  };
  history: ScheduleChange[];
  boundary: string;
};

export type HistoryStatus = {
  schema_version: "1";
  artifact_type: "oe-history-status";
  source_id: string;
  as_of: string | null;
  status: string;
  history_ready: boolean;
  benchmark_ready: boolean;
  gates: Array<{
    id: string;
    current: number;
    required: number;
    unit: string;
    passed: boolean;
  }>;
  blocking_reasons: string[];
  warnings: string[];
  next_action: string;
  aggregate: Record<string, unknown> | null;
  boundary: string;
};

export type RadarReport = {
  schema_version: "1";
  fixture_only: boolean;
  cutoff: string;
  patch_id: string;
  windows: {
    prior: { start_exclusive: string; end_inclusive: string; days: number; match_count: number; active_team_count: number };
    recent: { start_exclusive: string; end_inclusive: string; days: number; match_count: number; active_team_count: number };
  };
  thresholds: Record<string, number>;
  league_regions: Record<string, string>;
  quality: {
    unknown_leagues: string[];
    future_match_count_excluded: number;
    future_event_count_excluded: number;
    available_other_patch_or_window_match_count_excluded: number;
  };
  formulae: Record<string, string>;
  ranking_policy: string[];
  evidence_index: {
    prior_match_ids: string[];
    recent_match_ids: string[];
    source_versions: Array<{ source_id: string; source_version: string; content_hash: string }>;
  };
  publication_readiness?: {
    ready_for_radar: boolean;
    blocking_reasons: string[];
    warnings: string[];
    selected_patch_import_quality: {
      patch_id: string;
      imported_game_count: number;
      known_exclusion_game_count: number;
      blocking_issue_game_count: number;
      discovered_game_count: number;
      issue_counts: Record<string, number>;
    } | null;
  };
  history_status?: HistoryStatus;
  opponent_prep?: OpponentPrep;
  entries: RadarEntry[];
};

export function isRadarReport(value: unknown): value is RadarReport {
  if (!isRecord(value)) return false;
  const report = value as Partial<RadarReport>;
  if (
    report.schema_version !== "1" ||
    typeof report.fixture_only !== "boolean" ||
    typeof report.cutoff !== "string" ||
    typeof report.patch_id !== "string" ||
    !isRecord(report.windows) ||
    !isWindow(report.windows.prior) ||
    !isWindow(report.windows.recent) ||
    !isRecord(report.quality) ||
    !Array.isArray(report.quality.unknown_leagues) ||
    !isRecord(report.formulae) ||
    !isRecord(report.evidence_index) ||
    !Array.isArray(report.evidence_index.prior_match_ids) ||
    !Array.isArray(report.evidence_index.recent_match_ids) ||
    !Array.isArray(report.evidence_index.source_versions) ||
    !Array.isArray(report.entries)
  ) return false;
  if (report.publication_readiness !== undefined && !isPublicationReadiness(report.publication_readiness)) return false;
  if (report.history_status !== undefined && !isHistoryStatus(report.history_status)) return false;
  if (report.opponent_prep !== undefined && !isOpponentPrep(report.opponent_prep)) return false;
  return report.entries.every(isRadarEntry);
}

export function isHistoryStatus(value: unknown): value is HistoryStatus {
  if (!isRecord(value)) return false;
  return (
    value.schema_version === "1" &&
    value.artifact_type === "oe-history-status" &&
    typeof value.source_id === "string" &&
    (value.as_of === null || typeof value.as_of === "string") &&
    typeof value.status === "string" &&
    typeof value.history_ready === "boolean" &&
    typeof value.benchmark_ready === "boolean" &&
    Array.isArray(value.gates) && value.gates.every(isHistoryGate) &&
    Array.isArray(value.blocking_reasons) && value.blocking_reasons.every((item) => typeof item === "string") &&
    Array.isArray(value.warnings) && value.warnings.every((item) => typeof item === "string") &&
    typeof value.next_action === "string" &&
    (value.aggregate === null || isRecord(value.aggregate)) &&
    typeof value.boundary === "string"
  );
}

export function isScheduleSnapshot(value: unknown): value is ScheduleSnapshot {
  if (!isRecord(value) || !isRecord(value.quality)) return false;
  return (
    value.schema_version === "1" &&
    value.artifact_type === "pro-schedule-snapshot" &&
    typeof value.source_id === "string" &&
    typeof value.source_url === "string" &&
    typeof value.retrieved_at === "string" &&
    typeof value.available_at === "string" &&
    typeof value.content_hash === "string" &&
    typeof value.locale === "string" &&
    Array.isArray(value.league_slugs) && value.league_slugs.every((item) => typeof item === "string") &&
    Array.isArray(value.events) && value.events.every(isScheduleEvent) &&
    typeof value.quality.event_count === "number" &&
    typeof value.quality.tbd_participant_count === "number" &&
    typeof value.boundary === "string"
  );
}

export function isScheduleChangeLog(value: unknown): value is ScheduleChangeLog {
  if (!isRecord(value) || !isRecord(value.current_snapshot) || !isRecord(value.latest_run)) {
    return false;
  }
  return (
    value.schema_version === "1" &&
    value.artifact_type === "pro-schedule-change-log" &&
    typeof value.source_id === "string" &&
    typeof value.watched_team === "string" &&
    typeof value.generated_at === "string" &&
    (value.previous_snapshot === null || isScheduleSnapshotReference(value.previous_snapshot)) &&
    isScheduleSnapshotReference(value.current_snapshot) &&
    (value.latest_run.status === "INITIALIZED" || value.latest_run.status === "CHANGED" || value.latest_run.status === "UNCHANGED") &&
    typeof value.latest_run.change_count === "number" &&
    Array.isArray(value.latest_run.changes) && value.latest_run.changes.every(isScheduleChange) &&
    Array.isArray(value.history) && value.history.every(isScheduleChange) &&
    typeof value.boundary === "string"
  );
}

function isScheduleSnapshotReference(value: unknown) {
  return Boolean(
    isRecord(value) &&
    typeof value.retrieved_at === "string" &&
    typeof value.content_hash === "string"
  );
}

function isScheduleChange(value: unknown) {
  if (!isRecord(value)) return false;
  return (
    typeof value.change_id === "string" &&
    typeof value.detected_at === "string" &&
    typeof value.type === "string" &&
    (value.severity === "INFO" || value.severity === "REVIEW" || value.severity === "ACTION_REQUIRED") &&
    typeof value.summary === "string" &&
    (value.correlation_method === "EVENT_ID" || value.correlation_method === "SAME_SLOT" || value.correlation_method === "SAME_CONFIRMED_OPPONENT" || value.correlation_method === "UNMATCHED") &&
    Array.isArray(value.fields_changed) && value.fields_changed.every((item) => typeof item === "string") &&
    (value.previous_event === null || isScheduleEvent(value.previous_event)) &&
    (value.current_event === null || isScheduleEvent(value.current_event))
  );
}

function isScheduleEvent(value: unknown) {
  return Boolean(
    isRecord(value) &&
    typeof value.event_id === "string" &&
    typeof value.start_at === "string" &&
    typeof value.league === "string" &&
    typeof value.block === "string" &&
    (value.best_of === null || typeof value.best_of === "number") &&
    Array.isArray(value.participants) && value.participants.length === 2 &&
    value.participants.every((participant) => (
      isRecord(participant) &&
      typeof participant.name === "string" &&
      typeof participant.code === "string"
    ))
  );
}

function isHistoryGate(value: unknown) {
  return Boolean(
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.current === "number" &&
    typeof value.required === "number" &&
    typeof value.unit === "string" &&
    typeof value.passed === "boolean",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isWindow(value: unknown) {
  if (!isRecord(value)) return false;
  return typeof value.days === "number" && typeof value.match_count === "number" && typeof value.active_team_count === "number";
}

function isRadarEntry(value: unknown) {
  if (!isRecord(value) || !isRecord(value.metrics)) return false;
  const metrics = value.metrics;
  const numericMetrics = [
    "current_pick_count", "prior_pick_count", "current_pick_presence", "prior_pick_presence",
    "pick_presence_delta", "current_distinct_team_count", "prior_distinct_team_count",
    "current_demand", "prior_demand", "demand_velocity",
  ];
  return (
    typeof value.rank === "number" &&
    typeof value.champion_id === "string" &&
    typeof value.role === "string" &&
    typeof value.eligible_for_review === "boolean" &&
    Array.isArray(value.quality_flags) && value.quality_flags.every((item) => typeof item === "string") &&
    numericMetrics.every((name) => typeof metrics[name] === "number") &&
    isNullableNumber(metrics.team_concentration) &&
    isNullableNumber(metrics.regional_divergence) &&
    isNullableNumber(metrics.most_divergent_region_delta) &&
    (metrics.most_divergent_region === null || typeof metrics.most_divergent_region === "string") &&
    Array.isArray(value.region_presence) && value.region_presence.every(isRegionPresence) &&
    Array.isArray(value.evidence_event_ids) && value.evidence_event_ids.every((item) => typeof item === "string")
  );
}

function isRegionPresence(value: unknown) {
  return Boolean(
    isRecord(value) &&
    typeof value.region === "string" &&
    typeof value.match_count === "number" &&
    typeof value.pick_count === "number" &&
    typeof value.pick_presence === "number" &&
    typeof value.delta_from_global === "number" &&
    typeof value.sample_eligible === "boolean",
  );
}

function isNullableNumber(value: unknown) {
  return value === null || typeof value === "number";
}

function isPublicationReadiness(value: unknown) {
  if (!isRecord(value)) return false;
  if (
    typeof value.ready_for_radar !== "boolean" ||
    !Array.isArray(value.blocking_reasons) ||
    !value.blocking_reasons.every((item) => typeof item === "string") ||
    !Array.isArray(value.warnings) ||
    !value.warnings.every((item) => typeof item === "string")
  ) return false;
  if (value.selected_patch_import_quality === null) return true;
  if (!isRecord(value.selected_patch_import_quality)) return false;
  const quality = value.selected_patch_import_quality;
  return (
    typeof quality.patch_id === "string" &&
    typeof quality.imported_game_count === "number" &&
    typeof quality.known_exclusion_game_count === "number" &&
    typeof quality.blocking_issue_game_count === "number" &&
    typeof quality.discovered_game_count === "number" &&
    isRecord(quality.issue_counts) &&
    Object.values(quality.issue_counts).every((count) => typeof count === "number")
  );
}

function isOpponentPrep(value: unknown) {
  if (!isRecord(value)) return false;
  if (
    value.schema_version !== "1" ||
    value.artifact_type !== "opponent-prep-pack" ||
    typeof value.fixture_only !== "boolean" ||
    typeof value.cutoff !== "string" ||
    typeof value.patch_id !== "string" ||
    !(value.previous_patch_id === undefined || value.previous_patch_id === null || typeof value.previous_patch_id === "string") ||
    typeof value.team_count !== "number" ||
    !isRecord(value.config) ||
    typeof value.config.maximum_games_per_team !== "number" ||
    typeof value.config.minimum_games_for_review !== "number" ||
    typeof value.config.top_champions !== "number" ||
    !(value.config.profile_team_names === undefined || Array.isArray(value.config.profile_team_names) && value.config.profile_team_names.every((item) => typeof item === "string")) ||
    typeof value.boundary !== "string" ||
    !isRecord(value.formulae) ||
    !isRecord(value.evidence_index) ||
    !Array.isArray(value.evidence_index.source_versions) ||
    !Array.isArray(value.teams)
  ) return false;
  return value.team_count === value.teams.length && value.teams.every(isOpponentTeam);
}

function isOpponentTeam(team: unknown) {
  if (!isRecord(team)) return false;
  if (!(
    isRecord(team) &&
    typeof team.team_id === "string" &&
    typeof team.team_name === "string" &&
    Array.isArray(team.team_name_aliases) && team.team_name_aliases.every((item) => typeof item === "string") &&
    typeof team.game_count === "number" &&
    typeof team.win_count === "number" &&
    typeof team.win_rate === "number" &&
    typeof team.first_pick_count === "number" &&
    typeof team.first_pick_rate === "number" &&
    Array.isArray(team.leagues) && team.leagues.every((item) => typeof item === "string") &&
    Array.isArray(team.priority_picks) && team.priority_picks.every(isOpponentTendency) &&
    Array.isArray(team.frequent_bans) && team.frequent_bans.every(isOpponentTendency) &&
    Array.isArray(team.received_bans) && team.received_bans.every(isOpponentTendency) &&
    Array.isArray(team.first_rotations) && team.first_rotations.every(isOpponentRotation) &&
    (team.player_profiles === undefined || Array.isArray(team.player_profiles) && team.player_profiles.every(isOpponentPlayerProfile)) &&
    (team.recent_games === undefined || Array.isArray(team.recent_games) && team.recent_games.every(isOpponentRecentGame)) &&
    (team.patch_comparison === undefined || isOpponentPatchComparison(team.patch_comparison)) &&
    (team.series_tracking === undefined || isOpponentSeriesTracking(team.series_tracking)) &&
    Array.isArray(team.quality_flags) && team.quality_flags.every((item) => typeof item === "string") &&
    isRecord(team.side_stats) &&
    isRecord(team.evidence) &&
    Array.isArray(team.evidence.match_ids) && team.evidence.match_ids.every((item) => typeof item === "string") &&
    Array.isArray(team.evidence.draft_event_ids) && team.evidence.draft_event_ids.every((item) => typeof item === "string") &&
    typeof team.evidence.first_observed_at === "string" &&
    typeof team.evidence.last_observed_at === "string"
  )) return false;
  return ["BLUE", "RED"].every((side) => {
    const stat = team.side_stats[side];
    return Boolean(
      isRecord(stat) &&
      typeof stat.game_count === "number" &&
      typeof stat.win_count === "number" &&
      isNullableNumber(stat.win_rate)
    );
  });
}

function isOpponentTendency(value: unknown) {
  return Boolean(
    isRecord(value) &&
    typeof value.champion_id === "string" &&
    (value.role === undefined || typeof value.role === "string") &&
    typeof value.game_count === "number" &&
    typeof value.game_rate === "number" &&
    typeof value.phase_1_count === "number" &&
    typeof value.phase_2_count === "number" &&
    Array.isArray(value.evidence_event_ids) &&
    value.evidence_event_ids.every((item) => typeof item === "string")
  );
}

function isOpponentRotation(value: unknown) {
  return Boolean(
    isRecord(value) &&
    typeof value.side === "string" &&
    Array.isArray(value.champions) && value.champions.every((item) => typeof item === "string") &&
    typeof value.game_count === "number" &&
    Array.isArray(value.evidence_match_ids) &&
    value.evidence_match_ids.every((item) => typeof item === "string")
  );
}

function isOpponentPlayerProfile(value: unknown) {
  return Boolean(
    isRecord(value) &&
    typeof value.player_id === "string" &&
    typeof value.player_name === "string" &&
    typeof value.role === "string" &&
    (value.roster_status === undefined || value.roster_status === "CURRENT" || value.roster_status === "OTHER_OBSERVED") &&
    typeof value.game_count === "number" &&
    Array.isArray(value.champions) && value.champions.every((champion) => (
      isRecord(champion) &&
      typeof champion.champion_id === "string" &&
      typeof champion.game_count === "number" &&
      typeof champion.game_rate === "number" &&
      Array.isArray(champion.evidence_event_ids) && champion.evidence_event_ids.every((item) => typeof item === "string")
    )) &&
    Array.isArray(value.evidence_match_ids) && value.evidence_match_ids.every((item) => typeof item === "string")
  );
}

function isOpponentRecentGame(value: unknown) {
  return Boolean(
    isRecord(value) &&
    typeof value.match_id === "string" &&
    typeof value.observed_at === "string" &&
    typeof value.league === "string" &&
    typeof value.tournament === "string" &&
    typeof value.side === "string" &&
    typeof value.opponent_team_id === "string" &&
    typeof value.opponent_team_name === "string" &&
    (value.result === "WIN" || value.result === "LOSS") &&
    typeof value.first_pick === "boolean" &&
    Array.isArray(value.picks) && value.picks.every((pick) => (
      isRecord(pick) &&
      typeof pick.champion_id === "string" &&
      typeof pick.role === "string" &&
      (pick.player_id === null || typeof pick.player_id === "string") &&
      (pick.player_name === null || typeof pick.player_name === "string") &&
      typeof pick.sequence === "number" &&
      typeof pick.evidence_event_id === "string"
    ))
  );
}

function isOpponentPatchChange(value: unknown) {
  return Boolean(
    isRecord(value) &&
    typeof value.champion_id === "string" &&
    typeof value.role === "string" &&
    typeof value.current_game_count === "number" &&
    typeof value.previous_game_count === "number" &&
    typeof value.current_game_rate === "number" &&
    typeof value.previous_game_rate === "number" &&
    typeof value.delta === "number" &&
    Array.isArray(value.evidence_event_ids) && value.evidence_event_ids.every((item) => typeof item === "string")
  );
}

function isOpponentPatchComparison(value: unknown) {
  return Boolean(
    isRecord(value) &&
    (value.status === "OBSERVED" || value.status === "NO_BASELINE") &&
    (value.previous_patch_id === null || typeof value.previous_patch_id === "string") &&
    typeof value.previous_game_count === "number" &&
    Array.isArray(value.emerging) && value.emerging.every(isOpponentPatchChange) &&
    Array.isArray(value.cooling) && value.cooling.every(isOpponentPatchChange)
  );
}

function isOpponentSeriesTracking(value: unknown) {
  return Boolean(
    isRecord(value) &&
    typeof value.provider_series_id_available === "boolean" &&
    (value.series_count === null || typeof value.series_count === "number") &&
    typeof value.boundary === "string"
  );
}
