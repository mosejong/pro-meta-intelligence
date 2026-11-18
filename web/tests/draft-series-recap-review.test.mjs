import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("independent series recap review", async (t) => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { buildSeriesRecap } = await vite.ssrLoadModule("/app/draft-series-recap.ts");
    const A = await vite.ssrLoadModule("/app/draft-agent.ts");
    const { suggestSoloDraftTurn } = await vite.ssrLoadModule("/app/solo-draft.ts");
    const report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
    const own = report.opponent_prep.teams.find(team => team.team_name === "T1");
    const names = ["Karmine Corp", "Top Esports", "Invictus Gaming", "Gen.G", "LYON", "Dplus Kia", "Bilibili Gaming"];
    let example;
    await t.test("seven opponents, both first sides, three sets retain per-set identities", () => {
      for (const name of names) for (const first of ["BLUE", "RED"]) {
        const opponent = report.opponent_prep.teams.find(team => team.team_name === name);
        assert.ok(own && opponent);
        let games = [];
        for (let set = 0; set < 3; set++) {
          const [blueTeam, redTeam] = set % 2 ? [opponent, own] : [own, opponent];
          const firstPickSide = set % 2 ? (first === "BLUE" ? "RED" : "BLUE") : first;
          const previousPicks = A.fearlessLocks(games);
          let selections = [];
          while (selections.length < 20) {
            const turn = A.nextDraftTurn(selections, firstPickSide);
            const choice = suggestSoloDraftTurn({ report, blueTeam, redTeam, selections, previousPicks,
              firstPickSide, manualSide: turn.side === "BLUE" ? "RED" : "BLUE" });
            assert.ok(choice);
            selections = A.applyDraftSelection(selections, choice.champion_id, previousPicks, firstPickSide);
          }
          games = A.completeFearlessGame(games, { blue_team_id: blueTeam.team_id, red_team_id: redTeam.team_id, selections });
        }
        const before = JSON.stringify(games);
        const recap = buildSeriesRecap({ report, games });
        assert.deepEqual(recap.games.map(game => game.status), ["READY", "READY", "READY"]);
        assert.deepEqual(recap.games.map(game => game.locks_before.length), [0, 10, 20]);
        assert.equal(recap.total_locks.length, 30);
        for (let i = 0; i < 3; i++) assert.deepEqual(recap.games[i].sides.map(side => side.team_id), [games[i].blue_team_id, games[i].red_team_id]);
        assert.equal(JSON.stringify(games), before);
        example = games[0];
      }
    });
    await t.test("malformed extra report team cannot throw or produce confirmed evidence", () => {
      const corrupt = structuredClone(report);
      corrupt.opponent_prep.teams.push(null);
      let result;
      assert.doesNotThrow(() => { result = buildSeriesRecap({ report: corrupt, games: [example] }); });
      assert.equal(result.games[0].status, "UNSUPPORTED");
      assert.equal(result.total_locks, null);
    });
  } finally { await vite.close(); }
});
