import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("fixed-draft assumption experiment: adapter, mapping, frames and playback", async (t) => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const E = await vite.ssrLoadModule("/app/experiment-replay.ts");
    const C = await vite.ssrLoadModule("/app/simulation-core.ts");
    const S = await vite.ssrLoadModule("/app/simulation-scenario.ts");
    const R = await vite.ssrLoadModule("/app/roster-scenario.ts");
    const { applyDraftSelection } = await vite.ssrLoadModule("/app/draft-agent.ts");
    const { ExperimentReplayPanel } = await vite.ssrLoadModule("/app/experiment-replay-panel.tsx");
    const report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
    const [teamA, teamB] = report.opponent_prep.teams;
    const ROLES = R.ROSTER_ROLES;
    const players = [...R.buildRosterIndex(report.opponent_prep.teams).players.values()];
    const selections = Array.from({ length: 20 }, (_, i) => i).reduce((all, i) => applyDraftSelection(all, `champ${i}`, [], "BLUE"), []);
    const snapshotOf = (blue, red) => {
      const ids = [blue.team_id, red.team_id];
      const rosters = Object.fromEntries(ids.map((id, n) => [id, Object.fromEntries(ROLES.map((role, r) => {
        const p = players[n * 5 + r]; return [role, { source_team_id: p.source_team_id, player_id: p.player_id }];
      }))]));
      const roles = {
        [blue.team_id]: Object.fromEntries(ROLES.map((role, i) => [role, S.teamPicks(selections, "BLUE")[i]])),
        [red.team_id]: Object.fromEntries(ROLES.map((role, i) => [role, S.teamPicks(selections, "RED")[i]])),
      };
      const result = S.buildSimulationReadiness({ report, blueTeam: blue, redTeam: red, selections, games: [], firstPickSide: "BLUE",
        roster: { basis: R.rosterBasis(report), teamIds: ids.slice().sort(), rosters }, roles });
      assert.equal(result.ok, true, JSON.stringify(result.issues));
      return structuredClone(result.snapshot);
    };
    const snapshot = snapshotOf(teamA, teamB);
    const neutral = () => ({ [teamA.team_id]: { ...E.NEUTRAL_DRAFT }, [teamB.team_id]: { ...E.NEUTRAL_DRAFT } });
    const drafts = (a, b) => ({ [teamA.team_id]: a, [teamB.team_id]: b });
    const runOf = (snap, seed, d, id = 1) => { const r = E.buildExperimentRun(id, snap, seed, d); assert.equal(r.ok, true, JSON.stringify(r.issues)); return r.run; };

    await t.test("seed and assumption parsing: exact, no silent clamp or fallback", () => {
      for (const ok of ["0", "1", "4294967295", " 42 "]) assert.equal(E.parseSeed(ok).ok, true, ok);
      for (const bad of ["", " ", "-1", "4294967296", "1.5", "1e3", "0x10", "+1", "01", "NaN", "Infinity", undefined]) assert.equal(E.parseSeed(bad).ok, false, String(bad));
      for (const [text, value] of [["0", 0], ["-1", -1], ["1", 1], ["0.25", 0.25], ["-0", 0], [".5", 0.5]]) assert.deepEqual(E.parseAssumption(text), { ok: true, value });
      for (const bad of ["", "1.01", "-1.5", "Infinity", "NaN", "1e0", "abc", "0x1"]) assert.equal(E.parseAssumption(bad).ok, false, bad);
    });

    await t.test("missing ready input, invalid or missing assumptions block the run", () => {
      assert.equal(E.buildExperimentRun(1, null, "1", neutral()).ok, false);
      const blank = E.buildExperimentRun(1, snapshot, "1", drafts({ ...E.NEUTRAL_DRAFT, lane: "" }, { ...E.NEUTRAL_DRAFT }));
      assert.equal(blank.ok, false);
      assert.deepEqual(blank.issues.map((i) => [i.field, i.teamId]), [["lane", teamA.team_id]]);
      assert.equal(E.buildExperimentRun(1, snapshot, "1", drafts({ ...E.NEUTRAL_DRAFT, tempo: "2" }, { ...E.NEUTRAL_DRAFT })).ok, false);
      assert.equal(E.buildExperimentRun(1, snapshot, "", neutral()).ok, false);
      assert.equal(E.buildExperimentRun(1, snapshot, "1", { [teamA.team_id]: { ...E.NEUTRAL_DRAFT } }).ok, false, "a team without assumptions is not filled in");
    });

    await t.test("same input and seed reproduce; core input contains only safe IDs and user assumptions", () => {
      const d = drafts({ lane: "0.5", tempo: "-0.2", teamfight: "1" }, { lane: "-1", tempo: "0", teamfight: "0.3" });
      const first = runOf(snapshot, "7", d);
      const second = runOf(structuredClone(snapshot), "7", structuredClone(d), 2);
      assert.deepEqual(second.result, first.result);
      assert.deepEqual(first.result, C.simulateManager(first.input));
      assert.deepEqual(first.input.teams.map((team) => team.id), ["team_a", "team_b"]);
      const text = JSON.stringify(first.input);
      for (const leak of [teamA.team_id, teamB.team_id, teamA.team_name, "champ", ...players.slice(0, 10).map((p) => p.player_id)]) assert.ok(!text.includes(leak), `core input leaked ${leak}`);
      const sorted = [teamA.team_id, teamB.team_id].sort((a, b) => a < b ? -1 : 1);
      assert.equal(first.teams.team_a.sourceId, sorted[0]);
      assert.equal(first.teams.team_b.sourceId, sorted[1]);
      assert.deepEqual(first.teams[first.teams.team_a.sourceId === teamA.team_id ? "team_a" : "team_b"].assumptions, { lane: 0.5, tempo: -0.2, teamfight: 1 });
    });

    await t.test("neutral default: no assumption is derived from names, champions or records", () => {
      const run = runOf(snapshot, "1", neutral());
      for (const team of run.input.teams) assert.deepEqual(team.assumptions, { lane: 0, tempo: 0, teamfight: 0 });
      const other = snapshotOf(teamA, report.opponent_prep.teams[2]);
      const otherRun = runOf(other, "1", { [teamA.team_id]: { ...E.NEUTRAL_DRAFT }, [report.opponent_prep.teams[2].team_id]: { ...E.NEUTRAL_DRAFT } });
      for (const team of otherRun.input.teams) assert.deepEqual(team.assumptions, { lane: 0, tempo: 0, teamfight: 0 });
    });

    await t.test("side exchange keeps the source ID ↔ core mapping and the result", () => {
      const d = drafts({ lane: "0.8", tempo: "0.1", teamfight: "-0.4" }, { lane: "0", tempo: "0.6", teamfight: "0.2" });
      const normal = runOf(snapshot, "99", d);
      const swapped = runOf(snapshotOf(teamB, teamA), "99", d);
      assert.deepEqual(swapped.input, normal.input);
      assert.deepEqual(swapped.result, normal.result);
      for (const core of E.CORE_TEAM_IDS) assert.equal(swapped.teams[core].sourceId, normal.teams[core].sourceId);
      assert.notEqual(swapped.teams.team_a.sideAtRun, normal.teams.team_a.sideAtRun);
    });

    await t.test("frames: 0 / middle / end / backwards; final equals model totals; winner hidden until end", () => {
      for (let seed = 0; seed < 60; seed++) {
        const run = runOf(snapshot, String(seed), drafts({ lane: "0.3", tempo: "0", teamfight: "0.5" }, { lane: "0", tempo: "-0.3", teamfight: "0" }));
        const zero = E.replayFrame(run, 0);
        assert.equal(zero.minute, 0);
        assert.equal(zero.complete, false);
        assert.equal(zero.outcome, null);
        for (const core of E.CORE_TEAM_IDS) assert.deepEqual(zero.states[core], { gold: 2500, kills: 0, objectives: 0, base: 100 });
        const end = E.replayFrame(run, run.endMinute);
        assert.equal(end.complete, true);
        assert.deepEqual(end.states, run.result.states);
        assert.deepEqual(end.outcome, { winner: run.result.winner, reason: run.result.reason, minute: run.result.minute });
        if (run.result.reason === "BASE_DESTROYED") {
          const loser = run.result.winner === "team_a" ? "team_b" : "team_a";
          assert.equal(end.states[loser].base, 0);
        }
        assert.ok(!end.log.some((event) => event.kind === "END"));
        assert.deepEqual(E.replayFrame(run, 999), end, "seeking past the end clamps to the end");
        const mid = Math.floor(run.endMinute / 2);
        const middle = E.replayFrame(run, mid);
        assert.equal(middle.outcome, null);
        assert.ok(middle.log.every((event) => event.minute <= mid));
        assert.equal(JSON.stringify(middle).includes("winner"), false);
        const before = E.replayFrame(run, run.endMinute - 1);
        assert.equal(before.complete, false);
        assert.equal(before.outcome, null);
        assert.deepEqual(E.replayFrame(run, mid), middle, "going back reproduces the same earlier frame");
        assert.deepEqual(E.replayFrame(run, 0), zero);
      }
    });

    await t.test("run, its input and its result are detached and frozen", () => {
      const snap = structuredClone(snapshot);
      const d = neutral();
      const run = runOf(snap, "5", d);
      const before = JSON.stringify(run);
      snap.draft.teams.BLUE.name = "changed";
      snap.roles[teamA.team_id].TOP = "other";
      d[teamA.team_id].lane = "1";
      assert.equal(JSON.stringify(run), before);
      assert.ok(Object.isFrozen(run.result.events) && Object.isFrozen(run.input.teams[0].assumptions) && Object.isFrozen(run.snapshot.draft));
      assert.throws(() => { run.result.winner = "x"; });
      E.replayFrame(run, run.endMinute);
      assert.equal(JSON.stringify(run), before, "replay frames never mutate the run");
    });

    await t.test("playback reducer is display only and drops stale ticks", () => {
      let s = E.playbackReducer(E.INITIAL_PLAYBACK, { type: "PLAY" });
      assert.equal(s.playing, false, "nothing plays without a run");
      s = E.playbackReducer(s, { type: "LOAD", runId: 1, endMinute: 3 });
      s = E.playbackReducer(s, { type: "PLAY" });
      s = E.playbackReducer(s, { type: "TICK", runId: 1 });
      assert.equal(s.cursor, 1);
      s = E.playbackReducer(s, { type: "SPEED", speed: 4 });
      assert.deepEqual([s.cursor, s.playing, s.speed], [1, true, 4]);
      assert.equal(E.playbackReducer(s, { type: "SPEED", speed: 3 }).speed, 4);
      s = E.playbackReducer(s, { type: "TICK", runId: 1 });
      s = E.playbackReducer(s, { type: "TICK", runId: 1 });
      assert.deepEqual([s.cursor, s.playing], [3, false], "auto-stops at the end");
      assert.equal(E.playbackReducer(s, { type: "TICK", runId: 1 }).cursor, 3);
      s = E.playbackReducer(s, { type: "SEEK", minute: 1 });
      assert.equal(s.cursor, 1);
      s = E.playbackReducer(s, { type: "PLAY" });
      s = E.playbackReducer(s, { type: "LOAD", runId: 2, endMinute: 5 });
      assert.deepEqual([s.runId, s.cursor, s.playing], [2, 0, false]);
      s = E.playbackReducer(s, { type: "PLAY" });
      assert.equal(E.playbackReducer(s, { type: "TICK", runId: 1 }), s, "tick of an earlier run is ignored");
      s = E.playbackReducer(s, { type: "PAUSE" });
      assert.equal(E.playbackReducer(s, { type: "TICK", runId: 2 }), s, "tick after pause is ignored");
      s = E.playbackReducer(E.playbackReducer(s, { type: "STEP" }), { type: "RESET" });
      assert.deepEqual([s.cursor, s.playing], [0, false]);
      assert.equal(E.playbackReducer(s, { type: "SEEK", minute: Number.NaN }), s);
    });

    await t.test("panel renders blocked without ready input and never runs on render", () => {
      const html = renderToStaticMarkup(createElement(ExperimentReplayPanel, { readyInput: null, blocked: false, nameOf: (id) => id }));
      assert.match(html, /추상 모델 실행/);
      assert.match(html, /실제 LoL 승률이나 실제 경기 재현이 아니며/);
      assert.match(html, /<button type="submit" disabled="">가정 실험 실행/);
      assert.doesNotMatch(html, /모델 내부 결과/);
      assert.match(html, /실행 원본과 재생 입력은 이 브라우저 화면에만 있고 저장·링크 공유되지 않아 페이지를 떠나면 사라집니다/);
      assert.match(html, /끝까지 재생한 실행은 요약 글만 복사할 수 있습니다/);
      assert.doesNotMatch(html, /실행은 이 화면 메모리에만 있으며 저장·공유되지 않습니다/);
      const ready = renderToStaticMarkup(createElement(ExperimentReplayPanel, { readyInput: snapshot, blocked: false, nameOf: (id) => id }));
      assert.match(ready, /<button type="submit">가정 실험 실행/);
      assert.equal((ready.match(/value="0"/g) ?? []).length, 6, "six neutral assumptions");
      assert.doesNotMatch(ready, /가정 실험 재생|모델 내부 결과/, "no run before the explicit click");
      const expectedHelp = { lane: "모델 자원이 분마다 늘어나는 양에 반영됩니다.", tempo: "모델 자원 증가와 모델 교전 점수 양쪽에 반영됩니다.", teamfight: "모델 교전 점수에 반영됩니다." };
      const assumptionInputs = [...ready.matchAll(/<input id="(experiment-(lane|tempo|teamfight)-[A-Za-z0-9_-]+)"[^>]*>/g)];
      assert.equal(assumptionInputs.length, 6, "six assumption inputs");
      const helpIds = new Set();
      for (const [tag, inputId, field] of assumptionInputs) {
        const describedBy = tag.match(/aria-describedby="([^"]+)"/)?.[1];
        assert.equal(describedBy, `${inputId}-help`, `${inputId} is described by its own help`);
        assert.doesNotMatch(tag, /aria-invalid/, "neutral values are valid");
        helpIds.add(describedBy);
        const help = ready.match(new RegExp(`<small id="${describedBy}"[^>]*>([^<]*)</small>`));
        assert.ok(help, `help element ${describedBy} is rendered`);
        assert.equal(help[1], expectedHelp[field]);
        assert.doesNotMatch(help[1], /승률|능력치|챔피언/, "help stays inside the abstract model");
      }
      assert.equal(helpIds.size, 6, "help IDs are unique per input");
      assert.match(ready, /<label for="experiment-lane-[^"]+">라인<\/label>/);
      assert.match(ready, /실제 LoL 승률이나 실제 경기 재현이 아니며, 챔피언·선수·시즌 기록은 모델 계산에 들어가지 않습니다/);
      assert.match(ready, /aria-describedby="experiment-seed-help"/);
      assert.match(ready, /<form[^>]*novalidate=""/i);
      const blocked = renderToStaticMarkup(createElement(ExperimentReplayPanel, { readyInput: snapshot, blocked: true, nameOf: (id) => id }));
      assert.match(blocked, /<button type="submit" disabled="">/);
      assert.match(blocked, /자료 로딩 중에는 새 실행을 할 수 없습니다/);
    });
  } finally {
    await vite.close();
  }
});
