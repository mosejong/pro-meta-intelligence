// G1 pool-membership diagnostics for the CURRENT solo practice-opponent rules. Research tooling only.
//
// What this does NOT do: it changes no rule, weight, threshold, evaluator or product module, and it
// makes no accuracy claim. The frozen evaluators (current-draft-evaluation-lib.mjs at 30525faf and
// current-draft-season-evaluation-lib.mjs) are imported and run unchanged.
//
// Method:
// 1. Each state is captured by running the frozen evaluator itself with a pass-through recorder
//    around explainSoloDraftTurn. Every dataset, provenance, time, hash and season-evidence gate
//    therefore applies, and the inputs are exactly what production received.
// 2. Production output is checked to be byte-identical (JSON) across three runs: a plain run
//    before diagnostics, the recorded run, and a plain run after diagnostics.
// 3. Per-state facts are derived from the recorded input, which is the chronological prefix only,
//    using unchanged production functions:
//    - buildDraftAgentFrame, nextDraftTurn, applyDraftSelection, isChampionLocked;
//    - soloRoleCandidates, canCoverRoles;
//    - championAssetId + SHARE_CHAMPIONS canonicalization.
//    The actual action is used only as the query id and the scoring label. It is never a feature.
// 4. A shadow of solo-draft.ts `select` (soloContext isn't exported, and no hook is added) gives
//    a reconstructed position for the actual. The position is reported only if, for that state,
//    the shadow's first three choices (id, source, role_supported) equal production's three.
//    Otherwise it is explicitly unavailable. Primary classes never depend on the shadow.
import { isDeepStrictEqual } from "node:util";
import { CANDIDATE_COUNT, EVALUATOR_VERSION, evaluateCurrentDraftRules } from "./current-draft-evaluation-lib.mjs";
import { SEASON_EVALUATOR_VERSION, evaluateWithSeasonEvidence, loadSeasonApi } from "./current-draft-season-evaluation-lib.mjs";

export const DIAGNOSTICS_VERSION = "current-draft-pool-diagnostics-v1";
export { CANDIDATE_COUNT };

/** Disjoint and exhaustive: every state gets exactly one, decided in this order. */
export const PRIMARY_CLASSES = Object.freeze([
  "ABSTAIN", // production and the reconstruction both returned null for the state
  "NOT_COMPUTABLE", // facts can't be derived exactly (reconstruction disagrees on null-ness/turn, or actual not legal in prefix)
  "TOP3", // actual is in production's 3 candidates
  "BAN_TARGET_PRIORITY_BEYOND_TOP3", // ban; actual is in the TARGET (opponent) priority_picks, so it is in `records`, at rank > 3
  "BAN_OUTSIDE_TARGET_PRIORITIES_IN_OTHER_TARGET_SOURCE", // ban; not in target priorities, but in target role candidates or current meta
  "BAN_NOT_IN_TARGET_SOURCES", // ban; not in target priorities, target role candidates or current meta
  "PICK_NOT_IN_POOL", // pick; not in acting priorities, current meta or acting role candidates (the whole `expanded` source set)
  "PICK_IN_POOL_ROLE_INFEASIBLE", // pick; in the pool, but canCoverRoles(prefix picks + actual) is false
  "PICK_IN_POOL_FEASIBLE_BEYOND_TOP3", // pick; in the pool, role-feasible, not in the top 3
]);

/** Non-exclusive booleans: any number can be true for a state. Counted only for computable states. */
export const FLAGS = Object.freeze([
  "in_frame_options", // actual is a buildDraftAgentFrame option for this prefix
  "in_non_target_team_sources", // in the other team's priority_picks or role candidates
  "non_target_sources_only", // in the other team's sources but in none of the target's sources (priorities, role candidates, meta)
  "acting_season_candidates_available", // acting team has >= 1 season candidate row: availability only, never a cause
  "actual_has_acting_season_row", // actual's acting role candidate carries a season row: availability only
  "ban_records_fewer_than_top3", // ban; fewer than 3 available target records, so later ban slots come from RADAR/FALLBACK
]);

