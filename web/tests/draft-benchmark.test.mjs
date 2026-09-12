import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

test("historical draft evaluation measures the production preview and rejects leakage", async (t) => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { evaluateDraftBenchmark } = await vite.ssrLoadModule("/app/draft-benchmark.ts");
    const { applyDraftSelection, previewOpponentPick, STANDARD_DRAFT_SEQUENCE } = await vite.ssrLoadModule("/app/draft-agent.ts");
    const { canAssignDistinctRoles, observedChampionRoles, previewRoleExperiment } = await vite.ssrLoadModule("/app/draft-role-experiment.ts");
    const report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
    report.fixture_only = true;
    report.opponent_prep.fixture_only = true;
    report.entries = [];
    report.opponent_prep.teams = report.opponent_prep.teams.slice(0, 2);
    report.opponent_prep.team_count = 2;
    const hash = `sha256:${"a".repeat(64)}`;
    for (const source of [...report.evidence_index.source_versions, ...report.opponent_prep.evidence_index.source_versions]) source.content_hash = hash;
    const [blue, red] = report.opponent_prep.teams;
    for (const [index, team] of [blue, red].entries()) {
      team.priority_picks = Array.from({ length: 5 }, (_, rank) => ({ champion_id: `${index ? "Red" : "Blue"}${rank + 1}`, game_count: 5 - rank, game_rate: (5 - rank) / 10, phase_1_count: 0, phase_2_count: 0, evidence_event_ids: [`prior-${index}-${rank}`] }));
    }
    let selections = [];
    for (const turn of STANDARD_DRAFT_SEQUENCE) {
      selections = applyDraftSelection(selections, turn.kind === "PICK" ? `${turn.side === "BLUE" ? "Blue" : "Red"}${turn.slot}` : `Ban${selections.length}`);
    }
    const dataset = {
      schema_version: "1", artifact_type: "draft-historical-dataset", fixture_only: true, scope: "FIRST_SET_IMMEDIATE_OPPONENT_PICK",
      snapshots: [{ id: "test-snapshot", cutoff: report.cutoff, source_hash: hash, report }],
      matches: [{ snapshot_id: "test-snapshot", match_id: "held-out-fixture", game_number: 1, league: "TEST", patch_id: report.patch_id,
        observed_at: new Date(Date.parse(report.cutoff) + 86400000).toISOString(), outcome_retrieved_at: new Date(Date.parse(report.cutoff) + 172800000).toISOString(),
        outcome_source_hash: `sha256:${"b".repeat(64)}`, blue_team_id: blue.team_id, red_team_id: red.team_id, selections }],
    };
    await t.test("role matching preserves flex alternatives and unknown picks", () => {
      const roles = new Map([["flex", new Set(["TOP", "MID"])], ["mid", new Set(["MID"])], ["top", new Set(["TOP"])]]);
      assert.equal(canAssignDistinctRoles(["Flex", "Mid"], roles), true);
      assert.equal(canAssignDistinctRoles(["Flex", "Mid", "Top"], roles), false);
      assert.equal(canAssignDistinctRoles(["Flex", "Mid", "Unknown"], roles), true);
      assert.equal(canAssignDistinctRoles(["A", "B", "C", "D", "E", "F"], roles), false);
    });
    await t.test("observed role feasibility reranks the full legal pool without changing production", () => {
      const clone = structuredClone(report);
      const [b, r] = clone.opponent_prep.teams;
      b.recent_games = [];
      r.recent_games = [];
      const roleOrder = ["TOP", "JUNGLE", "MID", "MID", "BOTTOM"];
      r.priority_picks.forEach((pick, index) => { pick.role = roleOrder[index]; });
      r.priority_picks.push({ ...r.priority_picks[4], champion_id: "Red6", role: "SUPPORT", game_rate: 0.05 });
      const before = JSON.stringify(clone);
      assert.deepEqual(previewOpponentPick(clone, b, r, selections.slice(0, 15), selections[15].champion_id).candidates.map((item) => item.champion_id), ["Red4", "Red5", "Red6"]);
      const result = previewRoleExperiment(clone, b, r, selections.slice(0, 15), selections[15].champion_id);
      assert.deepEqual(result.candidates.map((item) => item.champion_id), ["Red5", "Red6", "Red4"]);
      assert.equal(JSON.stringify(clone), before);
      r.priority_picks.push({ ...r.priority_picks[3], role: "SUPPORT" });
      assert.deepEqual([...observedChampionRoles(clone, r).get("red4")].sort(), ["MID", "SUPPORT"]);
      assert.equal(previewRoleExperiment(clone, b, r, selections.slice(0, 15), selections[15].champion_id).candidates[0].champion_id, "Red4");
      const withLock = previewRoleExperiment(clone, b, r, selections.slice(0, 15), selections[15].champion_id, ["Red4"]);
      assert.equal(withLock.candidates.some((item) => item.champion_id === "Red4"), false);
    });
    await t.test("known ranks, legal candidates, all seven immediate responses and deterministic output", () => {
      const before = JSON.stringify(dataset);
      const result = evaluateDraftBenchmark(dataset);
      assert.equal(result.status, "FIXTURE_ONLY");
      assert.equal(result.match_count, 1);
      assert.equal(result.case_count, 7);
      assert.deepEqual(result.case_results.map((item) => item.target_turn), [7, 8, 10, 12, 17, 18, 20]);
      for (const metrics of [result.model, result.baseline]) {
        assert.equal(metrics.top1_accuracy, 1);
        assert.equal(metrics.top3_recall, 1);
        assert.equal(metrics.mrr_at_3, 1);
        assert.equal(metrics.illegal_candidates, 0);
      }
      assert.deepEqual(evaluateDraftBenchmark(dataset), result);
      assert.equal(JSON.stringify(dataset), before);
      const reordered = structuredClone(dataset);
      reordered.snapshots[0].report.opponent_prep.teams.forEach((team) => team.priority_picks.reverse());
      assert.deepEqual(evaluateDraftBenchmark(reordered), result);
    });
    await t.test("experimental evaluation is explicit, reproducible and never promoted", () => {
      const result = evaluateDraftBenchmark(dataset, { roleExperiment: true });
      assert.equal(result.role_experiment.version, "observed-role-feasibility-v1");
      assert.equal(result.role_experiment.deployed, false);
      assert.equal(result.role_experiment.metrics.cases, 7);
      assert.equal(result.role_experiment.metrics.illegal_candidates, 0);
      assert.equal(result.role_experiment.by_league_patch[0].matches, 1);
      assert.deepEqual(evaluateDraftBenchmark(dataset, { roleExperiment: true }), result);
      assert.equal(evaluateDraftBenchmark(dataset).role_experiment, undefined);
      const invalid = structuredClone(dataset);
      invalid.snapshots[0].report.opponent_prep.teams[0].recent_games = [{
        match_id: "future-role-game", observed_at: dataset.matches[0].observed_at,
        league: "TEST", tournament: "TEST", side: "BLUE", opponent_team_id: red.team_id,
        opponent_team_name: red.team_name, result: "WIN", first_pick: true, picks: [],
      }];
      assert.throws(() => evaluateDraftBenchmark(invalid, { roleExperiment: true }), /Future role evidence/);
    });
    await t.test("rank two contributes half reciprocal rank, not a top-one hit", () => {
      const ranked = structuredClone(dataset);
      ranked.snapshots[0].report.opponent_prep.teams[0].priority_picks[0].game_rate = 0.35;
      const result = evaluateDraftBenchmark(ranked);
      for (const metrics of [result.model, result.baseline]) {
        assert.equal(metrics.top1_hits, 6);
        assert.equal(metrics.top3_hits, 7);
        assert.equal(metrics.reciprocal_rank_sum, 6.5);
        assert.equal(metrics.mrr_at_3, 0.928571);
      }
    });
    await t.test("abstentions remain in the denominator; empty datasets have no accuracy", () => {
      const empty = structuredClone(dataset);
      empty.snapshots[0].report.opponent_prep.teams.forEach((team) => { team.priority_picks = []; });
      const result = evaluateDraftBenchmark(empty);
      assert.equal(result.model.cases, 7);
      assert.equal(result.model.covered, 0);
      assert.equal(result.model.top3_recall, 0);
      empty.matches = [];
      assert.equal(evaluateDraftBenchmark(empty).model.top3_recall, null);
    });
    for (const [name, mutate, error] of [
      ["same-time candidate", (data) => { data.matches[0].observed_at = report.cutoff; }, /Future leakage/],
      ["outcome retrieved too early", (data) => { data.matches[0].outcome_retrieved_at = report.cutoff; }, /Future leakage/],
      ["same source", (data) => { data.matches[0].outcome_source_hash = hash; }, /distinct later source/],
      ["target in team evidence", (data) => { data.snapshots[0].report.opponent_prep.teams[0].evidence.match_ids.push("held-out-fixture"); }, /Target match/],
      ["duplicate match", (data) => { data.matches.push(structuredClone(data.matches[0])); }, /Duplicate outcome/],
      ["later set", (data) => { data.matches[0].game_number = 2; }, /first-set/],
      ["invalid turn", (data) => { data.matches[0].selections[0].side = "RED"; }, /draft order/],
      ["already banned outcome", (data) => { data.matches[0].selections[6].champion_id = data.matches[0].selections[0].champion_id; }, /Duplicate or empty/],
      ["mixed fixture label", (data) => { data.fixture_only = false; }, /Fixture\/real/],
      ["corrupted ranking input", (data) => { data.snapshots[0].report.opponent_prep.teams[0].priority_picks[0].game_rate = Infinity; }, /ranking inputs/],
    ]) {
      await t.test(`rejects ${name}`, () => {
        const invalid = structuredClone(dataset);
        mutate(invalid);
        assert.throws(() => evaluateDraftBenchmark(invalid), error);
      });
    }
  } finally { await vite.close(); }
});
