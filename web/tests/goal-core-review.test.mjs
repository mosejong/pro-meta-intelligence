import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("editing a roster comparison result must preserve fixed baseline A", async () => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const D = await vite.ssrLoadModule("/app/draft-comparison.ts");
    const R = await vite.ssrLoadModule("/app/roster-scenario.ts");
    const { applyDraftSelection } = await vite.ssrLoadModule("/app/draft-agent.ts");
    const report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
    const [blueTeam, redTeam] = report.opponent_prep.teams;
    const ids = [blueTeam.team_id, redTeam.team_id];
    const players = [...R.buildRosterIndex(report.opponent_prep.teams).players.values()]
      .filter((player, i, all) => all.findIndex((other) => other.player_id === player.player_id) === i);
    assert.ok(players.length >= 10);
    const rosters = Object.fromEntries(ids.map((id, n) => [id, Object.fromEntries(R.ROSTER_ROLES.map((role, i) => {
      const player = players[n * 5 + i];
      return [role, { source_team_id: player.source_team_id, player_id: player.player_id }];
    }))]));
    const selections = Array.from({ length: 20 }, (_, i) => `review${i}`)
      .reduce((all, id) => applyDraftSelection(all, id, [], "BLUE"), []);
    const input = { report, blueTeam, redTeam, selections, games: [], firstPickSide: "BLUE",
      roster: { basis: R.rosterBasis(report), rosters } };
    const a = D.buildDraftComparisonSnapshot(input);
    assert.equal(a.ok, true, a.message);
    const before = JSON.stringify(a.snapshot);
    [rosters[ids[0]].TOP, rosters[ids[0]].JUNGLE] = [rosters[ids[0]].JUNGLE, rosters[ids[0]].TOP];
    const b = D.buildDraftComparisonSnapshot(input);
    assert.equal(b.ok, true, b.message);
    assert.equal(JSON.stringify(a.snapshot), before, "ordinary live roster edits preserve A");
    const diff = D.compareDraftSnapshots(a.snapshot, b.snapshot);
    assert.equal(diff.ok, true);
    assert.equal(diff.roster.status, "COMPARED");
    assert.equal(diff.roster.changes.length, 2);
    const change = diff.roster.changes.find((row) => row.team_id === ids[0] && row.role === "TOP");
    assert.ok(change?.a && change.b);
    try { change.a.player_id = change.b.player_id; } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
    assert.equal(a.snapshot.roster.teams[ids[0]].TOP.player_id, players[0].player_id,
      "comparison result aliases A: editing the result changed the fixed source player ID");
  } finally { await vite.close(); }
});