export const DIAGNOSTIC_CLAIMS = Object.freeze([
  "DESCRIPTIVE_ONLY", "NO_RULE_OR_WEIGHT_CHANGE", "NO_NEW_ACCURACY_CLAIM", "BASE_COHORT_ALREADY_OBSERVED",
  "NO_FUTURE_PREFIX_ROLE_OR_LINEUP_FEATURES", "SEASON_ROWS_ARE_AVAILABILITY_NOT_CAUSE",
  "SHADOW_POSITION_ONLY_WHEN_TOP3_MATCHES_PRODUCTION", "POSITIONS_BEYOND_3_ARE_RECONSTRUCTED", "STATES_WITHIN_MATCH_CORRELATED",
]);

const OBSERVED_ROLES = new Set(["TOP", "JUNGLE", "MID", "BOTTOM", "ADC", "SUPPORT"]);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const uniq = (values) => [...new Set(values)];
const rankOf = (list, id) => { const index = list.indexOf(id); return index < 0 ? null : index + 1; };
function req(condition, message) { if (!condition) throw new Error(message); }

/** Season API plus the unchanged production modules the diagnostics read (no exports or hooks added). */
export async function loadDiagnosticsApi() {
  const { vite, api } = await loadSeasonApi();
  try {
    const agent = await vite.ssrLoadModule("/app/draft-agent.ts");
    const roles = await vite.ssrLoadModule("/app/solo-role-candidates.ts");
    return {
      vite,
      api: {
        ...api, nextDraftTurn: agent.nextDraftTurn, buildDraftAgentFrame: agent.buildDraftAgentFrame, isChampionLocked: agent.isChampionLocked,
        soloRoleCandidates: roles.soloRoleCandidates, canCoverRoles: roles.canCoverRoles,
      },
    };
  } catch (error) { await vite.close(); throw error; }
}

const DIAGNOSTIC_API_FIELDS = ["explainSoloDraftTurn", "suggestSoloDraftTurn", "applyDraftSelection", "nextDraftTurn", "buildDraftAgentFrame",
  "isChampionLocked", "soloRoleCandidates", "canCoverRoles", "championAssetId"];

const canonicalCache = new WeakMap();
/** solo-draft.ts canonicalization: SHARE_CHAMPIONS id (lower-case) <- championAssetId(value). */
function canonicalizer(api) {
  let cached = canonicalCache.get(api.SHARE_CHAMPIONS);
  if (!cached || cached.assetId !== api.championAssetId) {
    const ids = new Map(api.SHARE_CHAMPIONS.map(([, id]) => [id.toLowerCase(), id]));
    cached = { ids, assetId: api.championAssetId,
      canonical: (value) => typeof value === "string" ? ids.get(api.championAssetId(value).toLowerCase()) : undefined };
    canonicalCache.set(api.SHARE_CHAMPIONS, cached);
  }
  return cached;
}

function sortPriorities(rows, canonical) {
  return [...rows].sort((a, b) => b.game_rate - a.game_rate || b.phase_1_count - a.phase_1_count ||
    compare(canonical(a.champion_id) ?? a.champion_id, canonical(b.champion_id) ?? b.champion_id));
}

/**
 * Line-for-line reconstruction of solo-draft.ts soloContext, with the selection rules unchanged.
 * Memoization of legal/roleFeasible is behaviour-neutral because both are pure for a fixed state.
 * Returns null exactly where soloContext returns null.
 */
