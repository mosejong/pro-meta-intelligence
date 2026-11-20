import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("experiment resource history: past-only model resource flow of a fixed run", async (t) => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const H = await vite.ssrLoadModule("/app/experiment-resource-history.ts");
    const { ExperimentResourceHistoryPanel } = await vite.ssrLoadModule("/app/experiment-resource-history-panel.tsx");
    const E = await vite.ssrLoadModule("/app/experiment-replay.ts");
    const S = await vite.ssrLoadModule("/app/simulation-scenario.ts");
    const R = await vite.ssrLoadModule("/app/roster-scenario.ts");
    const { applyDraftSelection } = await vite.ssrLoadModule("/app/draft-agent.ts");
    const { ExperimentReplayPanel } = await vite.ssrLoadModule("/app/experiment-replay-panel.tsx");

    const ev = (minute, kind, actor = "team_a", amount = 1) => ({ minute, kind, actor, amount });
    const TEAMS = { team_a: { name: "알파", sideAtRun: "BLUE" }, team_b: { name: "베타", sideAtRun: "RED" } };
    // Pure display fixture: no snapshot/input, so the helper cannot be re-running the model.
    const fixture = (events, endMinute, winner = "team_a", teams = TEAMS) =>
      ({ endMinute, teams: structuredClone(teams), result: { minute: endMinute, winner, reason: "TIME_LIMIT", events } });
    const growth = (to) => Array.from({ length: to }, (_, i) => [ev(i + 1, "GROWTH", "team_a", 100), ev(i + 1, "GROWTH", "team_b", 80)]).flat();
    const finite = (geo) => {
      const nums = [...Object.values(geo.lines).join(" ").matchAll(/-?\d+(\.\d+)?/g)].map((m) => Number(m[0]));
      for (const c of Object.values(geo.current)) nums.push(c.x, c.y);
      for (const tick of geo.xTicks) nums.push(tick.x);
      for (const tick of geo.yTicks) nums.push(tick.y);
      for (const n of nums) assert.ok(Number.isFinite(n) && n >= 0 && n <= Math.max(geo.width, geo.height), `coord ${n}`);
      return nums;
    };

    await t.test("values are replayFrame gold per minute 0..shown, nothing after", () => {
      const run = fixture([...growth(10), ev(3, "SKIRMISH", "team_b", 2), ev(5, "OBJECTIVE"), ev(7, "BASE", "team_b", 30), ev(10, "END")], 10);
      for (const shown of [0, 4, 10]) {
        const h = H.resourceHistory(run, shown);
        assert.equal(h.shownMinute, shown);
        assert.deepEqual(h.points.map((p) => p.minute), Array.from({ length: shown + 1 }, (_, i) => i));
        for (const p of h.points) {
          const f = E.replayFrame(run, p.minute);
          assert.deepEqual(p.gold, { team_a: f.states.team_a.gold, team_b: f.states.team_b.gold });
        }
        const all = h.points.flatMap((p) => [p.gold.team_a, p.gold.team_b]);
        assert.equal(h.minGold, Math.min(...all));
        assert.equal(h.maxGold, Math.max(...all));
        assert.deepEqual(Object.keys(h).sort(), ["maxGold", "minGold", "points", "shownMinute", "teams"], "no winner/end/complete keys");
      }
    });

    await t.test("future events, winner, end minute and future state changes never alter an earlier output", () => {
      const base = fixture([...growth(10), ev(3, "SKIRMISH"), ev(10, "END")], 10, "team_a");
      const probe = fixture([...growth(10), ev(3, "SKIRMISH"), ev(5, "OBJECTIVE", "team_b"), ev(6, "SKIRMISH", "team_b", 9),
        ev(8, "BASE", "team_a", 100), ...growth(30).filter((e) => e.minute > 10), ev(30, "END", "team_b")], 30, "team_b");
      for (const shown of [0, 3, 4]) {
        assert.deepEqual(H.resourceHistory(probe, shown), H.resourceHistory(base, shown), `minute ${shown}`);
        const html = (r) => renderToStaticMarkup(createElement(ExperimentResourceHistoryPanel, { run: r, shownMinute: shown }));
        assert.equal(html(probe), html(base), `SSR at ${shown}`);
      }
    });

    await t.test("shown minute normalised like replayFrame; invalid runs refused", () => {
      const run = fixture([...growth(8), ev(8, "END")], 8);
      const at = (m) => H.resourceHistory(run, m).shownMinute;
      assert.equal(at(2.9), 2, "floored");
      assert.equal(at(-5), 0);
      assert.equal(at(500), 8, "clamped to the run end like replayFrame");
      for (const bad of [Number.NaN, Infinity, -Infinity, "3", null, undefined]) assert.equal(at(bad), 0, String(bad));
      assert.ok(H.resourceHistory(run, 500).points.length <= E.MAX_MINUTE + 1);
      for (const end of [-1, 1.5, Number.NaN, Infinity, E.MAX_MINUTE + 1, "8", null]) {
        assert.equal(H.resourceHistory({ ...run, endMinute: end }, 2), null, String(end));
      }
      assert.equal(H.resourceHistory({ ...run, teams: undefined }, 2), null);
      assert.equal(H.resourceHistory({ ...run, teams: { team_a: TEAMS.team_a } }, 2), null);
      assert.equal(H.resourceHistory({ ...run, result: { ...run.result, events: null } }, 2), null);
      assert.equal(H.resourceHistory(fixture([ev(1, "GROWTH", "team_a", Number.NaN)], 2), 2), null, "non-finite value refused");
    });

    await t.test("input untouched; returned data detached", () => {
      const run = fixture([...growth(6), ev(2, "OBJECTIVE"), ev(6, "END")], 6);
      const before = structuredClone(run);
      const h = H.resourceHistory(run, 4);
      assert.deepEqual(run, before);
      const fresh = structuredClone(h);
      h.points[0].gold.team_a = -1; h.points.push({ minute: 99, gold: { team_a: 0, team_b: 0 } }); h.teams.team_a.name = "x";
      assert.deepEqual(run, before);
      assert.deepEqual(H.resourceHistory(run, 4), fresh);
    });

    await t.test("labels from fixed run teams; same display name kept distinct by run side", () => {
      const run = fixture([ev(1, "END")], 1, "team_a", { team_a: { name: "같은팀", sideAtRun: "RED" }, team_b: { name: "같은팀", sideAtRun: "BLUE" } });
      const h = H.resourceHistory(run, 0);
      assert.equal(h.teams.team_a.label, "같은팀 (실행 당시 레드)");
      assert.equal(h.teams.team_b.label, "같은팀 (실행 당시 블루)");
      assert.notEqual(h.teams.team_a.label, h.teams.team_b.label);
      assert.equal(H.resourceHistory(fixture([ev(1, "END")], 1), 0).teams.team_a.label, "알파", "distinct names unchanged");
    });

    await t.test("geometry: minute 0, equal values and normal range give finite coordinates", () => {
      const zero = H.resourceChartGeometry(H.resourceHistory(fixture([ev(5, "END")], 5), 0));
      finite(zero);
      assert.equal(zero.lines.team_a.split(" ").length, 1, "single point at minute 0");
      assert.deepEqual(zero.xTicks.map((x) => x.minute), [0]);
      assert.equal(zero.yTicks.length, 1, "flat range → one value tick");
      const tie = fixture([...Array.from({ length: 4 }, (_, i) => [ev(i + 1, "GROWTH", "team_a", 50), ev(i + 1, "GROWTH", "team_b", 50)]).flat(), ev(4, "END")], 4);
      const tg = H.resourceChartGeometry(H.resourceHistory(tie, 4));
      finite(tg);
      assert.equal(tg.lines.team_a, tg.lines.team_b);
      const flat = fixture([ev(4, "END")], 4);
      const fg = H.resourceChartGeometry(H.resourceHistory(flat, 4));
      finite(fg);
      assert.deepEqual(fg.xTicks.map((x) => x.minute), [0, 4], "x axis only to shown minute");
      const normal = H.resourceChartGeometry(H.resourceHistory(fixture([...growth(10), ev(10, "END")], 10), 6));
      finite(normal);
      assert.deepEqual(normal.xTicks.map((x) => x.minute), [0, 6]);
      assert.equal(normal.current.team_a.x, normal.plot.right);
    });

    // Real fixed runs, built the same way as the replay tests.
    const report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
    const [blue, red] = report.opponent_prep.teams;
    const ROLES = R.ROSTER_ROLES;
    const players = [...R.buildRosterIndex(report.opponent_prep.teams).players.values()];
    const selections = Array.from({ length: 20 }, (_, i) => i).reduce((all, i) => applyDraftSelection(all, `champ${i}`, [], "BLUE"), []);
    const ids = [blue.team_id, red.team_id];
    const rosters = Object.fromEntries(ids.map((id, n) => [id, Object.fromEntries(ROLES.map((role, r) => {
      const p = players[n * 5 + r]; return [role, { source_team_id: p.source_team_id, player_id: p.player_id }];
    }))]));
    const readyFor = (blueTeam, redTeam) => {
      const roles = {
        [blueTeam.team_id]: Object.fromEntries(ROLES.map((role, i) => [role, S.teamPicks(selections, "BLUE")[i]])),
        [redTeam.team_id]: Object.fromEntries(ROLES.map((role, i) => [role, S.teamPicks(selections, "RED")[i]])),
      };
      const ready = S.buildSimulationReadiness({ report, blueTeam, redTeam, selections, games: [], firstPickSide: "BLUE",
        roster: { basis: R.rosterBasis(report), teamIds: ids.slice().sort(), rosters }, roles });
      assert.equal(ready.ok, true, JSON.stringify(ready.issues));
      return ready.snapshot;
    };
    const drafts = { [blue.team_id]: { lane: "0.6", tempo: "0.2", teamfight: "0.4" }, [red.team_id]: { ...E.NEUTRAL_DRAFT } };
    const ready = readyFor(blue, red);
    const built = E.buildExperimentRun(1, structuredClone(ready), "7", drafts);
    assert.equal(built.ok, true, JSON.stringify(built.issues));
    const run = built.run;
    const mid = Math.floor(run.endMinute / 2);

    await t.test("real run: 0 / middle / end / rewind match replayFrame gold; run unchanged", () => {
      const fingerprint = JSON.stringify(run);
      const check = (shown) => {
        const h = H.resourceHistory(run, shown);
        assert.equal(h.points.length, shown + 1);
        for (const p of h.points) {
          const f = E.replayFrame(run, p.minute);
          for (const core of E.CORE_TEAM_IDS) assert.equal(p.gold[core], f.states[core].gold, `${core} @${p.minute}`);
        }
        return h;
      };
      const atMid = check(mid);
      check(0);
      const atEnd = check(run.endMinute);
      for (const core of E.CORE_TEAM_IDS) assert.equal(atEnd.points.at(-1).gold[core], run.result.states[core].gold, "end matches model total");
      assert.deepEqual(check(mid), atMid, "rewind to middle is identical");
      assert.deepEqual(atEnd.points.slice(0, mid + 1), atMid.points, "prefix stable");
      assert.equal(JSON.stringify(run), fingerprint);
    });

    await t.test("real run: core mapping and side reversal use the run's own teams", () => {
      const swapped = E.buildExperimentRun(2, structuredClone(readyFor(red, blue)), "7", drafts);
      assert.equal(swapped.ok, true, JSON.stringify(swapped.issues));
      const a = H.resourceHistory(run, mid), b = H.resourceHistory(swapped.run, mid);
      for (const core of E.CORE_TEAM_IDS) {
        assert.equal(a.teams[core].name, run.teams[core].name);
        assert.equal(b.teams[core].name, swapped.run.teams[core].name);
        assert.equal(swapped.run.teams[core].sourceId, run.teams[core].sourceId, "core follows source ID, not side");
        assert.equal(a.teams[core].name, b.teams[core].name);
        assert.notEqual(a.teams[core].sideAtRun, b.teams[core].sideAtRun, "side flipped");
        assert.equal(b.teams[core].sideAtRun, swapped.run.teams[core].sideAtRun);
      }
    });

    await t.test("SSR: collapsed, accessible, model-scoped, nothing after the shown minute", () => {
      const html = renderToStaticMarkup(createElement(ExperimentResourceHistoryPanel, { run, shownMinute: mid }));
      assert.match(html, /^<details class="experiment-resource-history" data-shown-minute="\d+">/, "outer details closed by default");
      assert.equal(html.includes(" open"), false, "no details opened");
      assert.ok(html.includes(`data-shown-minute="${mid}"`));
      for (const text of ["지금까지의 모델 자원 흐름", "실제 골드가 아닌 모델 자원", "현재 재생 시각", "다시 계산하지 않습니다", "분별 값 보기", "실선", "점선"]) {
        assert.ok(html.includes(text), text);
      }
      const svg = html.match(/<svg class="experiment-resource-history-chart"[^>]*>/)[0];
      assert.match(svg, /role="img"/);
      const [titleId, descId] = svg.match(/aria-labelledby="([^"]+)"/)[1].split(" ");
      assert.ok(titleId && descId && titleId !== descId);
      assert.ok(html.includes(`<title id="${titleId}">`) && html.includes(`<desc id="${descId}">`));
      assert.match(svg, /viewBox="0 0 \d+ \d+"/);
      assert.equal(/NaN|Infinity/.test(html), false);
      for (const m of html.matchAll(/(\d+)분/g)) assert.ok(Number(m[1]) <= mid, `minute ${m[1]} is not in the future`);
      assert.equal((html.match(/<tr>/g) ?? []).length, mid + 2, "header + one row per shown minute");
      const past = new Set(H.resourceHistory(run, mid).points.flatMap((p) => [p.gold.team_a, p.gold.team_b]));
      const future = new Set(H.resourceHistory(run, run.endMinute).points.slice(mid + 1).flatMap((p) => [p.gold.team_a, p.gold.team_b]).filter((g) => !past.has(g)));
      assert.ok(future.size > 0, "fixture has future values to leak");
      for (const g of future) assert.equal(html.includes(`>${g.toLocaleString("ko-KR")}<`), false, `future value ${g}`);
      for (const text of ["모델 내부 결과", "승리", "winner", "endMinute", "complete"]) assert.equal(html.includes(text), false, text);
      for (const core of E.CORE_TEAM_IDS) assert.ok(html.includes(run.teams[core].name));
    });

    await t.test("SSR: minute 0 is a valid single-point chart", () => {
      const html = renderToStaticMarkup(createElement(ExperimentResourceHistoryPanel, { run, shownMinute: 0 }));
      assert.equal(/NaN|Infinity/.test(html), false);
      assert.equal((html.match(/<tr>/g) ?? []).length, 2);
      for (const m of html.matchAll(/(\d+)분/g)) assert.equal(m[1], "0");
    });

    await t.test("replay panel shows no resource history before a run exists", () => {
      const html = renderToStaticMarkup(createElement(ExperimentReplayPanel, { readyInput: ready, blocked: false, nameOf: (id) => id }));
      assert.equal(html.includes("지금까지의 모델 자원 흐름"), false);
    });
  } finally {
    await vite.close();
  }
});
