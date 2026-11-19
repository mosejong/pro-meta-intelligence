import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

/** Mutation that a frozen value may refuse with TypeError; any other error is a failure. */
function tryMutate(fn) {
  try { fn(); } catch (error) { if (!(error instanceof TypeError)) throw error; }
}

test("returned comparison values never alias fixed A, current B or caller input", async () => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const D = await vite.ssrLoadModule("/app/draft-comparison.ts");
    const C = await vite.ssrLoadModule("/app/roster-comparison.ts");
    const R = await vite.ssrLoadModule("/app/roster-scenario.ts");
    const { applyDraftSelection } = await vite.ssrLoadModule("/app/draft-agent.ts");
    const report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
    const teams = report.opponent_prep.teams;
    assert.ok(teams.length >= 3, "fixture needs a third team for the team-change case");
    const [blueTeam, redTeam, thirdTeam] = teams;
    const ids = [blueTeam.team_id, redTeam.team_id];
    const players = [...R.buildRosterIndex(teams).players.values()]
      .filter((player, i, all) => all.findIndex((other) => other.player_id === player.player_id) === i);
    assert.ok(players.length >= 10);
    const rosters = Object.fromEntries(ids.map((id, n) => [id, Object.fromEntries(R.ROSTER_ROLES.map((role, i) => {
      const player = players[n * 5 + i];
      return [role, { source_team_id: player.source_team_id, player_id: player.player_id }];
    }))]));
    const pick = (names) => names.reduce((all, id) => applyDraftSelection(all, id, [], "BLUE"), []);
    const namesA = Array.from({ length: 20 }, (_, i) => `review${i}`);
    const selectionsA = pick(namesA);
    const selectionsB = pick([...namesA.slice(0, 19), "changed19"]);
    const basis = R.rosterBasis(report);

    const inputA = { report, blueTeam, redTeam, selections: selectionsA, games: [], firstPickSide: "BLUE", roster: { basis, rosters } };
    const a = D.buildDraftComparisonSnapshot(inputA);
    assert.equal(a.ok, true, a.message);
    const rostersB = structuredClone(rosters);
    [rostersB[ids[0]].TOP, rostersB[ids[0]].JUNGLE] = [rostersB[ids[0]].JUNGLE, rostersB[ids[0]].TOP];
    rostersB[ids[1]].SUPPORT = null;
    const inputB = { ...inputA, selections: selectionsB, roster: { basis, rosters: rostersB } };
    const b = D.buildDraftComparisonSnapshot(inputB);
    assert.equal(b.ok, true, b.message);

    const callerBefore = JSON.stringify({ rosters, rostersB, selectionsA, selectionsB, basis });
    const aBefore = JSON.stringify(a.snapshot);
    const bBefore = JSON.stringify(b.snapshot);
    const topA = a.snapshot.roster.teams[ids[0]].TOP.player_id;

    const diff = D.compareDraftSnapshots(a.snapshot, b.snapshot);
    assert.equal(diff.ok, true, diff.message);
    const diffBefore = JSON.stringify(diff);
    assert.equal(diff.roster.status, "COMPARED");
    assert.equal(diff.roster.changes.length, 3);
    assert.equal(diff.changes.length, 1);

    // Roster changes: player ID and display name on both sides.
    for (const change of diff.roster.changes) {
      tryMutate(() => { if (change.a) { change.a.player_id = "tampered"; change.a.player_name = "tampered"; change.a.source_team_id = "tampered"; } });
      tryMutate(() => { if (change.b) { change.b.player_id = "tampered"; change.b.player_name = "tampered"; change.b.source_team_name = "tampered"; } });
    }
    // Selection changes: champion ID on both sides.
    for (const change of diff.changes) {
      tryMutate(() => { change.before.champion_id = "Tampered"; change.after.champion_id = "Tampered"; });
    }
    assert.equal(a.snapshot.roster.teams[ids[0]].TOP.player_id, topA);
    assert.equal(JSON.stringify(a.snapshot), aBefore, "A unchanged after editing returned roster/selection changes");
    assert.equal(JSON.stringify(b.snapshot), bBefore, "B unchanged after editing returned roster/selection changes");
    assert.equal(JSON.stringify(D.compareDraftSnapshots(a.snapshot, b.snapshot)), diffBefore, "recomparison gives the original diff");

    // Team change labels.
    const noRoster = { ...inputA, roster: null };
    const t1 = D.buildDraftComparisonSnapshot(noRoster);
    const t2 = D.buildDraftComparisonSnapshot({ ...noRoster, redTeam: thirdTeam });
    assert.equal(t1.ok && t2.ok, true);
    const t1Before = JSON.stringify(t1.snapshot), t2Before = JSON.stringify(t2.snapshot);
    const teamDiff = D.compareDraftSnapshots(t1.snapshot, t2.snapshot);
    assert.equal(teamDiff.ok, true, teamDiff.message);
    assert.equal(teamDiff.teamChanges.length, 1);
    tryMutate(() => {
      const row = teamDiff.teamChanges[0];
      row.before.id = "x"; row.before.name = "x"; row.after.id = "y"; row.after.name = "y";
    });
    assert.equal(JSON.stringify(t1.snapshot), t1Before);
    assert.equal(JSON.stringify(t2.snapshot), t2Before);
    assert.equal(t1.snapshot.teams.RED.id, redTeam.team_id);
    assert.equal(t2.snapshot.teams.RED.name, thirdTeam.team_name);

    // Export basis.
    const exported = C.rosterExport(a.snapshot.roster);
    tryMutate(() => { exported.basis.source_versions.push("tampered"); });
    tryMutate(() => { exported.basis.source_versions[0] = "tampered"; exported.basis.patch_id = "tampered"; });
    assert.equal(JSON.stringify(a.snapshot), aBefore, "editing rosterExport basis leaves the capture unchanged");

    // Direct roster comparison entry point.
    const direct = C.compareRosterCaptures(a.snapshot.roster, b.snapshot.roster);
    tryMutate(() => { for (const change of direct.changes) if (change.a) change.a.player_id = "tampered"; });
    assert.equal(JSON.stringify(a.snapshot), aBefore);

    // Caller input was neither frozen nor changed by building/comparing/mutating results.
    assert.equal(JSON.stringify({ rosters, rostersB, selectionsA, selectionsB, basis }), callerBefore);
    assert.equal(Object.isFrozen(rosters[ids[0]]), false);
    assert.equal(Object.isFrozen(selectionsA), false);
    rostersB[ids[1]].SUPPORT = rosters[ids[1]].SUPPORT; // null slot remains assignable by the caller
    rostersB[ids[1]].SUPPORT = null;

    // Side swap alone is not a roster change (compared by team ID).
    const swapped = D.buildDraftComparisonSnapshot({ ...inputA, blueTeam: redTeam, redTeam: blueTeam });
    assert.equal(swapped.ok, true, swapped.message);
    const swapDiff = D.compareDraftSnapshots(a.snapshot, swapped.snapshot);
    assert.equal(swapDiff.ok, true, swapDiff.message);
    assert.equal(swapDiff.roster.status, "COMPARED");
    assert.equal(swapDiff.roster.changes.length, 0);
  } finally { await vite.close(); }
});