export function reconstructSoloContext(input, api) {
  const { ids: canonicalIds, canonical } = canonicalizer(api);
  const { report, blueTeam, redTeam, selections, previousPicks, firstPickSide, manualSide } = input;
  if (!blueTeam || !redTeam || !blueTeam.team_id || !redTeam.team_id || blueTeam.team_id === redTeam.team_id ||
    !["BLUE", "RED"].includes(firstPickSide) || !["BLUE", "RED"].includes(manualSide) ||
    !Array.isArray(selections) || selections.length > 20 || !Array.isArray(previousPicks)) return null;
  const locks = previousPicks.map(canonical);
  if (locks.some((id) => !id)) return null;
  const previous = locks;
  let replay = [];
  for (const selection of selections) {
    const expected = api.nextDraftTurn(replay, firstPickSide);
    const id = canonical(selection?.champion_id);
    if (!expected || !id || selection.turn !== replay.length + 1 || selection.side !== expected.side ||
      selection.kind !== expected.kind || selection.phase !== expected.phase || selection.slot !== expected.slot) return null;
    const next = api.applyDraftSelection(replay, id, previous, firstPickSide);
    if (next === replay) return null;
    replay = next;
  }
  const turn = api.nextDraftTurn(replay, firstPickSide);
  if (!turn || turn.side === manualSide) return null;
  const acting = turn.side === "BLUE" ? blueTeam : redTeam;
  const opposing = turn.side === "BLUE" ? redTeam : blueTeam;
  const target = turn.kind === "BAN" ? opposing : acting;
  const legalMemo = new Map();
  const legal = (id) => {
    if (!legalMemo.has(id)) legalMemo.set(id, api.applyDraftSelection(replay, id, previous, firstPickSide) !== replay);
    return legalMemo.get(id);
  };
  const frame = api.buildDraftAgentFrame(report, blueTeam, redTeam, replay, previous, firstPickSide);
  const priorities = sortPriorities(target.priority_picks, canonical);
  const priorityIds = new Set(priorities.map((p) => canonical(p.champion_id)).filter(Boolean));
  const strictRole = (id) => {
    const rows = acting.priority_picks.filter((p) => canonical(p.champion_id) === id);
    const roles = new Set(rows.map((p) => p.role === "ADC" ? "BOTTOM" : p.role));
    const role = rows[0]?.role === "ADC" ? "BOTTOM" : rows[0]?.role;
    return roles.size === 1 && role && OBSERVED_ROLES.has(role) ? role : null;
  };
  const covered = new Set(replay.filter((s) => s.side === turn.side && s.kind === "PICK").map((s) => strictRole(s.champion_id)).filter(Boolean));
  const repeatsRole = (id) => { const role = strictRole(id); return role !== null && covered.has(role); };
  const roleCandidates = api.soloRoleCandidates(acting, report, input.seasonHistory);
  const picked = replay.filter((s) => s.side === turn.side && s.kind === "PICK").map((s) => s.champion_id);
  const candidateById = new Map(roleCandidates.map((row) => [row.champion_id, row]));
  const metaRows = report.entries.filter((e) => e.eligible_for_review).sort((a, b) => a.rank - b.rank || compare(a.champion_id, b.champion_id));
  const metaIds = uniq(metaRows.map((e) => canonical(e.champion_id)).filter((id) => !!id));
  const metaSet = new Set(metaIds);
  const rolePool = [...roleCandidates, ...metaRows.flatMap((e) => {
    const id = canonical(e.champion_id), role = e.role === "ADC" ? "BOTTOM" : e.role;
    return id && OBSERVED_ROLES.has(role) ? [{ champion_id: id, roles: [role], score: 0, season: false }] : [];
  })];
  const feasibleMemo = new Map();
  const roleFeasible = (id) => {
    if (!feasibleMemo.has(id)) feasibleMemo.set(id, api.canCoverRoles(picked, rolePool, id));
    return feasibleMemo.get(id);
  };
  const recordsFor = (excluded) => {
    const available = (id) => !excluded.has(id) && legal(id);
    return uniq([
      ...frame.options.map((o) => canonical(o.champion_id)).filter((id) => !!id && priorityIds.has(id)),
      ...priorities.map((p) => canonical(p.champion_id)).filter((id) => !!id),
    ]).filter(available);
  };
  const expandedFor = (excluded, records = recordsFor(excluded)) => {
    const available = (id) => !excluded.has(id) && legal(id);
    return uniq([...records.filter((id) => metaSet.has(id)), ...metaIds, ...records, ...roleCandidates.map((row) => row.champion_id)]).filter(available);
  };
  const sortedFallback = [...canonicalIds.values()].sort(compare);
  const radarOrder = uniq([
    ...frame.options.map((o) => canonical(o.champion_id)),
    ...report.entries.filter((e) => e.eligible_for_review)
      .sort((a, b) => a.rank - b.rank || compare(canonical(a.champion_id) ?? a.champion_id, canonical(b.champion_id) ?? b.champion_id))
      .map((e) => canonical(e.champion_id)),
  ]);
  // Same branches and order as solo-draft.ts select; only `reason` text is omitted (not compared).
  const select = (excluded) => {
    const available = (id) => !excluded.has(id) && legal(id);
    const records = recordsFor(excluded);
    const expanded = expandedFor(excluded, records);
    const record = turn.kind === "PICK" ? expanded.find(roleFeasible) ?? records.find((id) => !repeatsRole(id)) ?? expanded[0] : records[0];
    const finish = (choice) => turn.kind !== "PICK" ? choice : { ...choice, role_supported: roleFeasible(choice.champion_id) };
    if (record && turn.kind === "PICK" && metaSet.has(record) && !priorityIds.has(record)) return finish({ champion_id: record, source: "RADAR" });
    if (record && turn.kind === "PICK" && candidateById.get(record)?.season) return finish({ champion_id: record, source: "PLAYER_SEASON" });
    if (record) return finish({ champion_id: record, source: "TEAM_RECORD" });
    const radar = radarOrder.find((id) => !!id && available(id));
    if (radar) return finish({ champion_id: radar, source: "RADAR" });
    const fallback = sortedFallback.find(available);
    return fallback ? finish({ champion_id: fallback, source: "FALLBACK" }) : null;
  };
  return {
    turn, acting, opposing, target, nonTarget: turn.kind === "BAN" ? acting : opposing, replay, previous, legal, frame,
    priorities, priorityIds, metaIds, metaSet, roleCandidates, candidateById, picked, roleFeasible, recordsFor, expandedFor, select,
    championCount: canonicalIds.size, canonical,
  };
}

