import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, after, test } from "node:test";
import { CANDIDATE_COUNT, METHODS, clusterBootstrap, evaluateWalkForward, loadProductionApi } from "./draft-walk-forward-lib.mjs";

// Synthetic structure only: the published feed is a schema template, never evaluator input.
let vite, api, template, ids;
before(async () => {
  ({ vite, api } = await loadProductionApi());
  ids = api.SHARE_CHAMPIONS.map(([, id]) => id);
  template = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
});
after(async () => { await vite?.close(); });

const CUTOFF = "2026-08-24T00:00:00+00:00";
const HOLDOUT_CUTOFF = "2026-10-05T00:00:00+00:00";
const SPLITS = [
  { name: "DEV", start: "2026-01-01T00:00:00+00:00", end: "2026-07-01T00:00:00+00:00" },
  { name: "VALIDATION", start: "2026-07-01T00:00:00+00:00", end: "2026-09-01T00:00:00+00:00" },
  { name: "HOLDOUT", start: "2026-09-01T00:00:00+00:00", end: "2027-01-01T00:00:00+00:00" },
];
const minus24h = (iso) => new Date(Date.parse(iso) - 24 * 3600 * 1000).toISOString().replace(".000Z", "+00:00");
const tendency = (champion_id, role, game_rate) => ({ champion_id, role, game_rate, game_count: 4, phase_1_count: 2, phase_2_count: 0, evidence_event_ids: [`e-${champion_id}`] });

function snapshot(id, cutoff) {
  const report = structuredClone(template);
  report.fixture_only = true;
  report.opponent_prep.fixture_only = true;
  report.cutoff = cutoff;
  report.opponent_prep.cutoff = cutoff;
  report.opponent_prep.patch_id = report.patch_id;
  report.entries = [];
  report.opponent_prep.teams = report.opponent_prep.teams.slice(0, 2);
  report.opponent_prep.team_count = 2;
  const [blue, red] = report.opponent_prep.teams;
  const roles = ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"];
  blue.priority_picks = ids.slice(30, 36).map((c, i) => tendency(c, roles[i % 5], 0.9 - i / 10));
  red.priority_picks = ids.slice(40, 46).map((c, i) => tendency(c, roles[i % 5], 0.9 - i / 10));
  for (const team of [blue, red]) { team.recent_games = []; team.player_profiles = []; team.evidence = { ...team.evidence, match_ids: [] }; }
  report.evidence_index.prior_match_ids = [];
  report.evidence_index.recent_match_ids = [];
  const presence = ids.slice(0, 12).map((c, i) => ({ champion_id: c, picks: 12 - i, bans: i % 3 }));
  return { id, cutoff, evidence_played_at_or_before: minus24h(cutoff), patch_id: report.patch_id, presence, report };
}

function target(snap, { matchId, observedAt, split, order = ids.slice(0, 20), inspected = null, league = "TEST" }) {
  const [blue, red] = snap.report.opponent_prep.teams;
  let selections = [];
  for (const c of order) selections = api.applyDraftSelection(selections, c, [], "BLUE");
  return { snapshot_id: snap.id, split, inspected_window: inspected, match_id: matchId, game_number: 1, first_pick_side: "BLUE", league,
    patch_id: snap.patch_id, observed_at: observedAt, blue_team_id: blue.team_id, red_team_id: red.team_id, selections };
}

function dataset(extra = []) {
  const val = snapshot("val", CUTOFF);
  const hold = snapshot("hold", HOLDOUT_CUTOFF);
  const matches = [
    target(val, { matchId: "v1", observedAt: "2026-08-26T10:00:00+00:00", split: "VALIDATION" }),
    target(val, { matchId: "v2", observedAt: "2026-08-27T10:00:00+00:00", split: "VALIDATION", order: [...ids.slice(30, 50)] }),
    target(hold, { matchId: "h1", observedAt: "2026-10-06T10:00:00+00:00", split: "HOLDOUT" }),
    target(hold, { matchId: "h2", observedAt: "2026-10-07T10:00:00+00:00", split: "HOLDOUT", inspected: "SOME_EARLIER_STUDY" }),
    ...extra,
  ];
  return {
    schema_version: "1", artifact_type: "draft-walk-forward-dataset", protocol_id: "draft-rule-walk-forward-2026-11-23",
    fixture_only: true, scope: "FIRST_SET_WALK_FORWARD_WEEKLY",
    availability: { mode: "SIMULATED_FROM_PLAYED_TIME", lag_hours: 24, cutoff_rule: "Monday 00:00 UTC of the target match week" },
    splits: SPLITS, inspected_windows: [], claims: [],
    outcome_source: { content_hash: `sha256:${"a".repeat(64)}`, retrieved_at: "2026-11-18T01:35:30+00:00", skipped_captures: [] },
    snapshots: [val, hold], matches,
    audit: { eligible_matches: matches.length, exclusions: {} },
  };
}
const run = (data, options = {}, customApi = api) => evaluateWalkForward(data, customApi, { allowFixture: true, bootstrapSamples: 200, ...options });

