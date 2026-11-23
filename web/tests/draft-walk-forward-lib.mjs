// Walk-forward evaluator for the CURRENT solo practice-opponent rules.
// Protocol: docs/benchmarks/DRAFT_RULE_WALK_FORWARD_PROTOCOL_2026-11-23.md (frozen before any run).
//
// Input: the exact output of src/pro_meta_intelligence/backtest/walk_forward_dataset.py.
// Each first-set draft is replayed turn by turn through the unchanged production rules
// (suggestSoloDraftTurn / explainSoloDraftTurn) and two fixed baselines. Agreement with the
// observed professional action is concordance only: not win prediction, utility or quality.
// The HOLDOUT split is never replayed unless `unsealHoldout` is set explicitly.
import { loadProductionApi } from "./current-draft-evaluation-lib.mjs";

export { loadProductionApi };
export const EVALUATOR_VERSION = "draft-walk-forward-v1";
export const PROTOCOL_ID = "draft-rule-walk-forward-2026-11-23";
export const CANDIDATE_COUNT = 3;
export const BOOTSTRAP_SAMPLES = 1000;
export const BOOTSTRAP_SEED = 20261123;
export const LEAGUE_MIN_MATCHES = 30;
export const TEAM_MIN_STATES = 40;
export const METHODS = Object.freeze(["PRODUCTION", "BASELINE_PATCH_PRESENCE", "BASELINE_TEAM_PRIORITY"]);
const SPLIT_ORDER = ["DEV", "VALIDATION", "HOLDOUT"];
const LAG_MS = 24 * 3600 * 1000;
const WEEK_MS = 7 * 24 * 3600 * 1000;

export const CLAIMS = Object.freeze([
  "SIMULATED_AVAILABILITY_NOT_LIVE_HISTORY", "SINGLE_CAPTURE_LATE_CORRECTIONS_VISIBLE",
  "CONCORDANCE_NOT_WIN_PREDICTION", "CONCORDANCE_NOT_UTILITY", "FIRST_SET_ONLY_NO_FEARLESS_LOCKS",
  "SEASON_HISTORY_NOT_SUPPLIED", "STATES_WITHIN_MATCH_CORRELATED_CLUSTER_BOOTSTRAP", "NO_FITTING_OR_WEIGHT_SEARCH",
]);

const SIDES = ["BLUE", "RED"];
const HASH = /^sha256:[0-9a-f]{64}$/;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
function req(condition, message) { if (!condition) throw new Error(message); }
function time(value, label) {
  req(typeof value === "string" && /(Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)), `Timezone-aware timestamp required: ${label}`);
  return Date.parse(value);
}
const round = (value) => value === null ? null : Number(value.toFixed(6));

/** Deterministic PRNG so the bootstrap intervals are reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Per-match tallies: states, abstentions, top1, top3, reciprocal-rank sum, illegal. */
const emptyTally = () => ({ states: 0, abstentions: 0, top1: 0, top3: 0, rr: 0, illegal: 0, short: 0 });
function addTally(target, source) { for (const key of Object.keys(target)) target[key] += source[key]; }
function metrics(tally) {
  const rate = (value) => tally.states ? round(value / tally.states) : null;
  return { states: tally.states, abstentions: tally.abstentions, top1: tally.top1, top3: tally.top3, illegal_candidates: tally.illegal,
    short_candidate_lists: tally.short, top1_rate: rate(tally.top1), top3_rate: rate(tally.top3), mrr3: rate(tally.rr), abstention_rate: rate(tally.abstentions) };
}

/**
 * 95% percentile interval of the pooled top-3 rate (and of paired differences) by resampling
 * whole matches, since the 20 states of one draft are correlated.
 */
