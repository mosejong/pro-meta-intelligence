import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("authored simulation example: legal draft, explicit roles, unchanged current roster, existing readiness", async (t) => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const E = await vite.ssrLoadModule("/app/simulation-example.ts");
    const R = await vite.ssrLoadModule("/app/roster-scenario.ts");
    const { draftSequence } = await vite.ssrLoadModule("/app/draft-agent.ts");
    const { SimulationExamplePanel } = await vite.ssrLoadModule("/app/simulation-example-panel.tsx");
    const report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
    const teams = report.opponent_prep.teams;
    const index = R.buildRosterIndex(teams);
    const liveRoster = (blue, red) => {
      const ids = [blue.team_id, red.team_id];
      return { basis: R.rosterBasis(report), teamIds: ids.slice().sort(), rosters: R.observedRosters(teams, ids, index) };
    };
    const full = (roster) => Object.values(roster.rosters).every((slots) => R.ROSTER_ROLES.every((role) => slots[role]));
    // First pair of real teams whose current observed default roster is complete.
    let pair = null;
    for (let i = 0; i < teams.length && !pair; i++) for (let j = i + 1; j < teams.length && !pair; j++) {
      if (full(liveRoster(teams[i], teams[j]))) pair = [teams[i], teams[j]];
    }
    assert.ok(pair, "feed needs two teams with a complete observed current roster");
    const [blue, red] = pair;
    const base = (over = {}) => ({ report, blueTeam: blue, redTeam: red, firstPickSide: "BLUE", roster: liveRoster(blue, red), ...over });
    const fail = (input) => { const result = E.buildSimulationExample(input); assert.equal(result.ok, false); assert.ok(result.message); return result.message; };

    await t.test("example IDs are known, distinct champions", () => {
      assert.equal(E.exampleChampionsValid(), true);
    });

    for (const side of ["BLUE", "RED"]) await t.test(`legal 20 turns and ready input with ${side} first`, () => {
      const input = base({ firstPickSide: side });
      const result = E.buildSimulationExample(input);
      assert.equal(result.ok, true, result.message);
      const { selections, roles, snapshot } = result;
      assert.equal(selections.length, 20);
      draftSequence(side).forEach((turn, i) => {
        assert.deepEqual([selections[i].side, selections[i].kind, selections[i].slot, selections[i].turn], [turn.side, turn.kind, turn.slot, i + 1]);
      });
      assert.equal(new Set(selections.map((s) => s.champion_id.toLowerCase())).size, 20);
      for (const s of ["BLUE", "RED"]) {
        assert.equal(selections.filter((x) => x.side === s && x.kind === "PICK").length, 5);
        assert.equal(selections.filter((x) => x.side === s && x.kind === "BAN").length, 5);
      }
      assert.deepEqual(roles, { [blue.team_id]: { ...E.EXAMPLE_PICKS.BLUE }, [red.team_id]: { ...E.EXAMPLE_PICKS.RED } });
      assert.deepEqual(snapshot.roles, roles);
      assert.equal(snapshot.roleSource, "USER_ASSIGNED");
      assert.equal(snapshot.draft.firstPickSide, side);
      // Roster is the provided current roster, unchanged: ten distinct players.
      const players = new Set();
      for (const id of [blue.team_id, red.team_id]) for (const role of R.ROSTER_ROLES) {
        const slot = snapshot.draft.roster.teams[id][role];
        assert.deepEqual([slot.source_team_id, slot.player_id], [input.roster.rosters[id][role].source_team_id, input.roster.rosters[id][role].player_id]);
        players.add(slot.player_id);
      }
      assert.equal(players.size, 10);
    });

    await t.test("inputs untouched and not frozen; outputs detached from the snapshot", () => {
      const input = base();
      const before = structuredClone(input.roster);
      const result = E.buildSimulationExample(input);
      assert.equal(result.ok, true);
      assert.deepEqual(input.roster, before);
      assert.equal(Object.isFrozen(input.roster.rosters), false);
      assert.equal(Object.isFrozen(input.roster.basis), false);
      assert.equal(Object.isFrozen(report), false);
      assert.equal(Object.isFrozen(result.selections), false);
      assert.equal(Object.isFrozen(result.roles[blue.team_id]), false);
      assert.ok(Object.isFrozen(result.snapshot));
      result.roles[blue.team_id].TOP = "X";
      result.selections[0].champion_id = "X";
      assert.equal(result.snapshot.roles[blue.team_id].TOP, "Gnar");
      assert.notEqual(result.snapshot.draft.selections[0].champion_id, "X");
      assert.equal(E.EXAMPLE_PICKS.BLUE.TOP, "Gnar");
    });

    await t.test("rejects missing, mismatched, empty and duplicate rosters and bad inputs", () => {
      fail(base({ roster: null }));
      fail(base({ roster: { ...liveRoster(blue, red), basis: { ...R.rosterBasis(report), cutoff: "1999-01-01" } } }));
      const other = teams.find((team) => team.team_id !== blue.team_id && team.team_id !== red.team_id);
      if (other) fail(base({ roster: liveRoster(blue, other) }));
      const empty = liveRoster(blue, red);
      empty.rosters[red.team_id].MID = null;
      assert.match(fail(base({ roster: empty })), new RegExp(red.team_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      const dup = liveRoster(blue, red);
      dup.rosters[red.team_id].TOP = { ...dup.rosters[blue.team_id].TOP };
      fail(base({ roster: dup }));
      fail(base({ redTeam: blue }));
      fail(base({ blueTeam: null }));
      fail(base({ redTeam: { ...red, team_id: "not-in-feed" } }));
      fail(base({ firstPickSide: "GREEN" }));
      fail(base({ hasHistoricalPlayers: true }));
    });

    await t.test("guard reasons", () => {
      const ok = { canSelect: true, roomActive: false, selections: 0, games: 0, pendingChampion: false, hasHistoricalPlayers: false };
      assert.equal(E.exampleBlockReason(ok), null);
      for (const over of [{ canSelect: false }, { roomActive: true }, { selections: 1 }, { games: 1 }, { pendingChampion: true }, { hasHistoricalPlayers: true }]) {
        assert.ok(E.exampleBlockReason({ ...ok, ...over }));
      }
    });

    await t.test("panel: collapsed details, keyboard button, reasons", () => {
      const props = { ...base(), hasHistoricalPlayers: false, nameOf: (id) => id, blockReason: null, onApply: () => {} };
      const ready = renderToStaticMarkup(createElement(SimulationExamplePanel, props));
      assert.match(ready, /^<details class="simulation-example"[^>]*>/);
      assert.doesNotMatch(ready, /<details[^>]* open/);
      assert.match(ready, /<summary>처음이라면 예시로 체험<\/summary>/);
      assert.match(ready, /<button type="button" class="simulation-example-apply">이 예시로 입력 준비<\/button>/);
      assert.ok(ready.includes(blue.team_name) && ready.includes(red.team_name));
      const blocked = renderToStaticMarkup(createElement(SimulationExamplePanel, { ...props, blockReason: "진행 중" }));
      assert.match(blocked, /<button type="button" class="simulation-example-apply" disabled="">/);
      assert.match(blocked, /진행 중/);
      const noRoster = renderToStaticMarkup(createElement(SimulationExamplePanel, { ...props, roster: null }));
      assert.match(noRoster, /disabled=""/);
      assert.match(noRoster, /선수 구성/);
    });
  } finally {
    await vite.close();
  }
});