test("holdout stays sealed by default and is never replayed", () => {
  let calls = 0;
  const counting = { ...api, explainSoloDraftTurn: (input) => { if (!input.banPolicy && !input.pickPolicy) calls++; return api.explainSoloDraftTurn(input); } };
  const result = run(dataset(), {}, counting);
  assert.equal(calls, 40, "only the two VALIDATION drafts are replayed");
  assert.equal(result.holdout_unsealed, false);
  assert.equal(result.splits.HOLDOUT.status, "SEALED");
  assert.equal(result.splits.HOLDOUT.sealed_matches, 2);
  assert.equal(result.splits.HOLDOUT.overall, null);
  assert.equal(result.splits.VALIDATION.status, "EVALUATED");
  assert.equal(result.splits.DEV.status, "NO_ELIGIBLE_MATCHES");
});

test("every method is scored on every state with consistent counts and no illegal candidates", () => {
  const result = run(dataset());
  const overall = result.splits.VALIDATION.overall;
  assert.deepEqual(Object.keys(overall), METHODS);
  for (const method of METHODS) {
    const m = overall[method];
    assert.equal(m.states, 40);
    assert.equal(m.illegal_candidates, 0, method);
    assert.ok(m.top1 <= m.top3 && m.top3 <= m.states - m.abstentions);
    assert.ok(m.mrr3 >= m.top1_rate && m.mrr3 <= m.top3_rate);
  }
  const byKind = result.splits.VALIDATION.by_kind;
  assert.equal(byKind.BAN.PRODUCTION.states + byKind.PICK.PRODUCTION.states, 40);
  assert.deepEqual(Object.keys(result.splits.VALIDATION.by_phase), ["BAN:1", "BAN:2", "PICK:1", "PICK:2"]);
  assert.equal(result.splits.VALIDATION.by_league.OTHER_SMALL_LEAGUES.matches, 2, "small leagues are pooled, never listed alone");
  assert.equal(result.splits.VALIDATION.team_macro_top3, null, "teams below the state minimum are not averaged");
  assert.equal(result.candidate_count, CANDIDATE_COUNT);
  assert.ok(!JSON.stringify(result).includes(dataset().snapshots[0].report.opponent_prep.teams[0].team_id), "no team IDs in output");
});

test("presence baseline ranks by same-patch counts and skips taken champions", () => {
  const data = dataset();
  // Draft that opens exactly with the presence leaders: the baseline must hit them at top-1.
  data.matches = [target(data.snapshots[0], { matchId: "v1", observedAt: "2026-08-26T10:00:00+00:00", split: "VALIDATION", order: ids.slice(0, 20) })];
  data.audit.eligible_matches = 1;
  const kind = run(data).splits.VALIDATION.by_phase["BAN:1"].BASELINE_PATCH_PRESENCE;
  assert.ok(kind.top1 >= 4, `presence leaders banned in order should mostly be top-1 (got ${kind.top1})`);
});

test("unsealed holdout reports the not-previously-inspected subset separately", () => {
  const result = run(dataset(), { unsealHoldout: true });
  assert.equal(result.splits.HOLDOUT.status, "EVALUATED");
  assert.equal(result.splits.HOLDOUT.matches, 2);
  assert.equal(result.splits.HOLDOUT.overall.PRODUCTION.states, 40);
  assert.equal(result.splits.HOLDOUT.holdout_not_previously_inspected.PRODUCTION.states, 20);
});

test("cluster bootstrap is deterministic, bounded and resamples whole matches", () => {
  const cluster = (p, b) => ({ PRODUCTION: { states: 20, top3: p }, BASELINE_PATCH_PRESENCE: { states: 20, top3: b } });
  const clusters = [cluster(10, 2), cluster(8, 4), cluster(12, 3), cluster(6, 6)];
  const a = clusterBootstrap(clusters, { samples: 500 });
  assert.deepEqual(a, clusterBootstrap(clusters, { samples: 500 }));
  const [low, high] = a.top3_rate_ci95.PRODUCTION;
  assert.ok(low <= 0.45 && 0.45 <= high && low >= 0.3 && high <= 0.6);
  const [dLow] = a.production_minus_baseline_top3_ci95.BASELINE_PATCH_PRESENCE;
  assert.ok(dLow > 0, "production clearly above this baseline");
  assert.equal(clusterBootstrap([]), null);
});