/**
 * Iterates `select` with growing exclusions, exactly like explainSoloDraftTurn's alternatives loop, but
 * continues until the query id is reached (and at least `minimum` entries exist), select returns null,
 * or `bound` entries. Bounded: FALLBACK covers every champion, so a legal id is always reached.
 */
export function shadowOrder(ctx, queryId, { minimum = CANDIDATE_COUNT, bound = ctx.championCount + 1 } = {}) {
  const excluded = new Set();
  const order = [];
  let found = false;
  while (order.length < bound) {
    const next = ctx.select(excluded);
    if (!next || excluded.has(next.champion_id)) break;
    order.push(next);
    excluded.add(next.champion_id);
    if (next.champion_id === queryId) found = true;
    if (found && order.length >= minimum) break;
  }
  return order;
}

const sameChoice = (shadow, production) => shadow.champion_id === production.champion_id && shadow.source === production.source &&
  shadow.role_supported === production.role_supported;

function candidateFacts(api, team, report, history, actualId) {
  const withHistory = api.soloRoleCandidates(team, report, history);
  const currentOnly = api.soloRoleCandidates(team, report, null);
  const row = withHistory.find((r) => r.champion_id === actualId);
  return {
    present: Boolean(row),
    current: currentOnly.some((r) => r.champion_id === actualId), // from priority_picks/current profiles without season history
    season_row: Boolean(row?.season), // a season row was merged in: availability, not cause
    roles: row ? [...row.roles] : [],
    season_candidate_count: withHistory.filter((r) => r.season).length,
  };
}

/**
 * Exact facts and classes for one state. `input` is the recorded production input (prefix only),
 * `explanation` the recorded production output, `actual` the observed selection (query/label only).
 */