export function clusterBootstrap(clusters, { samples = BOOTSTRAP_SAMPLES, seed = BOOTSTRAP_SEED } = {}) {
  if (!clusters.length) return null;
  const random = mulberry32(seed);
  const methods = Object.keys(clusters[0]);
  const draws = Object.fromEntries(methods.map((m) => [m, []]));
  const diffs = Object.fromEntries(methods.filter((m) => m !== "PRODUCTION").map((m) => [m, []]));
  for (let sample = 0; sample < samples; sample++) {
    const sums = Object.fromEntries(methods.map((m) => [m, { states: 0, top3: 0 }]));
    for (let i = 0; i < clusters.length; i++) {
      const pick = clusters[Math.floor(random() * clusters.length)];
      for (const m of methods) { sums[m].states += pick[m].states; sums[m].top3 += pick[m].top3; }
    }
    const rate = (m) => sums[m].states ? sums[m].top3 / sums[m].states : 0;
    for (const m of methods) draws[m].push(rate(m));
    for (const m of Object.keys(diffs)) diffs[m].push(rate("PRODUCTION") - rate(m));
  }
  const interval = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];
    return [round(at(0.025)), round(at(0.975))];
  };
  return {
    samples, seed, unit: "MATCH",
    top3_rate_ci95: Object.fromEntries(methods.map((m) => [m, interval(draws[m])])),
    production_minus_baseline_top3_ci95: Object.fromEntries(Object.entries(diffs).map(([m, v]) => [m, interval(v)])),
  };
}

function splitOf(observedMs, splits) {
  for (const split of splits) if (observedMs >= split.startMs && observedMs < split.endMs) return split.name;
  return null;
}

function validateDataset(dataset) {
  req(isRecord(dataset) && dataset.schema_version === "1" && dataset.artifact_type === "draft-walk-forward-dataset" &&
    dataset.protocol_id === PROTOCOL_ID && dataset.scope === "FIRST_SET_WALK_FORWARD_WEEKLY" &&
    Array.isArray(dataset.snapshots) && Array.isArray(dataset.matches), "Unsupported walk-forward dataset");
  req(isRecord(dataset.availability) && dataset.availability.mode === "SIMULATED_FROM_PLAYED_TIME" && dataset.availability.lag_hours === 24,
    "Unexpected availability mode");
  req(Array.isArray(dataset.splits) && dataset.splits.map((s) => s?.name).join() === SPLIT_ORDER.join(), "Unexpected split definition");
  req(isRecord(dataset.outcome_source) && HASH.test(dataset.outcome_source.content_hash ?? ""), "Missing outcome source");
  req(isRecord(dataset.audit) && dataset.audit.eligible_matches === dataset.matches.length, "Missing or inconsistent preparer audit");
  return dataset.splits.map((s) => ({ name: s.name, startMs: time(s.start, "split start"), endMs: time(s.end, "split end") }));
}

function validateSnapshot(raw, api, fixtureOnly) {
  req(isRecord(raw) && typeof raw.id === "string" && typeof raw.patch_id === "string" && Array.isArray(raw.presence), "Invalid snapshot");
  req(api.isRadarReport(raw.report) && isRecord(raw.report.opponent_prep), "Invalid snapshot report");
  const cutoff = time(raw.cutoff, "snapshot cutoff");
  req(time(raw.evidence_played_at_or_before, "evidence limit") === cutoff - LAG_MS, "Evidence limit must be cutoff minus 24h");
  req(time(raw.report.cutoff, "report cutoff") === cutoff && time(raw.report.opponent_prep.cutoff, "prep cutoff") === cutoff, "Snapshot cutoff mismatch");
  req(raw.report.patch_id === raw.patch_id && raw.report.opponent_prep.patch_id === raw.patch_id, "Snapshot patch mismatch");
  req(raw.report.fixture_only === fixtureOnly && raw.report.opponent_prep.fixture_only === fixtureOnly, "Fixture/real data mismatch");
  for (const team of raw.report.opponent_prep.teams) for (const game of team.recent_games ?? []) {
    req(time(game.observed_at, "recent game") <= cutoff - LAG_MS, "Future evidence in snapshot");
  }
  req(raw.presence.every((row) => isRecord(row) && typeof row.champion_id === "string" && Number.isSafeInteger(row.picks) && Number.isSafeInteger(row.bans)),
    "Invalid presence table");
  return cutoff;
}

/** Fixed, untuned comparison rankings (see protocol). */
function baselineCandidates(method, { presence, actingTeam, opposingTeam, kind, taken }) {
  const order = [];
  const push = (id) => { if (typeof id === "string" && !taken.has(id.toLowerCase()) && !order.some((o) => o.toLowerCase() === id.toLowerCase())) order.push(id); };
  const byPresence = [...presence].sort((a, b) => (kind === "PICK" ? b.picks - a.picks || b.bans - a.bans : (b.picks + b.bans) - (a.picks + a.bans)) || compare(a.champion_id, b.champion_id));
  if (method === "BASELINE_TEAM_PRIORITY") {
    const team = kind === "PICK" ? actingTeam : opposingTeam;
    for (const pick of [...(team?.priority_picks ?? [])].sort((a, b) => b.game_rate - a.game_rate || compare(a.champion_id, b.champion_id))) push(pick.champion_id);
  }
  for (const row of byPresence) push(row.champion_id);
  return order.slice(0, CANDIDATE_COUNT);
}

