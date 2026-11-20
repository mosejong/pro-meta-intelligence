import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("comparison and display must not execute the simulation again", async () => {
  globalThis.__comparisonReviewCalls = 0;
  let instrumented = false;
  const anchor = "export function simulateManager(input: ManagerInput): ManagerResult {";
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent",
    plugins: [{ name: "independent-simulation-call-counter", enforce: "pre", transform(code, id) {
      if (!id.replaceAll("\\", "/").endsWith("/simulation-core.ts")) return;
      assert.ok(code.includes(anchor)); instrumented = true;
      return code.replace(anchor, `${anchor}\n globalThis.__comparisonReviewCalls = (globalThis.__comparisonReviewCalls ?? 0) + 1;`);
    } }],
  });
  try {
    const E = await vite.ssrLoadModule("/app/experiment-replay.ts");
    const X = await vite.ssrLoadModule("/app/experiment-comparison.ts");
    const S = await vite.ssrLoadModule("/app/simulation-scenario.ts");
    const R = await vite.ssrLoadModule("/app/roster-scenario.ts");
    const A = await vite.ssrLoadModule("/app/draft-agent.ts");
    const report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
    const [blue, red] = report.opponent_prep.teams;
    const players = [...R.buildRosterIndex(report.opponent_prep.teams).players.values()];
    const selections = Array.from({ length: 20 }, (_, i) => `review${i}`).reduce((all, id) => A.applyDraftSelection(all, id, [], "BLUE"), []);
    const ids = [blue.team_id, red.team_id];
    const rosters = Object.fromEntries(ids.map((id, n) => [id, Object.fromEntries(R.ROSTER_ROLES.map((role, i) => {
      const player = players[n * 5 + i];
      return [role, { source_team_id: player.source_team_id, player_id: player.player_id }];
    }))]));
    const roles = Object.fromEntries(ids.map((id, n) => [id, Object.fromEntries(R.ROSTER_ROLES.map((role, i) => [role, S.teamPicks(selections, n ? "RED" : "BLUE")[i]]))]));
    const ready = S.buildSimulationReadiness({ report, blueTeam: blue, redTeam: red, selections, games: [], firstPickSide: "BLUE",
      roster: { basis: R.rosterBasis(report), teamIds: ids.slice().sort(), rosters }, roles });
    assert.ok(ready.ok);
    const values = Object.fromEntries(ids.map(id => [id, { lane: "0", tempo: "0", teamfight: "0" }]));
    const a = E.buildExperimentRun(1, ready.snapshot, "17", values);
    const b = E.buildExperimentRun(2, ready.snapshot, "17", { ...values, [ids[0]]: { ...values[ids[0]], teamfight: "0.35" } });
    assert.ok(instrumented && a.ok && b.ok);
    assert.equal(globalThis.__comparisonReviewCalls, 2);
    const kept = X.freezeBaseline(a.run, a.run.endMinute);
    assert.ok(kept.ok);
    const middle = X.compareExperimentRuns(kept.baseline, b.run, 1);
    const end = X.compareExperimentRuns(kept.baseline, b.run, b.run.endMinute);
    assert.ok(middle.ok && end.ok);
    assert.equal(middle.outcome, null);
    assert.ok(end.outcome);
    assert.equal(globalThis.__comparisonReviewCalls, 2, "only the two explicit runs may invoke the model");
  } finally { await vite.close(); delete globalThis.__comparisonReviewCalls; }
});