test("leakage and contract violations fail closed", () => {
  const cases = [
    ["Future evidence", (d) => {
      const game = structuredClone(template.opponent_prep.teams.find((t) => t.recent_games?.length).recent_games[0]);
      game.observed_at = "2026-08-23T12:00:00+00:00"; // inside the 24h lag before the 08-24 cutoff
      d.snapshots[0].report.opponent_prep.teams[0].recent_games = [game];
    }],
    ["Target match present", (d) => { d.snapshots[0].report.evidence_index.prior_match_ids = ["v1"]; }],
    ["week starting", (d) => { d.matches[0].observed_at = "2026-08-31T10:00:00+00:00"; }],
    ["Split label", (d) => { d.matches[0].split = "DEV"; }],
    ["Evidence limit", (d) => { d.snapshots[0].evidence_played_at_or_before = d.snapshots[0].cutoff; }],
    ["availability", (d) => { d.availability.lag_hours = 0; }],
    ["Invalid standard draft order", (d) => { d.matches[0].selections[3].side = d.matches[0].selections[3].side === "BLUE" ? "RED" : "BLUE"; }],
    ["Duplicate target", (d) => { d.matches.push(structuredClone(d.matches[0])); d.audit.eligible_matches++; }],
    ["Unsupported", (d) => { d.protocol_id = "other"; }],
  ];
  for (const [message, mutate] of cases) {
    const data = dataset();
    mutate(data);
    assert.throws(() => run(data), new RegExp(message), message);
  }
  assert.throws(() => evaluateWalkForward(dataset(), api), /unit tests/);
});

test("ban candidates use report.patch_presence, match production on picks, and fall back without it", () => {
  const withoutPresence = run(dataset()).splits.VALIDATION.overall;
  for (const method of ["CANDIDATE_BAN_PATCH_PRESENCE", "CANDIDATE_BAN_PATCH_PRESENCE_WITH_OPPONENT"]) {
    assert.deepEqual(withoutPresence[method], withoutPresence.PRODUCTION, `${method} falls back to production without presence`);
  }
  const data = dataset();
  for (const snap of data.snapshots) {
    snap.report.patch_presence = { patch_id: snap.patch_id, cutoff: snap.cutoff, match_count: 10,
      champions: ids.slice(0, 12).map((c, i) => ({ champion_id: c, picks: 12 - i, bans: 0 })) };
  }
  const result = run(data).splits.VALIDATION;
  assert.deepEqual(result.by_kind.PICK.CANDIDATE_BAN_PATCH_PRESENCE, result.by_kind.PICK.PRODUCTION, "picks unchanged");
  // v1 bans the presence leaders in order, so the pure presence candidate hits the first bans at top-1.
  assert.ok(result.by_phase["BAN:1"].CANDIDATE_BAN_PATCH_PRESENCE.top1 >= 4);
  // PATCH_PRESENCE is now the production default, so production and that candidate must agree exactly.
  assert.deepEqual(result.overall.PRODUCTION, result.overall.CANDIDATE_BAN_PATCH_PRESENCE);
  const bad = dataset();
  bad.snapshots[0].report.patch_presence = { patch_id: bad.snapshots[0].patch_id, cutoff: "2026-08-17T00:00:00+00:00", match_count: 1, champions: [] };
  assert.throws(() => run(bad), /Patch presence/);
});

test("pick candidates change only PICK turns and fall back without presence", () => {
  const plain = run(dataset()).splits.VALIDATION;
  for (const method of ["CANDIDATE_PICK_TEAM_PLUS_PATCH_PICKS", "CANDIDATE_PICK_TEAM_PLUS_PATCH_PRESENCE"]) {
    assert.deepEqual(plain.overall[method], plain.overall.PRODUCTION, `${method} equals production without presence`);
  }
  const data = dataset();
  const roles = ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"];
  for (const snap of data.snapshots) {
    snap.report.patch_presence = { patch_id: snap.patch_id, cutoff: snap.cutoff, match_count: 10,
      champions: ids.slice(20, 30).map((c, i) => ({ champion_id: c, picks: 10 - i, bans: i % 2, roles: [{ role: roles[i % 5], picks: 10 - i }] })) };
  }
  const withPresence = run(data).splits.VALIDATION;
  for (const method of ["CANDIDATE_PICK_TEAM_PLUS_PATCH_PICKS", "CANDIDATE_PICK_TEAM_PLUS_PATCH_PRESENCE"]) {
    assert.deepEqual(withPresence.by_kind.BAN[method], withPresence.by_kind.BAN.PRODUCTION, `${method} leaves bans unchanged`);
    assert.equal(withPresence.overall[method].illegal_candidates, 0);
  }
});

test("a champion name the product cannot replay is a counted exclusion, not a failure", () => {
  const data = dataset();
  data.matches[1].selections[9].champion_id = "Not A Real Champion";
  const result = run(data);
  assert.equal(result.splits.VALIDATION.excluded_unknown_champion, 1);
  assert.equal(result.splits.VALIDATION.matches, 1);
  assert.equal(result.splits.VALIDATION.overall.PRODUCTION.states, 20);
});

test("a champion repeated inside one source draft is a counted exclusion", () => {
  const data = dataset();
  data.matches[1].selections[12].champion_id = data.matches[1].selections[2].champion_id;
  const result = run(data);
  assert.equal(result.splits.VALIDATION.excluded_duplicate_champion, 1);
  assert.equal(result.splits.VALIDATION.matches, 1);
});

test("the production rules do not mutate snapshots", () => {
  const mutating = { ...api, explainSoloDraftTurn: (input) => { input.report.entries.push({ rank: 1 }); return api.explainSoloDraftTurn(input); } };
  assert.throws(() => run(dataset(), {}, mutating), /mutated/);
});
