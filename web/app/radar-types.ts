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
  return report.entries.every(isRadarEntry);
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