export function diagnoseState({ input, explanation, actual }, api) {
  const { canonical } = canonicalizer(api);
  const base = { turn: actual.turn, kind: actual.kind, side: actual.side, phase: actual.phase };
  const ctx = reconstructSoloContext(input, api);
  const actualId = canonical(actual.champion_id) ?? null;
  const notComputable = (reason) => ({ ...base, actual: actualId, primary_class: "NOT_COMPUTABLE", not_computable_reason: reason,
    features: null, flags: null, shadow: { status: "NOT_APPLICABLE", position: null, position_source: null, position_basis: null } });
  if (!explanation && !ctx) {
    return { ...base, actual: actualId, primary_class: "ABSTAIN", not_computable_reason: null, features: null, flags: null,
      shadow: { status: "NOT_APPLICABLE", position: null, position_source: null, position_basis: null } };
  }
  if (!explanation || !ctx) return notComputable("RECONSTRUCTION_NULLNESS_DIFFERS_FROM_PRODUCTION");
  if (!actualId) return notComputable("ACTUAL_NOT_CANONICAL");
  if (ctx.replay.length !== actual.turn - 1 || ctx.turn.kind !== actual.kind || ctx.turn.side !== actual.side) {
    return notComputable("RECONSTRUCTED_TURN_DIFFERS");
  }
  const legal = ctx.legal(actualId);
  const locked = api.isChampionLocked(ctx.replay, actualId, ctx.previous);
  if (!legal) return notComputable(locked ? "ACTUAL_LOCKED_IN_PREFIX" : "ACTUAL_NOT_LEGAL_IN_PREFIX");

  const isPick = ctx.turn.kind === "PICK";
  const production = [explanation.selected, ...explanation.alternatives].slice(0, CANDIDATE_COUNT);
  const inTop3 = production.some((c) => canonical(c.champion_id) === actualId);
  const records = ctx.recordsFor(new Set());
  const expanded = isPick ? ctx.expandedFor(new Set(), records) : null;
  const targetPriorityOrder = uniq(ctx.priorities.map((p) => canonical(p.champion_id)).filter(Boolean));
  const nonTargetPriorityOrder = uniq(sortPriorities(ctx.nonTarget.priority_picks, canonical).map((p) => canonical(p.champion_id)).filter(Boolean));
  const target = candidateFacts(api, ctx.target, input.report, input.seasonHistory, actualId);
  const nonTarget = candidateFacts(api, ctx.nonTarget, input.report, input.seasonHistory, actualId);
  const actingFacts = isPick ? target : nonTarget;
  const actingSeasonCount = ctx.roleCandidates.filter((r) => r.season).length;
  req(actingSeasonCount === actingFacts.season_candidate_count, "Reconstruction error: acting role candidates differ");
  const features = {
    actual_legal_in_prefix: legal,
    actual_locked_in_prefix: locked,
    target_priority_rank: rankOf(targetPriorityOrder, actualId), // ban: opponent's records; pick: acting team's records
    target_priority_size: targetPriorityOrder.length,
    records_rank: rankOf(records, actualId), // after prefix availability, frame-option records first (production order)
    records_size: records.length,
    non_target_priority_rank: rankOf(nonTargetPriorityOrder, actualId),
    meta_rank: rankOf(ctx.metaIds, actualId), // among review-eligible current meta, production order
    meta_size: ctx.metaIds.length,
    frame_option_lane: ctx.frame.options.find((o) => canonical(o.champion_id) === actualId)?.lane ?? null,
    target_role_candidate: { present: target.present, current: target.current, season_row: target.season_row, roles: target.roles },
    non_target_role_candidate: { present: nonTarget.present, current: nonTarget.current, season_row: nonTarget.season_row, roles: nonTarget.roles },
    expanded_rank: expanded ? rankOf(expanded, actualId) : null, // picks only; position in the pre-feasibility source order
    expanded_size: expanded ? expanded.length : null,
    role_feasible: isPick ? ctx.roleFeasible(actualId) : null,
    acting_season_candidate_count: actingSeasonCount,
    production_season_evidence: explanation.season_evidence,
  };
  const inTargetPriorities = ctx.priorityIds.has(actualId);
  const inMeta = ctx.metaSet.has(actualId);
  const inTargetSources = inTargetPriorities || inMeta || target.present;
  const inNonTargetSources = features.non_target_priority_rank !== null || nonTarget.present;
  if (isPick) req(inTargetSources === (features.expanded_rank !== null), "Reconstruction error: pick pool membership differs from expanded");
  if (inTargetPriorities) req(features.records_rank !== null, "Reconstruction error: available target priority missing from records");

  let primary;
  if (inTop3) primary = "TOP3";
  else if (!isPick) {
    primary = inTargetPriorities ? "BAN_TARGET_PRIORITY_BEYOND_TOP3"
      : inTargetSources ? "BAN_OUTSIDE_TARGET_PRIORITIES_IN_OTHER_TARGET_SOURCE" : "BAN_NOT_IN_TARGET_SOURCES";
  } else {
    primary = !inTargetSources ? "PICK_NOT_IN_POOL" : !features.role_feasible ? "PICK_IN_POOL_ROLE_INFEASIBLE" : "PICK_IN_POOL_FEASIBLE_BEYOND_TOP3";
  }
  const flags = {
    in_frame_options: features.frame_option_lane !== null,
    in_non_target_team_sources: inNonTargetSources,
    non_target_sources_only: inNonTargetSources && !inTargetSources,
    acting_season_candidates_available: actingSeasonCount > 0,
    actual_has_acting_season_row: actingFacts.season_row,
    ban_records_fewer_than_top3: !isPick && records.length < CANDIDATE_COUNT,
  };

  const order = shadowOrder(ctx, actualId);
  const top = order.slice(0, CANDIDATE_COUNT);
  const verified = top.length === production.length && top.every((choice, i) => sameChoice(choice, production[i]));
  let shadow;
  if (!verified) shadow = { status: "MISMATCH_UNAVAILABLE", position: null, position_source: null, position_basis: null };
  else {
    const index = order.findIndex((c) => c.champion_id === actualId);
    shadow = index < 0
      ? { status: "VERIFIED_TOP3_NOT_REACHED", position: null, position_source: null, position_basis: null }
      : { status: "VERIFIED_TOP3_EQUAL", position: index + 1, position_source: order[index].source,
        position_basis: index < CANDIDATE_COUNT ? "PRODUCTION_TOP3" : "RECONSTRUCTED_SELECT" };
  }
  return { ...base, actual: actualId, primary_class: primary, not_computable_reason: null, features, flags, shadow };
}

