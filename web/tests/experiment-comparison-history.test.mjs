import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("A/B same-minute model resource difference (B − A of the same team)", async (t) => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const CH = await vite.ssrLoadModule("/app/experiment-comparison-history.ts");
    const H = await vite.ssrLoadModule("/app/experiment-resource-history.ts");
    const X = await vite.ssrLoadModule("/app/experiment-comparison.ts");
    const E = await vite.ssrLoadModule("/app/experiment-replay.ts");
    const S = await vite.ssrLoadModule("/app/simulation-scenario.ts");
    const R = await vite.ssrLoadModule("/app/roster-scenario.ts");
    const { applyDraftSelection } = await vite.ssrLoadModule("/app/draft-agent.ts");
    const { ExperimentComparisonHistoryPanel } = await vite.ssrLoadModule("/app/experiment-comparison-history-panel.tsx");
    const { ExperimentResourceHistoryPanel } = await vite.ssrLoadModule("/app/experiment-resource-history-panel.tsx");

    const baseReport = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
    const ROLES = R.ROSTER_ROLES;
    const draftOf = (prefix) => Array.from({ length: 20 }, (_, i) => `${prefix}${i}`).reduce((all, id) => applyDraftSelection(all, id, [], "BLUE"), []);
    const selections = draftOf("champ");
    const snapshotOf = (report, blue, red, { playerOffset = 0, roleShift = 0 } = {}) => {
      const players = [...R.buildRosterIndex(report.opponent_prep.teams).players.values()];
      const ids = [blue.team_id, red.team_id];
      const rosters = Object.fromEntries(ids.map((id, n) => [id, Object.fromEntries(ROLES.map((role, r) => {
        const p = players[n * 5 + r + (n === 0 && r === 4 ? playerOffset : 0)]; return [role, { source_team_id: p.source_team_id, player_id: p.player_id }];
      }))]));
      const roleOf = (side) => { const p = S.teamPicks(selections, side); return Object.fromEntries(ROLES.map((role, i) => [role, p[(i + (side === "BLUE" ? roleShift : 0)) % 5]])); };
      const result = S.buildSimulationReadiness({ report, blueTeam: blue, redTeam: red, selections, games: [], firstPickSide: "BLUE",
        roster: { basis: R.rosterBasis(report), teamIds: ids.slice().sort(), rosters }, roles: { [blue.team_id]: roleOf("BLUE"), [red.team_id]: roleOf("RED") } });
      assert.equal(result.ok, true, JSON.stringify(result.issues));
      return structuredClone(result.snapshot);
    };
    const [teamA, teamB] = baseReport.opponent_prep.teams;
    const snapshot = snapshotOf(baseReport, teamA, teamB);
    const [first, second] = [teamA.team_id, teamB.team_id].sort((x, y) => x < y ? -1 : 1);
    const neutral = () => ({ [teamA.team_id]: { ...E.NEUTRAL_DRAFT }, [teamB.team_id]: { ...E.NEUTRAL_DRAFT } });
    let counter = 0;
    const runOf = (snap, seed, drafts) => { const r = E.buildExperimentRun(++counter, snap, seed, drafts); assert.equal(r.ok, true, JSON.stringify(r.issues)); return r.run; };
    const frozen = (run) => { const kept = X.freezeBaseline(run, run.endMinute); assert.equal(kept.ok, true); return kept.baseline; };
    const coreOf = (run, id) => E.CORE_TEAM_IDS.find((core) => run.teams[core].sourceId === id);
    const codes = (h) => h.status === "REFUSED" ? h.refusals.map((r) => r.code) : [];

    /** Every point checked directly against the original A/B replay frames, matched by source team ID. */
    const verify = (h, a, b) => {
      assert.equal(h.status, "READY");
      const common = Math.min(a.endMinute, b.endMinute);
      assert.equal(h.commonEndMinute, common);
      assert.deepEqual(h.endMinutes, { a: a.endMinute, b: b.endMinute });
      assert.deepEqual(h.points.map((p) => p.minute), Array.from({ length: common + 1 }, (_, i) => i), "0..common only");
      const all = [];
      for (const p of h.points) {
        const fa = E.replayFrame(a, p.minute), fb = E.replayFrame(b, p.minute);
        [first, second].forEach((id, k) => {
          const ga = fa.states[coreOf(a, id)].gold, gb = fb.states[coreOf(b, id)].gold;
          assert.equal(p.a[k], ga, `A ${id} @${p.minute}`);
          assert.equal(p.b[k], gb, `B ${id} @${p.minute}`);
          assert.equal(p.delta[k], gb - ga, `delta ${id} @${p.minute}`);
          all.push(p.delta[k]);
        });
      }
      assert.equal(h.minDelta, Math.min(...all));
      assert.equal(h.maxDelta, Math.max(...all));
      return all;
    };
    const finiteGeo = (geo) => {
      const nums = [...Object.values(geo.lines).join(" ").matchAll(/-?\d+(\.\d+)?/g)].map((m) => Number(m[0]));
      for (const c of Object.values(geo.current)) nums.push(c.x, c.y);
      for (const tick of [...geo.xTicks, ...geo.yTicks]) nums.push(tick.x ?? tick.y);
      nums.push(geo.zeroY);
      for (const n of nums) assert.ok(Number.isFinite(n) && n >= 0 && n <= Math.max(geo.width, geo.height), `coord ${n}`);
      assert.ok(geo.zeroY >= geo.plot.top && geo.zeroY <= geo.plot.bottom, "zero line inside plot");
      assert.ok(geo.yTicks.some((tick) => tick.value === 0), "0 tick present");
    };
    const geoOf = (h) => H.resourceChartGeometry(CH.comparisonDeltaSeries(h), 320, 160, { includeZero: true });

    await t.test("SINGLE: per-minute B − A equals the original replay frames; finite chart", () => {
      const source = runOf(snapshot, "11", neutral());
      const a = frozen(source);
      const drafts = neutral(); drafts[second].teamfight = "0.75";
      const b = runOf(snapshot, "11", drafts);
      const h = CH.experimentComparisonHistory(a, b, b.endMinute);
      verify(h, source, b);
      assert.equal(h.changeKind, "SINGLE");
      finiteGeo(geoOf(h));
      assert.deepEqual(h.teams.map((team) => team.name), [b.teams[coreOf(b, first)].name, b.teams[coreOf(b, second)].name], "source order");
    });

    await t.test("NONE: every minute's difference is 0; flat chart stays valid", () => {
      const a = frozen(runOf(snapshot, "3", neutral())), b = runOf(structuredClone(snapshot), "3", neutral());
      const h = CH.experimentComparisonHistory(a, b, b.endMinute);
      const all = verify(h, a, b);
      assert.equal(h.changeKind, "NONE");
      assert.ok(all.every((d) => Object.is(d, 0)), "all exactly +0");
      const geo = geoOf(h);
      finiteGeo(geo);
      assert.equal(geo.lines.team_a, geo.lines.team_b);
      assert.equal(geo.yTicks.length, 1);
    });

    await t.test("MULTIPLE: computed the same way, no single-factor attribution", () => {
      const a = frozen(runOf(snapshot, "11", neutral()));
      const drafts = neutral(); drafts[first].lane = "-0.5"; drafts[second].tempo = "1"; drafts[second].lane = "0.2";
      const b = runOf(snapshot, "11", drafts);
      const h = CH.experimentComparisonHistory(a, b, b.endMinute);
      verify(h, a, b);
      assert.equal(h.changeKind, "MULTIPLE");
      const html = renderToStaticMarkup(createElement(ExperimentComparisonHistoryPanel, { baseline: a, run: b, shownMinute: b.endMinute }));
      assert.ok(html.includes("한 가정 탓으로 나눌 수 없습니다"));
    });

    // Search real runs for differing ends and for signed differences (no hand-made run).
    const values = ["-1", "-0.5", "0.5", "1"];
    const candidates = [];
    for (const seed of ["5", "21", "77", "404"]) {
      const source = runOf(snapshot, seed, neutral());
      for (const id of [first, second]) for (const field of E.ASSUMPTION_FIELDS) for (const v of values) {
        const drafts = neutral(); drafts[id][field] = v;
        candidates.push([source, runOf(snapshot, seed, drafts)]);
      }
    }

    await t.test("different end minutes: only 0..min(end) compared, nothing held or extrapolated", () => {
      const pairs = candidates.filter(([a, b]) => a.endMinute !== b.endMinute);
      assert.ok(pairs.length > 0, "fixture has runs with different end minutes");
      for (const [source, b] of pairs.slice(0, 6)) {
        const a = frozen(source);
        const h = CH.experimentComparisonHistory(a, b, b.endMinute);
        verify(h, source, b);
        assert.equal(h.points.length, Math.min(a.endMinute, b.endMinute) + 1);
        assert.ok(h.points.every((p) => p.minute <= h.commonEndMinute));
        const html = renderToStaticMarkup(createElement(ExperimentComparisonHistoryPanel, { baseline: a, run: b, shownMinute: b.endMinute }));
        assert.ok(html.includes("끝난 시각이 다릅니다"));
        assert.equal((html.match(/<tr>/g) ?? []).length, h.commonEndMinute + 2, "header + one row per common minute");
        for (const m of html.matchAll(/>(\d+)분</g)) assert.ok(Number(m[1]) <= h.commonEndMinute, `tick/row ${m[1]} past common end`);
      }
    });

    await t.test("negative / positive / mixed differences give finite coordinates", () => {
      let neg = false, pos = false;
      for (const [source, b] of candidates) {
        const h = CH.experimentComparisonHistory(frozen(source), b, b.endMinute);
        verify(h, source, b);
        finiteGeo(geoOf(h));
        neg ||= h.minDelta < 0; pos ||= h.maxDelta > 0;
      }
      assert.ok(neg && pos, "fixture covers both signs");
      const synth = (vals) => ({ shownMinute: vals.length - 1, points: vals.map((v, i) => ({ minute: i, gold: { team_a: v, team_b: v / 2 } })),
        minGold: Math.min(...vals.flatMap((v) => [v, v / 2])), maxGold: Math.max(...vals.flatMap((v) => [v, v / 2])) });
      for (const vals of [[-100, -400, -900], [100, 300, 50], [0], [-0.5, 0, 0.5], [-200]]) {
        finiteGeo(H.resourceChartGeometry(synth(vals), 320, 160, { includeZero: true }));
      }
      const plain = H.resourceChartGeometry(synth([100, 300]));
      assert.equal("zeroY" in plain, false, "default geometry unchanged");
    });

    await t.test("pending, untrusted, same run and mismatched inputs show no series", () => {
      const source = runOf(snapshot, "21", neutral());
      const a = frozen(source);
      const drafts = neutral(); drafts[first].lane = "1";
      const b = runOf(snapshot, "21", drafts);
      for (const minute of [0, 1, Math.floor(b.endMinute / 2), b.endMinute - 1, Number.NaN, Infinity * 0]) {
        const h = CH.experimentComparisonHistory(a, b, minute);
        assert.deepEqual(h, { status: "PENDING" }, `minute ${minute}`);
        const html = renderToStaticMarkup(createElement(ExperimentComparisonHistoryPanel, { baseline: a, run: b, shownMinute: minute }));
        assert.equal(html, "", "nothing (no axis or future point) before B's end");
      }
      assert.deepEqual(codes(CH.experimentComparisonHistory(a, structuredClone(b), b.endMinute)), ["UNTRUSTED"]);
      assert.deepEqual(codes(CH.experimentComparisonHistory(JSON.parse(JSON.stringify(a)), b, b.endMinute)), ["UNTRUSTED"]);
      assert.deepEqual(codes(CH.experimentComparisonHistory(b, b, b.endMinute)), ["SAME_RUN"]);
      assert.deepEqual(codes(CH.experimentComparisonHistory(frozen(b), b, b.endMinute)), ["SAME_RUN"], "a frozen copy of B is the same run");
      assert.deepEqual(codes(CH.experimentComparisonHistory(source, source, 0)), ["SAME_RUN"]);
      const seedB = runOf(snapshot, "22", drafts);
      assert.deepEqual(codes(CH.experimentComparisonHistory(a, seedB, seedB.endMinute)), ["SEED"]);
      const evidence = structuredClone(snapshot); evidence.evidenceIdentity += "-changed";
      const evB = runOf(evidence, "21", neutral());
      assert.deepEqual(codes(CH.experimentComparisonHistory(a, evB, evB.endMinute)), ["EVIDENCE"]);
      const roleB = runOf(snapshotOf(baseReport, teamA, teamB, { roleShift: 1 }), "21", neutral());
      assert.deepEqual(codes(CH.experimentComparisonHistory(a, roleB, roleB.endMinute)), ["ROLES"]);
      const rosterB = runOf(snapshotOf(baseReport, teamA, teamB, { playerOffset: 10 }), "21", neutral());
      assert.deepEqual(codes(CH.experimentComparisonHistory(a, rosterB, rosterB.endMinute)), ["ROSTER"]);
      for (const bad of [null, undefined, {}, 1]) assert.deepEqual(codes(CH.experimentComparisonHistory(a, bad, 999)), ["UNTRUSTED"]);
      // Same refusal set as the existing gate: nothing relaxed.
      for (const other of [seedB, evB, roleB, rosterB]) {
        assert.deepEqual(codes(CH.experimentComparisonHistory(a, other, 999)), X.compareExperimentRuns(a, other, 999).refusals.map((r) => r.code));
        const html = renderToStaticMarkup(createElement(ExperimentComparisonHistoryPanel, { baseline: a, run: other, shownMinute: other.endMinute }));
        assert.doesNotMatch(html, /<svg|<table|<polyline|B−A [+-]?\d/, "refused: no chart or values");
        assert.ok(html.includes("표시하지 않습니다"));
      }
      for (const h of [CH.experimentComparisonHistory(a, seedB, 999), CH.experimentComparisonHistory(b, b, 999)]) {
        assert.equal("points" in h, false); assert.equal("commonEndMinute" in h, false);
      }
    });

    await t.test("same display name: teams paired by source ID and labelled without raw IDs", () => {
      const report = structuredClone(baseReport);
      const [x, y] = report.opponent_prep.teams;
      y.team_name = x.team_name;
      const snap = snapshotOf(report, x, y);
      const ndr = () => ({ [x.team_id]: { ...E.NEUTRAL_DRAFT }, [y.team_id]: { ...E.NEUTRAL_DRAFT } });
      const source = runOf(snap, "4", ndr());
      const d = ndr(); d[y.team_id].lane = "0.4";
      const b = runOf(snap, "4", d);
      const h = CH.experimentComparisonHistory(frozen(source), b, b.endMinute);
      const [p, q] = [x.team_id, y.team_id].sort((m, n) => m < n ? -1 : 1);
      assert.equal(h.status, "READY");
      for (const point of h.points) {
        const fa = E.replayFrame(source, point.minute), fb = E.replayFrame(b, point.minute);
        [p, q].forEach((id, k) => assert.equal(point.delta[k], fb.states[coreOf(b, id)].gold - fa.states[coreOf(source, id)].gold));
      }
      assert.equal(h.teams[0].name, h.teams[1].name);
      assert.notEqual(h.teams[0].label, h.teams[1].label, "same name kept apart");
      const text = JSON.stringify(h);
      for (const id of [x.team_id, y.team_id]) assert.equal(text.includes(id), false, "no raw ID in output");
      const html = renderToStaticMarkup(createElement(ExperimentComparisonHistoryPanel, { baseline: frozen(source), run: b, shownMinute: b.endMinute }));
      for (const id of [x.team_id, y.team_id]) assert.equal(html.includes(id), false, "no raw ID in UI");
    });

    await t.test("input/output isolation: A and B unchanged, returned data detached", () => {
      const source = runOf(snapshot, "9", neutral());
      const a = frozen(source);
      const drafts = neutral(); drafts[second].tempo = "-0.5";
      const b = runOf(snapshot, "9", drafts);
      const before = [JSON.stringify(a), JSON.stringify(b), JSON.stringify(source)];
      const h = CH.experimentComparisonHistory(a, b, b.endMinute);
      const fresh = JSON.stringify(h);
      h.points[0].delta[0] = 1e9; h.points[0].a[1] = -1; h.points.push({}); h.teams[0].label = "x"; h.endMinutes.a = -1;
      const series = CH.comparisonDeltaSeries(CH.experimentComparisonHistory(a, b, b.endMinute));
      series.points[0].gold.team_a = 123;
      assert.equal(JSON.stringify(CH.experimentComparisonHistory(a, b, b.endMinute)), fresh);
      assert.deepEqual([JSON.stringify(a), JSON.stringify(b), JSON.stringify(source)], before);
      assert.equal(E.isTrustedRun(a) && E.isTrustedRun(b), true);
      for (const key of ["winner", "reason", "probability", "player", "sourceId", "runId", "seed"]) assert.equal(fresh.includes(`"${key}"`), false, key);
    });

    await t.test("SSR: collapsed, accessible, signed, distinct from the single-run chart", () => {
      const a = frozen(runOf(snapshot, "11", neutral()));
      const drafts = neutral(); drafts[second].teamfight = "0.75";
      const b = runOf(snapshot, "11", drafts);
      const h = CH.experimentComparisonHistory(a, b, b.endMinute);
      const html = renderToStaticMarkup(createElement(ExperimentComparisonHistoryPanel, { baseline: a, run: b, shownMinute: b.endMinute }));
      assert.match(html, new RegExp(`^<details class="experiment-comparison-history" data-common-end-minute="${h.commonEndMinute}">`));
      assert.equal(html.includes(" open"), false, "all details closed");
      assert.equal(html.includes('class="experiment-resource-history"'), false, "own root, not the single-run root");
      for (const text of ["같은 시각의 모델 자원 차이", "같은 팀의 B−A이며 두 팀 사이 격차가 아닙니다.", "두 실행이 모두 진행된 구간만 비교합니다.",
        "실제 골드·승률·선수 기여도가 아닙니다.", "분별 값 보기", "실선", "점선", '<line class="zero"']) assert.ok(html.includes(text), text);
      const svg = html.match(/<svg class="experiment-resource-history-chart"[^>]*>/)[0];
      assert.match(svg, /role="img"/);
      const [titleId, descId] = svg.match(/aria-labelledby="([^"]+)"/)[1].split(" ");
      assert.ok(titleId && descId && titleId !== descId);
      assert.ok(html.includes(`<title id="${titleId}">`) && html.includes(`<desc id="${descId}">`));
      assert.equal(/NaN|Infinity/.test(html), false);
      for (const text of ["승리", "승률 추정", "winner", "확률"]) assert.equal(html.includes(text), false, text);
      const last = h.points.at(-1);
      const signed = (v) => v > 0 ? `+${v.toLocaleString("ko-KR")}` : v.toLocaleString("ko-KR");
      for (const d of last.delta) assert.ok(html.includes(`>${signed(d)}<`), `delta ${d} in table`);
      const single = renderToStaticMarkup(createElement(ExperimentResourceHistoryPanel, { run: b, shownMinute: b.endMinute }));
      assert.equal(single.includes('class="zero"'), false, "single-run chart has no zero line");
      assert.match(single, /^<details class="experiment-resource-history" data-shown-minute="\d+">/);
    });
  } finally {
    await vite.close();
  }
});
