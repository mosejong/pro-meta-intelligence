import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("completed single A/B comparison: plain text and share panel", async (t) => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const X = await vite.ssrLoadModule("/app/experiment-comparison.ts");
    const T = await vite.ssrLoadModule("/app/experiment-comparison-text.ts");
    const E = await vite.ssrLoadModule("/app/experiment-replay.ts");
    const S = await vite.ssrLoadModule("/app/simulation-scenario.ts");
    const R = await vite.ssrLoadModule("/app/roster-scenario.ts");
    const { applyDraftSelection } = await vite.ssrLoadModule("/app/draft-agent.ts");
    const { ExperimentComparisonPanel } = await vite.ssrLoadModule("/app/experiment-comparison-panel.tsx");
    const { ExperimentComparisonSharePanel } = await vite.ssrLoadModule("/app/experiment-comparison-share-panel.tsx");
    const baseReport = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
    const ROLES = R.ROSTER_ROLES;
    const selections = Array.from({ length: 20 }, (_, i) => `champ${i}`).reduce((all, id) => applyDraftSelection(all, id, [], "BLUE"), []);
    const players = [...R.buildRosterIndex(baseReport.opponent_prep.teams).players.values()];
    const snapshotOf = (report, blue, red) => {
      const ids = [blue.team_id, red.team_id];
      const rosters = Object.fromEntries(ids.map((id, n) => [id, Object.fromEntries(ROLES.map((role, r) => {
        const p = players[n * 5 + r]; return [role, { source_team_id: p.source_team_id, player_id: p.player_id }];
      }))]));
      const roleOf = (side) => { const p = S.teamPicks(selections, side); return Object.fromEntries(ROLES.map((role, i) => [role, p[i]])); };
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
    const keep = (run) => { const k = X.freezeBaseline(run, run.endMinute); assert.equal(k.ok, true); return k.baseline; };
    const fmt = (n) => n.toLocaleString("en-US");
    const signed = (n) => n > 0 ? `+${fmt(n)}` : fmt(n);
    const UNSAFE = /[\p{Cc}؜‎‏‪-‮⁦-⁩]/u;

    /** Every value in the text is checked against the existing comparison, not against hard-coded numbers. */
    const assertMatchesComparison = (text, c, labels) => {
      for (const team of c.outcome.teams) {
        const line = text.split("\n").find((l) => l.startsWith(`- ${labels[team.sourceId]}: 모델 자원`));
        assert.ok(line, `outcome line for ${labels[team.sourceId]}`);
        for (const stat of X.OUTCOME_STATS) {
          const unit = stat === "base" ? "/100" : "";
          assert.ok(line.includes(`${fmt(team.a[stat])}${unit} → ${fmt(team.b[stat])}${unit} (${signed(team.delta[stat])})`), `${stat}: ${line}`);
        }
      }
      for (const team of c.teams) {
        const line = text.split("\n").find((l) => l.startsWith(`- ${labels[team.sourceId]}: 라인`));
        assert.ok(line, `assumption line for ${labels[team.sourceId]}`);
        for (const field of E.ASSUMPTION_FIELDS) {
          const cell = team.fields[field];
          assert.ok(line.includes(cell.changed ? `${cell.a} → ${cell.b}` : `${cell.a} (같음)`), `${field}: ${line}`);
        }
      }
      const { a, b, minuteDelta } = c.outcome.end;
      assert.ok(text.includes(`A ${a.minute}분`) && text.includes(`B ${b.minute}분`) && text.includes(`(B − A ${signed(minuteDelta)}분)`));
    };
    const assertSafe = (text, ...runs) => {
      assert.ok(text.length <= T.MAX_COMPARISON_TEXT_CHARS);
      for (const line of text.split("\n")) assert.doesNotMatch(line, UNSAFE, "no bidi/control characters besides line breaks");
      assert.match(text, /보관된 두 실행의 비교/);
      assert.ok(text.includes(T.COMPARISON_TEXT_BOUNDARY));
      assert.match(text, /실제 LoL 승패·승률 예측이 아닙니다/);
      assert.match(text, /고정 시드 \d+ · 규칙 /);
      assert.doesNotMatch(text, /team_a|team_b|\{|\}|"/);
      for (const run of runs) {
        for (const core of E.CORE_TEAM_IDS) assert.ok(!text.includes(run.teams[core].sourceId), "no source team ID");
        assert.ok(!text.includes(run.snapshot.evidenceIdentity), "no evidence key");
        for (const id of run.snapshot.draft.roster.team_ids) for (const role of ROLES) {
          const slot = run.snapshot.draft.roster.teams[id][role];
          if (slot) assert.ok(!text.includes(slot.player_id), "no player ID");
        }
      }
    };
    const clean = (name) => name.replace(/\s+/g, " ").trim();
    const names = (run) => Object.fromEntries(E.CORE_TEAM_IDS.map((core) => [run.teams[core].sourceId, clean(run.teams[core].name)]));

    await t.test("single change: every number matches the existing comparison", () => {
      const a = keep(runOf(snapshot, "11", neutral()));
      const drafts = neutral(); drafts[second].teamfight = "0.75";
      const b = runOf(snapshot, "11", drafts);
      const c = X.compareExperimentRuns(a, b, b.endMinute);
      assert.equal(c.changeKind, "SINGLE");
      const out = T.buildExperimentComparisonText(a, b, b.endMinute);
      assert.equal(out.ok, true, JSON.stringify(out));
      assertMatchesComparison(out.text, c, names(b));
      assertSafe(out.text, a, b);
      assert.match(out.text, /가정 1개 변경 .*이 가정만 바꾼 모델 내부 차이/);
      assert.ok(out.text.includes(`기준 A 실행 #${a.runId} ↔ 실행 B #${b.runId}`));
    });

    await t.test("no change: differences are the comparison's zeros, stated as 0", () => {
      const a = keep(runOf(snapshot, "3", neutral())), b = runOf(structuredClone(snapshot), "3", neutral());
      const c = X.compareExperimentRuns(a, b, b.endMinute);
      assert.equal(c.changeKind, "NONE");
      const out = T.buildExperimentComparisonText(a, b, b.endMinute);
      assert.equal(out.ok, true);
      assertMatchesComparison(out.text, c, names(b));
      assert.match(out.text, /가정 변경 없음 · 같은 가정·고정 시드이므로 모델 결과 차이는 0입니다/);
      assert.doesNotMatch(out.text, /\(\+/);
    });

    await t.test("multiple changes: not split into one assumption's contribution", () => {
      const a = keep(runOf(snapshot, "11", neutral()));
      const drafts = neutral(); drafts[first].lane = "-0.5"; drafts[second].tempo = "1"; drafts[second].lane = "0.2";
      const b = runOf(snapshot, "11", drafts);
      const c = X.compareExperimentRuns(a, b, b.endMinute);
      assert.equal(c.changeKind, "MULTIPLE");
      const out = T.buildExperimentComparisonText(a, b, b.endMinute);
      assert.equal(out.ok, true);
      assertMatchesComparison(out.text, c, names(b));
      assert.ok(out.text.includes(`가정 ${c.changes.length}개 변경`));
      assert.match(out.text, /한 가정의 기여로 나눌 수 없습니다/);
      assert.doesNotMatch(out.text, /이 가정만 바꾼/);
    });

    await t.test("same display name: 팀1/팀2 labels by source order, no raw IDs", () => {
      const report = structuredClone(baseReport);
      const [x, y] = report.opponent_prep.teams;
      y.team_name = x.team_name;
      const snap = snapshotOf(report, x, y);
      const d = (lane) => ({ [x.team_id]: { ...E.NEUTRAL_DRAFT }, [y.team_id]: { ...E.NEUTRAL_DRAFT, lane } });
      const a = keep(runOf(snap, "4", d("0"))), b = runOf(snap, "4", d("0.4"));
      const c = X.compareExperimentRuns(a, b, b.endMinute);
      const out = T.buildExperimentComparisonText(a, b, b.endMinute);
      assert.equal(out.ok, true, JSON.stringify(out));
      const shared = clean(snap.draft.teams.BLUE.name);
      assert.equal(shared, clean(snap.draft.teams.RED.name));
      const labels = Object.fromEntries(c.teams.map((team, i) => [team.sourceId, `${shared} (팀${i + 1})`]));
      assertMatchesComparison(out.text, c, labels);
      assertSafe(out.text, a, b);
    });

    await t.test("a renamed team is matched by source ID and its A-time name is noted", () => {
      const a = keep(runOf(snapshot, "7", neutral()));
      const renamed = structuredClone(snapshot); renamed.draft.teams.RED.name = "새 이름 팀";
      const b = runOf(renamed, "7", neutral());
      const c = X.compareExperimentRuns(a, b, b.endMinute);
      assert.equal(c.ok, true, JSON.stringify(c));
      const out = T.buildExperimentComparisonText(a, b, b.endMinute);
      assert.equal(out.ok, true);
      assertMatchesComparison(out.text, c, names(b));
      assert.ok(out.text.includes(`- 새 이름 팀: 기준 A 실행 당시 이름 ${clean(snapshot.draft.teams.RED.name)} (같은 팀으로 대응)`));
    });

    await t.test("unsafe names are flattened to one safe line; long names stay within the total limit", () => {
      const hostile = structuredClone(snapshot);
      hostile.draft.teams.BLUE.name = `블루\n${String.fromCharCode(0x202e)}팀${String.fromCharCode(0x2066)}X${String.fromCharCode(7)}`;
      hostile.draft.teams.RED.name = "가".repeat(200);
      const d = neutral(); d[second].tempo = "0.3";
      const a = keep(runOf(hostile, "12", neutral())), b = runOf(hostile, "12", d);
      const out = T.buildExperimentComparisonText(a, b, b.endMinute);
      assert.equal(out.ok, true, JSON.stringify(out));
      assertSafe(out.text, a, b);
      assert.ok(out.text.includes("블루 팀 X"));
      assert.ok(out.text.includes(`${"가".repeat(39)}…`) && !out.text.includes("가".repeat(41)));
    });

    await t.test("refusals: untrusted, same run, before end, NaN, different seed/input", () => {
      const raw = runOf(snapshot, "5", neutral());
      const a = keep(raw);
      const b = runOf(snapshot, "5", neutral());
      const reason = (x, y, m) => T.buildExperimentComparisonText(x, y, m);
      for (const bad of [null, undefined, 1, "run", {}, [], structuredClone(b), JSON.parse(JSON.stringify(b)), { ...b }, Object.create(b)]) {
        assert.deepEqual(reason(a, bad, 999), { ok: false, reason: "UNTRUSTED" });
        assert.deepEqual(reason(bad, b, 999), { ok: false, reason: "UNTRUSTED" });
      }
      assert.deepEqual(reason(a, a, 999), { ok: false, reason: "SAME_RUN" });
      assert.deepEqual(reason(a, raw, 999), { ok: false, reason: "SAME_RUN" }, "kept clone vs its own source");
      for (const minute of [0, b.endMinute - 1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "999", undefined]) {
        assert.deepEqual(reason(a, b, minute), { ok: false, reason: "NOT_COMPLETE" }, `minute ${String(minute)}`);
      }
      const seed = reason(a, runOf(snapshot, "6", neutral()), 999);
      assert.equal(seed.reason, "NOT_COMPARABLE");
      assert.deepEqual(seed.codes, ["SEED"]);
      const patched = structuredClone(snapshot); patched.patch = "99.99";
      assert.deepEqual(reason(a, runOf(patched, "5", neutral()), 999).codes, ["EVIDENCE"]);
      const [, , teamC] = baseReport.opponent_prep.teams;
      const other = runOf(snapshotOf(baseReport, teamA, teamC), "5", { [teamA.team_id]: { ...E.NEUTRAL_DRAFT }, [teamC.team_id]: { ...E.NEUTRAL_DRAFT } });
      assert.deepEqual(reason(a, other, 999).codes, ["TEAMS"]);
      for (const out of [seed, reason(a, b, 0)]) assert.equal("text" in out, false);
    });

    await t.test("builder never alters A, B or the comparison", () => {
      const a = keep(runOf(snapshot, "9", neutral()));
      const d = neutral(); d[first].teamfight = "-1";
      const b = runOf(snapshot, "9", d);
      const before = [JSON.stringify(a), JSON.stringify(b), JSON.stringify(X.compareExperimentRuns(a, b, b.endMinute))];
      const t1 = T.buildExperimentComparisonText(a, b, b.endMinute);
      const t2 = T.buildExperimentComparisonText(a, b, b.endMinute + 5);
      assert.equal(t1.ok, true);
      assert.equal(t1.text, t2.text, "same text at and after the end");
      assert.deepEqual([JSON.stringify(a), JSON.stringify(b), JSON.stringify(X.compareExperimentRuns(a, b, b.endMinute))], before);
      assert.equal(E.isTrustedRun(a) && E.isTrustedRun(b), true);
    });

    await t.test("SSR: button only with a baseline, enabled only for a finished different B, regardless of current input", () => {
      const raw = runOf(snapshot, "1", neutral());
      const a = keep(raw);
      const d = neutral(); d[second].lane = "0.5";
      const b = runOf(snapshot, "1", d);
      const none = renderToStaticMarkup(createElement(ExperimentComparisonPanel, { run: b, shownMinute: b.endMinute, readyInput: snapshot }));
      assert.doesNotMatch(none, /A\/B 비교 요약 복사/, "no baseline, no button");

      const render = (props) => renderToStaticMarkup(createElement(ExperimentComparisonSharePanel, props));
      const done = render({ baseline: a, run: b, shownMinute: b.endMinute });
      assert.match(done, /<div class="experiment-comparison-share"><button type="button">A\/B 비교 요약 복사<\/button>/);
      assert.doesNotMatch(done, /<textarea|aria-describedby/);
      const middle = render({ baseline: a, run: b, shownMinute: 1 });
      assert.match(middle, /<button type="button" disabled="" aria-describedby="[^"]+">A\/B 비교 요약 복사/);
      assert.match(middle, /실행 B를 끝까지 재생하면/);
      const same = render({ baseline: a, run: raw, shownMinute: raw.endMinute });
      assert.match(same, /disabled=""/);
      assert.match(same, /기준 A와 다른 실행 B가 있어야/);
      const refused = render({ baseline: a, run: runOf(snapshot, "2", d), shownMinute: 999 });
      assert.match(refused, /disabled=""/);
      assert.match(refused, /같은 조건의 두 실행이 아니어서/);
      for (const html of [done, middle, same, refused]) assert.ok(!html.includes(teamA.team_id) && !html.includes(teamB.team_id));
      // The panel within the details: current input changed after B, the kept A/B copy stays available.
      const changedInput = structuredClone(snapshot); changedInput.patch = "99.99";
      const panel = renderToStaticMarkup(createElement(ExperimentComparisonPanel, { run: b, shownMinute: b.endMinute, readyInput: changedInput }));
      assert.match(panel, /<details class="experiment-comparison">/);
    });
  } finally {
    await vite.close();
  }
});