/** Pass-through recorder: production computes every answer; the recorder only keeps copies. */
function recordingApi(api) {
  const calls = [];
  const recorder = {
    ...api,
    explainSoloDraftTurn: (input) => {
      const selections = structuredClone(input.selections);
      const explanation = api.explainSoloDraftTurn(input);
      calls.push({ input: { ...input, selections }, explanation: structuredClone(explanation) });
      return explanation;
    },
  };
  return { recorder, calls };
}

function diagnoseMode(dataset, api, run) {
  const fingerprint = JSON.stringify(dataset);
  const before = JSON.stringify(run(api));
  const { recorder, calls } = recordingApi(api);
  const recorded = run(recorder);
  req(JSON.stringify(recorded) === before, "Recording changed the production output");
  req(calls.length === recorded.case_results.length, "Recorded calls do not align with case_results");
  const matches = new Map(dataset.matches.map((m) => [m.match_id, m]));
  const rows = calls.map((call, i) => {
    const result = recorded.case_results[i];
    const match = matches.get(result.match_id);
    req(match, "case_results references an unknown match");
    const actual = match.selections[result.turn - 1];
    req(actual.champion_id === result.actual && actual.kind === result.kind && actual.side === result.side, "Recorded call does not match its case");
    // Feature input is exactly the prefix before the actual action; nothing later is visible.
    req(call.input.selections.length === result.turn - 1 && isDeepStrictEqual(call.input.selections, match.selections.slice(0, result.turn - 1)),
      "Recorded input is not the chronological prefix");
    req(call.input.firstPickSide === match.first_pick_side, "Recorded first-pick side differs from the match");
    const production = call.explanation ? [call.explanation.selected, ...call.explanation.alternatives].slice(0, CANDIDATE_COUNT).map((c) => c.champion_id) : [];
    req(isDeepStrictEqual(production, result.candidates), "Recorded explanation differs from case_results candidates");
    return { match_id: result.match_id, ...diagnoseState({ input: call.input, explanation: call.explanation, actual }, api) };
  });
  const after = JSON.stringify(run(api));
  req(after === before, "Production output changed after diagnostics");
  req(JSON.stringify(dataset) === fingerprint, "Diagnostics mutated the dataset");
  return {
    evaluator_status: recorded.status,
    byte_identity: { before_equals_recorded: true, before_equals_after: true, dataset_unchanged: true, output_sha_basis: "JSON.stringify(full evaluator result)" },
    state_count: rows.length,
    state_rows: rows,
  };
}

/**
 * Runs G1 diagnostics. BASELINE always (seasonHistory = null, frozen evaluator); SEASON only when
 * season evidence is supplied, which is then validated by the frozen season path (no fallback).
 */