/**
 * @param {unknown} dataset walk-forward preparer output
 * @param {object} api production functions (loadProductionApi)
 * @param {{ unsealHoldout?: boolean, allowFixture?: boolean, bootstrapSamples?: number }} options
 */
export function evaluateWalkForward(dataset, api, options = {}) {
  const splits = validateDataset(dataset);
  req(!dataset.fixture_only || options.allowFixture === true, "Fixture datasets are accepted only by unit tests");
  for (const field of ["suggestSoloDraftTurn", "explainSoloDraftTurn", "applyDraftSelection", "draftSequence", "isRadarReport", "championAssetId"]) {
    req(typeof api?.[field] === "function", `Production API missing: ${field}`);
  }
  const canonicalIds = new Map(api.SHARE_CHAMPIONS.map(([, id]) => [id.toLowerCase(), id]));
  const canonical = (value) => typeof value === "string" ? canonicalIds.get(api.championAssetId(value).toLowerCase()) : undefined;

  const snapshots = new Map();
  const fingerprints = new Map();
  for (const raw of dataset.snapshots) {
    const cutoff = validateSnapshot(raw, api, dataset.fixture_only);
    req(!snapshots.has(raw.id), "Duplicate snapshot ID");
    snapshots.set(raw.id, { raw, cutoff });
    fingerprints.set(raw.id, JSON.stringify(raw.report));
  }

  const groups = new Map(); // `${split}|${dimension}|${key}` -> { method -> tally }
  const clustersBySplit = new Map();
  const teamTallies = new Map(); // `${split}|${team}` -> production tally
  const seen = new Set();
  const counts = Object.fromEntries(SPLIT_ORDER.map((s) => [s, { matches: 0, sealed_matches: 0, excluded_unknown_champion: 0 }]));
  const leagueMatches = new Map();
  const ordered = [...dataset.matches].sort((a, b) => compare(String(a?.observed_at), String(b?.observed_at)) || compare(String(a?.match_id), String(b?.match_id)));

  const bucket = (split, dimension, key) => {
    const id = `${split}|${dimension}|${key}`;
    if (!groups.has(id)) groups.set(id, Object.fromEntries(METHODS.map((m) => [m, emptyTally()])));
    return groups.get(id);
  };

  for (const raw of ordered) {
    req(isRecord(raw) && ["snapshot_id", "match_id", "league", "patch_id", "blue_team_id", "red_team_id", "split"].every((f) => typeof raw[f] === "string" && raw[f]) &&
      raw.game_number === 1 && Array.isArray(raw.selections) && raw.selections.length === 20, "Invalid first-set target");
    req(SIDES.includes(raw.first_pick_side), "Missing or invalid first_pick_side");
    req(!seen.has(raw.match_id), "Duplicate target match");
    seen.add(raw.match_id);
    const observed = time(raw.observed_at, "observed_at");
    req(splitOf(observed, splits) === raw.split, "Split label disagrees with match time");
    const entry = snapshots.get(raw.snapshot_id);
    req(entry, "Missing snapshot");
    const { raw: snapshot, cutoff } = entry;
    req(cutoff <= observed && observed < cutoff + WEEK_MS, "Target must be in the week starting at its snapshot cutoff");
    const report = snapshot.report;
    const prep = report.opponent_prep;
    req(report.patch_id === raw.patch_id, "Patch mismatch");
    req(![...report.evidence_index.prior_match_ids, ...report.evidence_index.recent_match_ids, ...prep.teams.flatMap((t) => t.evidence.match_ids),
      ...prep.teams.flatMap((t) => (t.recent_games ?? []).map((g) => g.match_id))].includes(raw.match_id), "Target match present in snapshot evidence");
    const blues = prep.teams.filter((t) => t.team_id === raw.blue_team_id);
    const reds = prep.teams.filter((t) => t.team_id === raw.red_team_id);
    req(blues.length === 1 && reds.length === 1 && raw.blue_team_id !== raw.red_team_id, "Missing or ambiguous prior team evidence");
    if (raw.split === "HOLDOUT" && options.unsealHoldout !== true) { counts.HOLDOUT.sealed_matches++; continue; }
    // A name the product cannot canonicalize cannot be replayed (applyDraftSelection rejects it): counted
    // exclusion before the order check, never substituted.
    if (raw.selections.some((s) => !canonical(s?.champion_id))) { counts[raw.split].excluded_unknown_champion++; continue; }
    const sequence = api.draftSequence(raw.first_pick_side);
    let check = [];
    for (const [index, selection] of raw.selections.entries()) {
      const expected = sequence[index];
      req(isRecord(selection) && typeof selection.champion_id === "string" && selection.turn === index + 1 && selection.side === expected.side &&
        selection.kind === expected.kind && selection.slot === expected.slot && selection.phase === expected.phase, "Invalid standard draft order");
      const next = api.applyDraftSelection(check, selection.champion_id, [], raw.first_pick_side);
      req(next.length === check.length + 1, "Duplicate or empty champion in target");
      check = next;
    }
    counts[raw.split].matches++;
    leagueMatches.set(`${raw.split}|${raw.league}`, (leagueMatches.get(`${raw.split}|${raw.league}`) ?? 0) + 1);

    const cluster = Object.fromEntries(METHODS.map((m) => [m, emptyTally()]));
    const blueTeam = blues[0], redTeam = reds[0];
    for (let index = 0; index < 20; index++) {
      const actual = raw.selections[index];
      const prefix = structuredClone(raw.selections.slice(0, index));
      const actingSide = actual.side;
      const input = { report, blueTeam, redTeam, selections: prefix, previousPicks: [], firstPickSide: raw.first_pick_side,
        manualSide: actingSide === "BLUE" ? "RED" : "BLUE", seasonHistory: null };
      const explanation = api.explainSoloDraftTurn(input);
      const suggestion = api.suggestSoloDraftTurn(input);
      const taken = new Set(prefix.map((s) => s.champion_id.toLowerCase()));
      const actingTeam = actingSide === "BLUE" ? blueTeam : redTeam;
      const opposingTeam = actingSide === "BLUE" ? redTeam : blueTeam;
      const lists = {};
      if (explanation === null) {
        req(suggestion === null, "Production API contract: explain null but suggest non-null");
        lists.PRODUCTION = null;
      } else {
        req(suggestion && suggestion.champion_id === explanation.selected.champion_id, "Production API contract: selected differs from suggestSoloDraftTurn");
        req(explanation.turn === index + 1 && explanation.kind === actual.kind && explanation.side === actingSide, "Production API answered a different turn");
        lists.PRODUCTION = [explanation.selected, ...explanation.alternatives].slice(0, CANDIDATE_COUNT).map((c) => c.champion_id);
      }
      for (const method of METHODS.slice(1)) {
        lists[method] = baselineCandidates(method, { presence: snapshot.presence, actingTeam, opposingTeam, kind: actual.kind, taken });
      }
      const target = canonical(actual.champion_id);
      const dims = [["ALL", "ALL"], ["KIND", actual.kind], ["PHASE", `${actual.kind}:${actual.phase}`], ["LEAGUE", raw.league]];
      if (raw.split === "HOLDOUT" && !raw.inspected_window) dims.push(["HOLDOUT_CLEAN", "NOT_PREVIOUSLY_INSPECTED"]);
      for (const method of METHODS) {
        const tally = emptyTally();
        tally.states = 1;
        const list = lists[method];
        if (!list || !list.length) tally.abstentions = 1;
        else {
          const rank = list.findIndex((id) => canonical(id) === target);
          if (rank === 0) tally.top1 = 1;
          if (rank >= 0) { tally.top3 = 1; tally.rr = 1 / (rank + 1); }
          tally.illegal = list.filter((id) => !canonical(id) || api.applyDraftSelection(prefix, id, [], raw.first_pick_side) === prefix).length;
          if (list.length < CANDIDATE_COUNT) tally.short = 1;
        }
        addTally(cluster[method], tally);
        for (const [dimension, key] of dims) addTally(bucket(raw.split, dimension, key)[method], tally);
      }
      const teamKey = `${raw.split}|${actingSide === "BLUE" ? raw.blue_team_id : raw.red_team_id}`;
      if (!teamTallies.has(teamKey)) teamTallies.set(teamKey, Object.fromEntries(METHODS.map((m) => [m, emptyTally()])));
      const teamTally = teamTallies.get(teamKey);
      for (const method of METHODS) {
        const one = emptyTally();
        one.states = 1;
        const list = lists[method];
        if (list?.some((id) => canonical(id) === target)) one.top3 = 1;
        addTally(teamTally[method], one);
      }
    }
    if (!clustersBySplit.has(raw.split)) clustersBySplit.set(raw.split, []);
    clustersBySplit.get(raw.split).push(cluster);
  }
  for (const [id, json] of fingerprints) req(JSON.stringify(snapshots.get(id).raw.report) === json, "Production API mutated a snapshot");

  const bySplit = {};
  for (const split of SPLIT_ORDER) {
    const clusters = clustersBySplit.get(split) ?? [];
    const read = (dimension, key) => groups.has(`${split}|${dimension}|${key}`)
      ? Object.fromEntries(METHODS.map((m) => [m, metrics(groups.get(`${split}|${dimension}|${key}`)[m])])) : null;
    const keysOf = (dimension) => [...groups.keys()].filter((k) => k.startsWith(`${split}|${dimension}|`)).map((k) => k.split("|")[2]).sort(compare);
    const leagues = {};
    let other = null;
    for (const league of keysOf("LEAGUE")) {
      const matches = leagueMatches.get(`${split}|${league}`) ?? 0;
      const tallies = groups.get(`${split}|LEAGUE|${league}`);
      if (matches >= LEAGUE_MIN_MATCHES) leagues[league] = { matches, ...Object.fromEntries(METHODS.map((m) => [m, metrics(tallies[m])])) };
      else {
        other ??= { matches: 0, leagues: 0, tallies: Object.fromEntries(METHODS.map((m) => [m, emptyTally()])) };
        other.matches += matches; other.leagues += 1;
        for (const m of METHODS) addTally(other.tallies[m], tallies[m]);
      }
    }
    if (other) leagues.OTHER_SMALL_LEAGUES = { matches: other.matches, leagues: other.leagues, ...Object.fromEntries(METHODS.map((m) => [m, metrics(other.tallies[m])])) };
    const teams = [...teamTallies.entries()].filter(([k, t]) => k.startsWith(`${split}|`) && t.PRODUCTION.states >= TEAM_MIN_STATES).map(([, t]) => t);
    const macro = teams.length ? Object.fromEntries(METHODS.map((m) => [m, round(teams.reduce((sum, t) => sum + t[m].top3 / t[m].states, 0) / teams.length)])) : null;
    bySplit[split] = {
      status: split === "HOLDOUT" && options.unsealHoldout !== true ? "SEALED" : clusters.length ? "EVALUATED" : "NO_ELIGIBLE_MATCHES",
      ...counts[split],
      overall: read("ALL", "ALL"),
      by_kind: Object.fromEntries(keysOf("KIND").map((k) => [k, read("KIND", k)])),
      by_phase: Object.fromEntries(keysOf("PHASE").map((k) => [k, read("PHASE", k)])),
      by_league: leagues,
      team_macro_top3: macro ? { teams: teams.length, min_states_per_team: TEAM_MIN_STATES, ...macro } : null,
      bootstrap: clusterBootstrap(clusters, { samples: options.bootstrapSamples ?? BOOTSTRAP_SAMPLES }),
      ...(split === "HOLDOUT" ? { holdout_not_previously_inspected: read("HOLDOUT_CLEAN", "NOT_PREVIOUSLY_INSPECTED") } : {}),
    };
  }
  return {
    schema_version: "1", artifact_type: "draft-walk-forward-evaluation", evaluator_version: EVALUATOR_VERSION, protocol_id: PROTOCOL_ID,
    fixture_only: dataset.fixture_only, holdout_unsealed: options.unsealHoldout === true, candidate_count: CANDIDATE_COUNT, methods: METHODS,
    claims: CLAIMS, availability: dataset.availability, outcome_source: { content_hash: dataset.outcome_source.content_hash, retrieved_at: dataset.outcome_source.retrieved_at },
    preparer_audit: dataset.audit, splits: bySplit,
    boundary: "Concordance of the current solo practice-opponent rules with observed first-set professional actions under simulated " +
      "24h availability from one capture. Not live history, win prediction, utility or quality. States within a match are correlated; " +
      "intervals resample whole matches.",
  };
}
