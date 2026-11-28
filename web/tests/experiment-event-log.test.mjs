import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("experiment event log: recent 8 by default, explicit full view up to the shown minute only", async (t) => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const L = await vite.ssrLoadModule("/app/experiment-event-log-panel.tsx");
    const E = await vite.ssrLoadModule("/app/experiment-replay.ts");
    const S = await vite.ssrLoadModule("/app/simulation-scenario.ts");
    const R = await vite.ssrLoadModule("/app/roster-scenario.ts");
    const { applyDraftSelection } = await vite.ssrLoadModule("/app/draft-agent.ts");
    const { ExperimentReplayPanel } = await vite.ssrLoadModule("/app/experiment-replay-panel.tsx");

    const ev = (minute, kind = "SKIRMISH", actor = "team_a", amount = 1) => ({ minute, kind, actor, amount });
    const names = { team_a: "팀A", team_b: "팀B" };
    const nameOf = (actor) => names[actor] ?? actor;
    const render = (log, runId = 1) => renderToStaticMarkup(createElement(L.ExperimentEventLogPanel, { runId, log, nameOf }));
    const rows = (html) => [...html.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));

    await t.test("same wording as the original replay log", () => {
      assert.equal(L.RECENT_EVENT_COUNT, 8);
      assert.equal(L.eventLogText(ev(3, "SKIRMISH", "team_a", 2), "팀A"), "팀A 교전 우세 (모델 킬 +2)");
      assert.equal(L.eventLogText(ev(3, "OBJECTIVE"), "팀A"), "팀A 추상 오브젝트 +1");
      assert.equal(L.eventLogText(ev(3, "BASE", "team_b", 17), "팀B"), "팀B 상대 기지 피해 17");
    });

    await t.test("0 events: empty message, no toggle", () => {
      const html = render([]);
      assert.deepEqual(rows(html), ["아직 교전·오브젝트 사건이 없습니다."]);
      assert.equal(html.includes("펼치기"), false);
      assert.equal(html.includes("aria-expanded"), false);
    });

    await t.test("exactly 8 events: all shown, no toggle", () => {
      const log = Array.from({ length: 8 }, (_, i) => ev(i + 1));
      const html = render(log);
      assert.equal(rows(html).length, 8);
      assert.equal(html.includes("펼치기"), false);
      assert.deepEqual(L.eventLogEntries(log, false, nameOf).map((e) => e.minute), [1, 2, 3, 4, 5, 6, 7, 8]);
    });

    await t.test("9+ events: folded shows the latest 8 in order with a labelled, collapsed toggle", () => {
      const log = Array.from({ length: 13 }, (_, i) => ev(i + 1, i % 2 ? "OBJECTIVE" : "SKIRMISH", i % 3 ? "team_a" : "team_b"));
      const before = structuredClone(log);
      const html = render(log);
      assert.equal(rows(html).length, 8);
      assert.match(rows(html)[0], /^6분/);
      assert.match(rows(html)[7], /^13분/);
      assert.match(html, /aria-expanded="false"/);
      assert.match(html, /전체 13건 펼치기/);
      assert.match(html, /현재 시각까지 13건 중 최근 8건/);
      const listId = html.match(/aria-controls="([^"]+)"/)[1];
      assert.match(html, new RegExp(`<ol id="${listId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
      const full = L.eventLogEntries(log, true, nameOf);
      assert.deepEqual(full.map((e) => e.minute), log.map((e) => e.minute), "expanded shows every event in log order");
      assert.equal(new Set(full.map((e) => e.key)).size, full.length, "keys are unique");
      assert.deepEqual(log, before, "log is not mutated");
    });

    await t.test("events in the same minute keep their order and distinct keys", () => {
      const log = [ev(5, "SKIRMISH", "team_b", 2), ev(5, "OBJECTIVE", "team_b"), ev(5, "BASE", "team_b", 21), ev(5, "SKIRMISH", "team_a")];
      const entries = L.eventLogEntries(log, true, nameOf);
      assert.deepEqual(entries.map((e) => e.text), ["팀B 교전 우세 (모델 킬 +2)", "팀B 추상 오브젝트 +1", "팀B 상대 기지 피해 21", "팀A 교전 우세 (모델 킬 +1)"]);
      assert.equal(new Set(entries.map((e) => e.key)).size, 4);
    });

    await t.test("GROWTH/END never shown even if present; non-arrays are empty", () => {
      const entries = L.eventLogEntries([ev(1, "GROWTH"), ev(2), ev(3, "END")], true, nameOf);
      assert.deepEqual(entries.map((e) => e.minute), [2]);
      assert.deepEqual(L.eventLogEntries(undefined, true, nameOf), []);
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
    const shownEvents = run.result.events.filter((e) => ["SKIRMISH", "OBJECTIVE", "BASE"].includes(e.kind));

    await t.test("real run: full view at minute m equals exactly the shown events with minute ≤ m (rewind excludes the future)", () => {
      assert.ok(shownEvents.length > L.RECENT_EVENT_COUNT, `fixture needs more than 8 shown events (got ${shownEvents.length})`);
      const fingerprint = JSON.stringify(run);
      for (let m = 0; m <= run.endMinute; m += 1) {
        const full = L.eventLogEntries(E.replayFrame(run, m).log, true, nameOf);
        const expected = shownEvents.filter((e) => e.minute <= m);
        assert.deepEqual(full.map((e) => [e.minute, e.text]), expected.map((e) => [e.minute, L.eventLogText(e, nameOf(e.actor))]), `minute ${m}`);
        assert.ok(full.every((e) => e.minute <= m), `no future event at minute ${m}`);
      }
      // Going forward then back (a rewind) gives the same rows as visiting that minute fresh.
      const mid = Math.floor(run.endMinute / 2);
      const afterEnd = L.eventLogEntries(E.replayFrame(run, run.endMinute).log, true, nameOf);
      const rewound = L.eventLogEntries(E.replayFrame(run, mid).log, true, nameOf);
      assert.ok(rewound.length < afterEnd.length);
      assert.deepEqual(rewound, L.eventLogEntries(E.replayFrame(run, mid).log, true, nameOf));
      assert.equal(JSON.stringify(run), fingerprint, "reading the log never changes the fixed run");
    });

    await t.test("real run: same seed and inputs give the same full log regardless of playback path/speed", () => {
      const again = E.buildExperimentRun(2, structuredClone(ready.snapshot), "7", drafts);
      assert.equal(again.ok, true);
      const atEnd = (r) => L.eventLogEntries(E.replayFrame(r, r.endMinute).log, true, nameOf).map((e) => [e.minute, e.text]);
      assert.deepEqual(atEnd(again.run), atEnd(run));
      for (const speed of E.SPEEDS) {
        let state = E.playbackReducer(E.playbackReducer(E.INITIAL_PLAYBACK, { type: "LOAD", runId: 1, endMinute: run.endMinute }), { type: "SPEED", speed });
        state = E.playbackReducer(state, { type: "PLAY" });
        for (let i = 0; i < 100 && state.playing; i += 1) state = E.playbackReducer(state, { type: "TICK", runId: 1 });
        assert.equal(state.cursor, run.endMinute, `speed ${speed}`);
        assert.deepEqual(L.eventLogEntries(E.replayFrame(run, state.cursor).log, true, nameOf).map((e) => [e.minute, e.text]), atEnd(run));
      }
    });

    await t.test("replay panel renders no log before a run exists", () => {
      const html = renderToStaticMarkup(createElement(ExperimentReplayPanel, { readyInput: ready.snapshot, blocked: false, nameOf: (id) => id }));
      assert.equal(html.includes("지금까지의 모델 사건"), false);
      assert.equal(html.includes("펼치기"), false);
    });
  } finally {
    await vite.close();
  }
});
