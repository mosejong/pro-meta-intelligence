import type { RadarReport } from "./radar-types";

const baseRegion = [
  { region: "EMEA", match_count: 2, pick_count: 0, pick_presence: 0, delta_from_global: -0.5, sample_eligible: true },
  { region: "KOREA", match_count: 2, pick_count: 2, pick_presence: 1, delta_from_global: 0.5, sample_eligible: true },
];

export const sampleReport: RadarReport = {
  schema_version: "1",
  fixture_only: true,
  cutoff: "2026-08-15T12:00:00+00:00",
  patch_id: "16.14",
  windows: {
    prior: { start_exclusive: "2026-08-01T12:00:00+00:00", end_inclusive: "2026-08-08T12:00:00+00:00", days: 7, match_count: 4, active_team_count: 8 },
    recent: { start_exclusive: "2026-08-08T12:00:00+00:00", end_inclusive: "2026-08-15T12:00:00+00:00", days: 7, match_count: 4, active_team_count: 8 },
  },
  thresholds: { minimum_recent_matches: 4, minimum_prior_matches: 4, minimum_region_matches: 2, minimum_current_picks: 2 },
  league_regions: { LCK: "KOREA", LEC: "EMEA" },
  quality: { unknown_leagues: [], future_match_count_excluded: 0, future_event_count_excluded: 1, available_other_patch_or_window_match_count_excluded: 0 },
  formulae: {
    pick_presence: "unique matches containing champion-role pick / window matches",
    pick_presence_delta: "recent pick presence - prior pick presence",
    demand: "distinct teams picking champion-role / active teams in window",
    demand_velocity: "recent demand - prior demand",
    team_concentration: "largest team champion-role pick count / all recent champion-role picks",
    regional_divergence: "max(abs(eligible-region pick presence - global pick presence))",
  },
  ranking_policy: ["eligible_for_review first", "demand_velocity descending", "pick_presence_delta descending", "regional_divergence descending", "current_pick_presence descending", "champion_id and role ascending for deterministic ties"],
  evidence_index: {
    prior_match_ids: ["p-eu-1", "p-eu-2", "p-kr-1", "p-kr-2"],
    recent_match_ids: ["r-eu-1", "r-eu-2", "r-kr-1", "r-kr-2"],
    source_versions: [{ source_id: "synthetic-meta-radar-v1", source_version: "v1", content_hash: "fixture:meta-radar-v1" }],
  },
  entries: [
    {
      rank: 1, champion_id: "RekSai", role: "JUNGLE", eligible_for_review: true, quality_flags: [],
      metrics: { current_pick_count: 2, prior_pick_count: 0, current_pick_presence: 0.5, prior_pick_presence: 0, pick_presence_delta: 0.5, current_distinct_team_count: 2, prior_distinct_team_count: 0, current_demand: 0.25, prior_demand: 0, demand_velocity: 0.25, team_concentration: 0.5, regional_divergence: 0.5, most_divergent_region: "KOREA", most_divergent_region_delta: 0.5 },
      region_presence: baseRegion,
      evidence_event_ids: ["r-kr-1:RekSai:1", "r-kr-2:RekSai:1"],
    },
    {
      rank: 2, champion_id: "Mundo", role: "JUNGLE", eligible_for_review: true, quality_flags: [],
      metrics: { current_pick_count: 2, prior_pick_count: 1, current_pick_presence: 0.5, prior_pick_presence: 0.25, pick_presence_delta: 0.25, current_distinct_team_count: 2, prior_distinct_team_count: 1, current_demand: 0.25, prior_demand: 0.125, demand_velocity: 0.125, team_concentration: 0.5, regional_divergence: 0.5, most_divergent_region: "EMEA", most_divergent_region_delta: 0.5 },
      region_presence: [{ ...baseRegion[0], pick_count: 2, pick_presence: 1, delta_from_global: 0.5 }, { ...baseRegion[1], pick_count: 0, pick_presence: 0, delta_from_global: -0.5 }],
      evidence_event_ids: ["p-eu-1:Mundo:1", "r-eu-1:Mundo:1", "r-eu-2:Mundo:1"],
    },
    {
      rank: 3, champion_id: "Zyra", role: "JUNGLE", eligible_for_review: false, quality_flags: ["LOW_CURRENT_PICK_COUNT"],
      metrics: { current_pick_count: 1, prior_pick_count: 2, current_pick_presence: 0.25, prior_pick_presence: 0.5, pick_presence_delta: -0.25, current_distinct_team_count: 1, prior_distinct_team_count: 2, current_demand: 0.125, prior_demand: 0.25, demand_velocity: -0.125, team_concentration: 1, regional_divergence: 0.25, most_divergent_region: "KOREA", most_divergent_region_delta: 0.25 },
      region_presence: [{ ...baseRegion[0], delta_from_global: -0.25 }, { ...baseRegion[1], pick_count: 1, pick_presence: 0.5, delta_from_global: 0.25 }],
      evidence_event_ids: ["p-eu-1:Zyra:2", "p-kr-1:Zyra:1", "r-kr-1:Zyra:2"],
    },
  ],
};
