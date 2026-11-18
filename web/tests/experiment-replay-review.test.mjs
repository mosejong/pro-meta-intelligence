import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("independent experiment replay review", async (t) => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const E = await vite.ssrLoadModule("/app/experiment-replay.ts");
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
    const drafts = Object.fromEntries(ids.map(id => [id, { lane: "0", tempo: "0", teamfight: "0" }]));

    await t.test("forty deterministic runs conserve terminal states and hide future outcomes at every minute", () => {
      for (let seed = 0; seed < 40; seed++) {
        const built = E.buildExperimentRun(seed + 1, ready.snapshot, String(seed), drafts);
        assert.ok(built.ok);
        const run = built.run;
        let previous = E.replayFrame(run, 0);
        assert.deepEqual(previous.states.team_a, { gold: 2500, kills: 0, objectives: 0, base: 100 });
        for (let minute = 1; minute <= run.endMinute; minute++) {
          const frame = E.replayFrame(run, minute);
          assert.ok(frame.log.every(event => event.minute <= minute && event.kind !== "END"));
          if (minute < run.endMinute) assert.equal(frame.outcome, null);
          for (const id of ["team_a", "team_b"]) {
            assert.ok(frame.states[id].gold >= previous.states[id].gold);
            assert.ok(frame.states[id].base <= previous.states[id].base && frame.states[id].base >= 0);
          }
          previous = frame;
        }
        assert.deepEqual(previous.states, run.result.states);
        assert.equal(previous.outcome.winner, run.result.winner);
        assert.equal(E.replayFrame(run, 0).outcome, null);
      }
    });
    await t.test("future result fields cannot affect an earlier visible frame", () => {
      const built = E.buildExperimentRun(1, ready.snapshot, "17", drafts);
      assert.ok(built.ok);
      const mid = Math.floor(built.run.endMinute / 2);
      const before = E.replayFrame(built.run, mid);
      const altered = structuredClone(built.run);
      altered.result.states.team_a.gold += 999999;
      altered.result.winner = "future-hidden";
      altered.result.events.push({ minute: mid + 1, kind: "GROWTH", actor: "team_a", amount: 999999 });
      assert.deepEqual(E.replayFrame(altered, mid), before);
    });
    await t.test("inherited assumptions cannot stand in for explicitly supplied team values", () => {
      const inherited = Object.create(drafts);
      assert.equal(E.validateRunInputs(ready.snapshot, "1", inherited).ok, false);
      const inheritedFields = Object.fromEntries(ids.map(id => [id, Object.create(drafts[id])]));
      assert.equal(E.validateRunInputs(ready.snapshot, "1", inheritedFields).ok, false);
    });
  } finally { await vite.close(); }
});
