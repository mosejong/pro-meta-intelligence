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
  entries: RadarEntry[];
};

export function isRadarReport(value: unknown): value is RadarReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<RadarReport>;
  if (report.schema_version !== "1" || !Array.isArray(report.entries) || !report.windows) return false;
  return report.entries.every((entry) =>
    Boolean(
      entry &&
      typeof entry.champion_id === "string" &&
      typeof entry.role === "string" &&
      typeof entry.eligible_for_review === "boolean" &&
      entry.metrics &&
      typeof entry.metrics.current_pick_presence === "number" &&
      typeof entry.metrics.demand_velocity === "number" &&
      Array.isArray(entry.region_presence) &&
      Array.isArray(entry.evidence_event_ids),
    ),
  );
}
