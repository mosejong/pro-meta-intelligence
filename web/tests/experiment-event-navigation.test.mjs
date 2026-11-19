import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("experiment event navigation: display-only jumps over a fixed run", async (t) => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { eventNavigation } = await vite.ssrLoadModule("/app/experiment-event-navigation.ts");
    const E = await vite.ssrLoadModule("/app/experiment-replay.ts");
    const S = await vite.ssrLoadModule("/app/simulation-scenario.ts");
    const R = await vite.ssrLoadModule("/app/roster-scenario.ts");
    const { applyDraftSelection } = await vite.ssrLoadModule("/app/draft-agent.ts");
    const { ExperimentReplayPanel } = await vite.ssrLoadModule("/app/experiment-replay-panel.tsx");

    const ev = (minute, kind, actor = "team_a", amount = 1) => ({ minute, kind, actor, amount });
    const fixture = (events, endMinute) => ({ endMinute, result: { minute: endMinute, events } });

    await t.test("unique, sorted shown-event minutes; GROWTH/END and out-of-range excluded; input unchanged", () => {
      const run = fixture([
        ev(9, "OBJECTIVE"), ev(3, "SKIRMISH"), ev(3, "SKIRMISH", "team_b"), ev(1, "GROWTH"), ev(5, "GROWTH"),
        ev(12, "BASE"), ev(20, "END"), ev(2.5, "SKIRMISH"), ev(-1, "SKIRMISH"), ev(21, "OBJECTIVE"), ev(Number.NaN, "BASE"),
      ], 20);
      const before = structuredClone(run);
      const nav = eventNavigation(run, 0);
      assert.deepEqual(nav.eventMinutes, [3, 9, 12]);
      assert.equal(nav.endMinute, 20);
      assert.deepEqual(run, before, "input is not mutated");
      nav.eventMinutes.push(99);
      assert.deepEqual(eventNavigation(run, 0).eventMinutes, [3, 9, 12], "returned arrays are fresh");
    });

    await t.test("previous/next are strict neighbours of the normalised cursor", () => {
      const run = fixture([ev(3, "SKIRMISH"), ev(9, "OBJECTIVE"), ev(12, "BASE")], 20);
      const at = (m) => { const n = eventNavigation(run, m); return [n.previousMinute, n.nextMinute]; };
      assert.deepEqual(at(0), [null, 3]);
      assert.deepEqual(at(3), [null, 9]);
      assert.deepEqual(at(4), [3, 9]);
      assert.deepEqual(at(9), [3, 12]);
      assert.deepEqual(at(9.9), [3, 12], "floored like replayFrame");
      assert.deepEqual(at(12), [9, null]);
      assert.deepEqual(at(20), [12, null]);
      assert.deepEqual(at(500), [12, null], "clamped to endMinute");
      assert.deepEqual(at(-5), [null, 3], "clamped to 0");
      for (const bad of [Number.NaN, Infinity, -Infinity]) assert.deepEqual(at(bad), [null, 3], String(bad));
    });

    await t.test("no events still allows the result jump; end minute 0 is valid", () => {
      assert.deepEqual(eventNavigation(fixture([ev(4, "GROWTH")], 15), 2), { previousMinute: null, nextMinute: null, endMinute: 15, eventMinutes: [] });
      assert.deepEqual(eventNavigation(fixture([ev(0, "SKIRMISH")], 0), 0), { previousMinute: null, nextMinute: null, endMinute: 0, eventMinutes: [0] });
    });

    await t.test("invalid endMinute refuses everything", () => {
      const refused = { previousMinute: null, nextMinute: null, endMinute: null, eventMinutes: [] };
      for (const end of [-1, 1.5, Number.NaN, Infinity, E.MAX_MINUTE + 1, "10", null, undefined]) {
        assert.deepEqual(eventNavigation(fixture([ev(3, "SKIRMISH")], end), 2), refused, String(end));
      }
    });

    // Real fixed run, built the same way as the replay tests.
    const report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
    const [blue, red] = report.opponent_prep.teams;
    const ROLES = R.ROSTER_ROLES;
    const players = [...R.buildRosterIndex(report.opponent_prep.teams).players.values()];
    const selections = Array.from({ length: 20 }, (_, i) => i).reduce((all, i) => applyDraftSelection(all, `champ${i}`, [], "BLUE"), []);
    const ids = [blue.team_id, red.team_id];
    const rosters = Object.fromEntries(ids.map((id, n) => [id, Object.fromEntries(ROLES.map((role, r) => {
      const p = players[n * 5 + r]; return [role, { source_team_id: p.source_team_id, player_id: p.player_id }];
    }))]));
    const roles = {
      [blue.team_id]: Object.fromEntries(ROLES.map((role, i) => [role, S.teamPicks(selections, "BLUE")[i]])),
      [red.team_id]: Object.fromEntries(ROLES.map((role, i) => [role, S.teamPicks(selections, "RED")[i]])),
    };
    const ready = S.buildSimulationReadiness({ report, blueTeam: blue, redTeam: red, selections, games: [], firstPickSide: "BLUE",
      roster: { basis: R.rosterBasis(report), teamIds: ids.slice().sort(), rosters }, roles });
    assert.equal(ready.ok, true, JSON.stringify(ready.issues));
    const drafts = { [blue.team_id]: { lane: "0.6", tempo: "0.2", teamfight: "0.4" }, [red.team_id]: { ...E.NEUTRAL_DRAFT } };
    const built = E.buildExperimentRun(1, structuredClone(ready.snapshot), "7", drafts);
    assert.equal(built.ok, true, JSON.stringify(built.issues));
    const run = built.run;

    await t.test("real run: stops match the replay log and jumps only move the shown cursor", () => {
      const fingerprint = JSON.stringify({ snapshot: run.snapshot, result: run.result, seed: run.seed, end: run.endMinute });
      const shown = E.replayFrame(run, run.endMinute).log.map((e) => e.minute);
      const nav0 = eventNavigation(run, 0);
      assert.deepEqual(nav0.eventMinutes, [...new Set(shown)].sort((a, b) => a - b));
      assert.equal(nav0.endMinute, run.endMinute);

      // Walk forward with PAUSE then SEEK, as the panel does, starting from a playing state.
      let state = E.playbackReducer(E.playbackReducer(E.INITIAL_PLAYBACK, { type: "LOAD", runId: run.runId, endMinute: run.endMinute }), { type: "PLAY" });
      const jump = (minute) => { state = E.playbackReducer(E.playbackReducer(state, { type: "PAUSE" }), { type: "SEEK", minute }); };
      const visited = [];
      for (let next = eventNavigation(run, state.cursor).nextMinute; next !== null; next = eventNavigation(run, state.cursor).nextMinute) {
        jump(next);
        assert.equal(state.playing, false, "jump leaves playback paused");
        assert.equal(state.cursor, next);
        visited.push(next);
      }
      assert.deepEqual(visited, nav0.eventMinutes.filter((m) => m > 0));
      for (let prev = eventNavigation(run, state.cursor).previousMinute; prev !== null; prev = eventNavigation(run, state.cursor).previousMinute) {
        jump(prev);
        assert.equal(state.cursor, prev);
      }
      jump(eventNavigation(run, state.cursor).endMinute);
      assert.equal(state.cursor, run.endMinute);
      assert.equal(state.playing, false);
      assert.equal(E.replayFrame(run, state.cursor).complete, true);
      assert.equal(JSON.stringify({ snapshot: run.snapshot, result: run.result, seed: run.seed, end: run.endMinute }), fingerprint,
        "navigation never changes the fixed run");
    });

    await t.test("panel renders no navigation before a run exists", () => {
      const html = renderToStaticMarkup(createElement(ExperimentReplayPanel, { readyInput: ready.snapshot, blocked: false, nameOf: (id) => id }));
      for (const label of ["사건 단위로 이동", "이전 사건", "다음 사건", "결과까지 이동"]) assert.equal(html.includes(label), false, label);
    });
  } finally {
    await vite.close();
  }
});
