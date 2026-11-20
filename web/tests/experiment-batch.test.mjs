import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("paired multi-seed experiment batch", async (t) => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const B = await vite.ssrLoadModule("/app/experiment-batch.ts");
    const E = await vite.ssrLoadModule("/app/experiment-replay.ts");
    const S = await vite.ssrLoadModule("/app/simulation-scenario.ts");
    const R = await vite.ssrLoadModule("/app/roster-scenario.ts");
    const { applyDraftSelection } = await vite.ssrLoadModule("/app/draft-agent.ts");
    const report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
    const ROLES = R.ROSTER_ROLES;
    const picks = Array.from({ length: 20 }, (_, i) => `champ${i}`).reduce((all, id) => applyDraftSelection(all, id, [], "BLUE"), []);
    const snapshotOf = (blue, red) => {
      const players = [...R.buildRosterIndex(report.opponent_prep.teams).players.values()];
      const ids = [blue.team_id, red.team_id];
      const rosters = Object.fromEntries(ids.map((id, n) => [id, Object.fromEntries(ROLES.map((role, r) => {
        const p = players[n * 5 + r]; return [role, { source_team_id: p.source_team_id, player_id: p.player_id }];
      }))]));
      const roleOf = (side) => { const p = S.teamPicks(picks, side); return Object.fromEntries(ROLES.map((role, i) => [role, p[i]])); };
      const result = S.buildSimulationReadiness({ report, blueTeam: blue, redTeam: red, selections: picks, games: [], firstPickSide: "BLUE",
        roster: { basis: R.rosterBasis(report), teamIds: ids.slice().sort(), rosters }, roles: { [blue.team_id]: roleOf("BLUE"), [red.team_id]: roleOf("RED") } });
      assert.equal(result.ok, true, JSON.stringify(result.issues));
      return structuredClone(result.snapshot);
    };
    const [teamA, teamB, teamC] = report.opponent_prep.teams;
    const snapshot = snapshotOf(teamA, teamB);
    const [, second] = [teamA.team_id, teamB.team_id].sort((x, y) => x < y ? -1 : 1);
    const neutral = () => ({ [teamA.team_id]: { ...E.NEUTRAL_DRAFT }, [teamB.team_id]: { ...E.NEUTRAL_DRAFT } });
    let counter = 0;
    const runOf = (snap, seed, drafts) => { const r = E.buildExperimentRun(++counter, snap, seed, drafts); assert.equal(r.ok, true); return r.run; };

    await t.test("pair count parsing", () => {
      assert.equal(B.parsePairCount("20").value, 20);
      assert.equal(B.parsePairCount("30").ok, true);
      for (const bad of ["0", "31", "1.5", "", "-3", "1e1", "05"]) assert.equal(B.parsePairCount(bad).ok, false, bad);
    });

    await t.test("same assumptions: every pair difference is zero; seeds and context preserved; frozen", () => {
      const a = runOf(snapshot, "3", neutral()), b = runOf(snapshot, "3", neutral());
      const r = B.runExperimentBatch(a, b, b.endMinute, B.BATCH_DEFAULT_PAIRS);
      assert.equal(r.ok, true);
      assert.deepEqual(r.seeds, B.BATCH_SEEDS.slice(0, 20));
      assert.equal(r.summary.denominator, 20);
      assert.equal(r.summary.allZero, true);
      assert.equal(r.context.inputKey, S.simulationInputKey(a.snapshot));
      for (const id of r.context.teamOrder) assert.equal(r.summary.wins[id].a, r.summary.wins[id].b);
      assert.equal(r.context.teamOrder.reduce((n, id) => n + r.summary.wins[id].a, 0), 20);
      assert.ok(Object.isFrozen(r) && Object.isFrozen(r.rows[0].delta));
    });

    await t.test("changed assumption: deterministic, keyed by source ID, inputs unchanged", () => {
      const a = runOf(snapshot, "5", neutral());
      const drafts = neutral(); drafts[second].teamfight = "0.9"; drafts[second].lane = "0.6";
      const b = runOf(snapshot, "5", drafts);
      const before = JSON.stringify([a, b]);
      const r1 = B.runExperimentBatch(a, b, b.endMinute, 7), r2 = B.runExperimentBatch(a, b, b.endMinute, 7);
      assert.equal(r1.ok, true);
      assert.deepEqual(r1, r2);
      assert.equal(r1.rows.length, 7);
      assert.equal(r1.changeKind, "MULTIPLE");
      assert.ok(r1.context.teamOrder.includes(second));
      assert.equal(JSON.stringify([a, b]), before);
    });

    await t.test("refused before B ends, for untrusted or mismatched runs and out-of-range pairs", () => {
      const a = runOf(snapshot, "3", neutral()), b = runOf(snapshot, "3", neutral());
      assert.equal(B.runExperimentBatch(a, b, 0, 20).ok, false);
      assert.equal(B.runExperimentBatch(a, structuredClone(b), b.endMinute, 20).ok, false);
      assert.equal(B.runExperimentBatch(a, b, b.endMinute, 31).ok, false);
      const other = runOf(snapshotOf(teamA, teamC), "3", { [teamA.team_id]: { ...E.NEUTRAL_DRAFT }, [teamC.team_id]: { ...E.NEUTRAL_DRAFT } });
      const r = B.runExperimentBatch(a, other, other.endMinute, 20);
      assert.equal(r.ok, false);
      assert.ok(r.refusals.some((x) => x.code === "TEAMS"));
      const diffSeed = runOf(snapshot, "4", neutral());
      assert.ok(B.runExperimentBatch(a, diffSeed, diffSeed.endMinute, 20).refusals.some((x) => x.code === "SEED"));
    });

    await t.test("stored result is marked stale instead of recomputed", () => {
      const a = runOf(snapshot, "3", neutral()), b = runOf(snapshot, "3", neutral());
      const r = B.runExperimentBatch(a, b, b.endMinute, 2);
      assert.equal(B.batchMatchesTarget(r, a.runId, b.runId), true);
      assert.equal(B.batchMatchesTarget(r, a.runId, b.runId + 1), false);
    });
  } finally { await vite.close(); }
});