export function runPoolDiagnostics(dataset, api, { datasetSha256 = null, seasonEvidence = null, allowFixture = false } = {}) {
  for (const field of DIAGNOSTIC_API_FIELDS) req(typeof api?.[field] === "function", `Diagnostics API missing: ${field} (use loadDiagnosticsApi)`);
  req(Array.isArray(api.SHARE_CHAMPIONS), "Diagnostics API missing: SHARE_CHAMPIONS");
  const options = { allowFixture };
  const modes = { BASELINE: diagnoseMode(dataset, api, (a) => evaluateCurrentDraftRules(dataset, a, options)), SEASON: null };
  if (seasonEvidence !== null) {
    req(typeof datasetSha256 === "string", "Season diagnostics require the dataset byte hash");
    modes.SEASON = diagnoseMode(dataset, api, (a) => evaluateWithSeasonEvidence(dataset, datasetSha256, seasonEvidence, a, options));
  }
  return {
    schema_version: "1", artifact_type: "current-draft-pool-diagnostics", diagnostics_version: DIAGNOSTICS_VERSION,
    base_evaluator_version: EVALUATOR_VERSION, season_evaluator_version: modes.SEASON ? SEASON_EVALUATOR_VERSION : null,
    fixture_only: dataset.fixture_only, dataset_sha256: datasetSha256, candidate_count: CANDIDATE_COUNT,
    claims: DIAGNOSTIC_CLAIMS, primary_classes: PRIMARY_CLASSES, flags: FLAGS, modes,
  };
}

const POSITION_BUCKETS = [["1-3", 1, 3], ["4-10", 4, 10], ["11-20", 11, 20], ["21+", 21, Infinity]];
const bump = (object, key, by = 1) => { object[key] = (object[key] ?? 0) + by; };
const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => compare(a, b)));

function summarizeMode(mode) {
  const byKindPhase = {}, byKind = {}, flagCounts = {}, shadowStatus = {}, positions = {}, positionSources = {}, notComputable = {};
  for (const row of mode.state_rows) {
    const kind = row.kind, kp = `${row.kind}:P${row.phase}`;
    byKindPhase[kp] ??= {};
    bump(byKindPhase[kp], row.primary_class);
    byKind[kind] ??= {};
    bump(byKind[kind], row.primary_class);
    if (row.not_computable_reason) bump(notComputable, row.not_computable_reason);
    shadowStatus[kind] ??= {};
    bump(shadowStatus[kind], row.shadow.status);
    if (row.flags) {
      flagCounts[kind] ??= Object.fromEntries(FLAGS.map((flag) => [flag, 0]));
      for (const flag of FLAGS) if (row.flags[flag]) flagCounts[kind][flag]++;
    }
    if (row.primary_class !== "TOP3" && row.shadow.position !== null) {
      positions[kind] ??= {};
      bump(positions[kind], POSITION_BUCKETS.find(([, lo, hi]) => row.shadow.position >= lo && row.shadow.position <= hi)[0]);
      positionSources[kind] ??= {};
      bump(positionSources[kind], row.shadow.position_source);
    }
  }
  const nest = (o) => sortObj(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, sortObj(v)])));
  return {
    evaluator_status: mode.evaluator_status, byte_identity: mode.byte_identity, states: mode.state_count,
    class_counts_by_kind_phase: nest(byKindPhase), class_counts_by_kind: nest(byKind), not_computable_reasons: sortObj(notComputable),
    flag_counts_by_kind: nest(flagCounts), shadow_status_by_kind: nest(shadowStatus),
    misses_reconstructed_position_buckets_by_kind: nest(positions), misses_reconstructed_position_source_by_kind: nest(positionSources),
  };
}

/** Aggregate-only view safe for committing: no match, team, player or champion IDs; no per-state rows. */
export function summarizeDiagnostics(result) {
  return {
    schema_version: result.schema_version, artifact_type: "current-draft-pool-diagnostics-summary", diagnostics_version: result.diagnostics_version,
    base_evaluator_version: result.base_evaluator_version, season_evaluator_version: result.season_evaluator_version,
    fixture_only: result.fixture_only, dataset_sha256: result.dataset_sha256, candidate_count: result.candidate_count,
    claims: result.claims, primary_classes: result.primary_classes, flags: result.flags,
    modes: { BASELINE: summarizeMode(result.modes.BASELINE), SEASON: result.modes.SEASON ? summarizeMode(result.modes.SEASON) : null },
    boundary: "Descriptive pool-membership diagnostics on an already-observed cohort. Not an accuracy result, not a cause attribution, " +
      "and not grounds for a rule change. Season rows are availability, not cause. Positions beyond 3 are reconstructed and reported " +
      "only where the reconstruction reproduced production's top 3 for that state.",
  };
}
