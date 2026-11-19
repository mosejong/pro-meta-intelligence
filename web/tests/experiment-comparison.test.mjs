import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("assumption experiment A/B comparison", async (t) => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const X = await vite.ssrLoadModule("/app/experiment-comparison.ts");
    const E = await vite.ssrLoadModule("/app/experiment-replay.ts");
    const S = await vite.ssrLoadModule("/app/simulation-scenario.ts");
    const R = await vite.ssrLoadModule("/app/roster-scenario.ts");
    const { applyDraftSelection } = await vite.ssrLoadModule("/app/draft-agent.ts");
    const { ExperimentComparisonPanel } = await vite.ssrLoadModule("/app/experiment-comparison-panel.tsx");
    const baseReport = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
    const ROLES = R.ROSTER_ROLES;
    const draftOf = (prefix) => Array.from({ length: 20 }, (_, i) => `${prefix}${i}`).reduce((all, id) => applyDraftSelection(all, id, [], "BLUE"), []);
    const selections = draftOf("champ");
    const snapshotOf = (report, blue, red, { picks = selections, playerOffset = 0, roleShift = 0 } = {}) => {
      const players = [...R.buildRosterIndex(report.opponent_prep.teams).players.values()];
      const ids = [blue.team_id, red.team_id];
      const rosters = Object.fromEntries(ids.map((id, n) => [id, Object.fromEntries(ROLES.map((role, r) => {
        const p = players[n * 5 + r + (n === 0 && r === 4 ? playerOffset : 0)]; return [role, { source_team_id: p.source_team_id, player_id: p.player_id }];
      }))]));
      const roleOf = (side) => { const p = S.teamPicks(picks, side); return Object.fromEntries(ROLES.map((role, i) => [role, p[(i + (side === "BLUE" ? roleShift : 0)) % 5]])); };
      const result = S.buildSimulationReadiness({ report, blueTeam: blue, redTeam: red, selections: picks, games: [], firstPickSide: "BLUE",
        roster: { basis: R.rosterBasis(report), teamIds: ids.slice().sort(), rosters }, roles: { [blue.team_id]: roleOf("BLUE"), [red.team_id]: roleOf("RED") } });
      assert.equal(result.ok, true, JSON.stringify(result.issues));
      return structuredClone(result.snapshot);
    };
    const [teamA, teamB, teamC] = baseReport.opponent_prep.teams;
    const snapshot = snapshotOf(baseReport, teamA, teamB);
    const [first, second] = [teamA.team_id, teamB.team_id].sort((x, y) => x < y ? -1 : 1);
    const neutral = () => ({ [teamA.team_id]: { ...E.NEUTRAL_DRAFT }, [teamB.team_id]: { ...E.NEUTRAL_DRAFT } });
    let counter = 0;
    const runOf = (snap, seed, drafts) => { const r = E.buildExperimentRun(++counter, snap, seed, drafts); assert.equal(r.ok, true, JSON.stringify(r.issues)); return r.run; };
    const end = (run) => run.endMinute;
    const codes = (c) => c.ok ? [] : c.refusals.map((r) => r.code);

    await t.test("identical assumptions and seed: no change and every difference is zero", () => {
      const a = runOf(snapshot, "3", neutral()), b = runOf(structuredClone(snapshot), "3", neutral());
      const c = X.compareExperimentRuns(a, b, end(b));
      assert.equal(c.ok, true);
      assert.equal(c.changeKind, "NONE");
      assert.deepEqual(c.changes, []);
      for (const team of c.outcome.teams) for (const stat of X.OUTCOME_STATS) assert.equal(team.delta[stat], 0);
      assert.equal(c.outcome.end.minuteDelta, 0);
      assert.deepEqual(c.outcome.end.a, c.outcome.end.b);
    });

    await t.test("one assumption changed: single diff keyed by the real source team ID", () => {
      const a = runOf(snapshot, "11", neutral());
      const drafts = neutral(); drafts[second].teamfight = "0.75";
      const b = runOf(snapshot, "11", drafts);
      const c = X.compareExperimentRuns(a, b, end(b));
      assert.equal(c.changeKind, "SINGLE");
      assert.deepEqual(c.changes, [{ sourceId: second, field: "teamfight", a: 0, b: 0.75 }]);
      assert.deepEqual(c.teams.map((team) => team.sourceId), [first, second]);
      assert.equal(c.teams[1].fields.teamfight.changed, true);
      assert.equal(c.teams[0].fields.teamfight.changed, false);
      // Outcome rows are matched by source ID to each run's own final model state.
      const coreOf = (run, id) => E.CORE_TEAM_IDS.find((core) => run.teams[core].sourceId === id);
      for (const row of c.outcome.teams) {
        assert.deepEqual(row.a, a.result.states[coreOf(a, row.sourceId)]);
        assert.deepEqual(row.b, b.result.states[coreOf(b, row.sourceId)]);
      }
    });

    await t.test("several assumptions changed: multiple diff across both teams", () => {
      const a = runOf(snapshot, "11", neutral());
      const drafts = neutral(); drafts[first].lane = "-0.5"; drafts[second].tempo = "1"; drafts[second].lane = "0.2";
      const c = X.compareExperimentRuns(a, runOf(snapshot, "11", drafts), 999);
      assert.equal(c.changeKind, "MULTIPLE");
      assert.deepEqual(c.changes.map((x) => [x.sourceId, x.field]), [[first, "lane"], [second, "lane"], [second, "tempo"]]);
    });

    await t.test("different seed, ruleset, evidence, roster, roles, draft or teams are refused with reasons", () => {
      const a = runOf(snapshot, "5", neutral());
      assert.deepEqual(codes(X.compareExperimentRuns(a, runOf(snapshot, "6", neutral()), 999)), ["SEED"]);
      const evidence = structuredClone(snapshot); evidence.evidenceIdentity += "-changed";
      assert.deepEqual(codes(X.compareExperimentRuns(a, runOf(evidence, "5", neutral()), 999)), ["EVIDENCE"]);
      const patched = structuredClone(snapshot); patched.patch = "99.99";
      assert.deepEqual(codes(X.compareExperimentRuns(a, runOf(patched, "5", neutral()), 999)), ["EVIDENCE"]);
      assert.deepEqual(codes(X.compareExperimentRuns(a, runOf(snapshotOf(baseReport, teamA, teamB, { playerOffset: 10 }), "5", neutral()), 999)), ["ROSTER"]);
      assert.deepEqual(codes(X.compareExperimentRuns(a, runOf(snapshotOf(baseReport, teamA, teamB, { roleShift: 1 }), "5", neutral()), 999)), ["ROLES"]);
      assert.ok(codes(X.compareExperimentRuns(a, runOf(snapshotOf(baseReport, teamA, teamB, { picks: draftOf("other") }), "5", neutral()), 999)).includes("DRAFT"));
      const other = runOf(snapshotOf(baseReport, teamA, teamC), "5", { [teamA.team_id]: { ...E.NEUTRAL_DRAFT }, [teamC.team_id]: { ...E.NEUTRAL_DRAFT } });
      assert.deepEqual(codes(X.compareExperimentRuns(a, other, 999)), ["TEAMS"]);
      const seedAndRoster = X.compareExperimentRuns(a, runOf(snapshotOf(baseReport, teamA, teamB, { playerOffset: 10 }), "6", neutral()), 999);
      assert.deepEqual(codes(seedAndRoster), ["SEED", "ROSTER"]);
      assert.equal("outcome" in seedAndRoster, false, "a refused comparison carries no result");
      const ruleset = structuredClone(a); ruleset.input.ruleset = "other-v2"; ruleset.result.ruleset = "other-v2";
      assert.deepEqual(codes(X.compareExperimentRuns(a, ruleset, 999)), ["UNTRUSTED"], "a forged run is refused before any comparison");
    });

    await t.test("side exchange: teams stay matched by source ID, the swapped draft is refused, not mis-compared", () => {
      const a = runOf(snapshot, "8", neutral());
      const swapped = runOf(snapshotOf(baseReport, teamB, teamA), "8", neutral());
      const refused = codes(X.compareExperimentRuns(a, swapped, 999));
      assert.ok(refused.includes("DRAFT") && !refused.includes("TEAMS"), refused.join());
      // Only the side label changes: same teams, same draft payload, same roster/roles by team ID.
      const relabeled = structuredClone(snapshot);
      [relabeled.draft.teams.BLUE, relabeled.draft.teams.RED] = [relabeled.draft.teams.RED, relabeled.draft.teams.BLUE];
      const relabeledRun = runOf(relabeled, "8", neutral());
      assert.deepEqual(codes(X.compareExperimentRuns(a, relabeledRun, 999)), ["DRAFT"]);
      for (const core of E.CORE_TEAM_IDS) assert.equal(swapped.teams[core].sourceId, a.teams[core].sourceId);
    });

    await t.test("two teams with the same display name are kept apart by team ID", () => {
      const report = structuredClone(baseReport);
      const [x, y] = report.opponent_prep.teams;
      y.team_name = x.team_name;
      const snap = snapshotOf(report, x, y);
      assert.equal(snap.draft.teams.BLUE.name, snap.draft.teams.RED.name);
      const a = runOf(snap, "4", { [x.team_id]: { ...E.NEUTRAL_DRAFT }, [y.team_id]: { ...E.NEUTRAL_DRAFT } });
      const b = runOf(snap, "4", { [x.team_id]: { ...E.NEUTRAL_DRAFT }, [y.team_id]: { ...E.NEUTRAL_DRAFT, lane: "0.4" } });
      const c = X.compareExperimentRuns(a, b, 999);
      assert.equal(c.ok, true);
      assert.deepEqual(c.changes, [{ sourceId: y.team_id, field: "lane", a: 0, b: 0.4 }]);
      assert.equal(new Set(c.teams.map((team) => team.sourceId)).size, 2);
    });

    await t.test("outcome stays hidden until B is at its end; A is kept only after its end", () => {
      const a = runOf(snapshot, "21", neutral());
      const drafts = neutral(); drafts[first].lane = "1";
      const b = runOf(snapshot, "21", drafts);
      for (const minute of [0, 1, Math.floor(end(b) / 2), end(b) - 1, Number.NaN]) {
        const c = X.compareExperimentRuns(a, b, minute);
        assert.equal(c.ok, true);
        assert.equal(c.outcome, null, `minute ${minute}`);
        assert.doesNotMatch(JSON.stringify(c), /reason|winner|minute|gold|base/);
      }
      assert.notEqual(X.compareExperimentRuns(a, b, end(b)).outcome, null);
      for (const minute of [0, end(a) - 1, Number.NaN]) assert.equal(X.freezeBaseline(a, minute).ok, false);
      assert.equal(X.freezeBaseline(a, end(a)).ok, true);
    });

    await t.test("baseline and results are detached, frozen and never alter the runs", () => {
      const source = runOf(snapshot, "9", neutral());
      const sourceText = JSON.stringify(source);
      const kept = X.freezeBaseline(source, source.endMinute);
      assert.equal(kept.ok, true);
      assert.notEqual(kept.baseline, source, "baseline is a detached clone");
      assert.notEqual(kept.baseline.snapshot, source.snapshot);
      assert.notEqual(kept.baseline.result.events, source.result.events);
      assert.equal(JSON.stringify(kept.baseline), sourceText);
      assert.equal(E.isTrustedRun(kept.baseline), true);
      const before = JSON.stringify(kept.baseline);
      assert.ok(Object.isFrozen(kept.baseline.snapshot.draft) && Object.isFrozen(kept.baseline.result.events));
      assert.throws(() => { kept.baseline.teams.team_a.assumptions.lane = 1; });
      assert.equal(JSON.stringify(source), sourceText);
      const b = runOf(snapshot, "9", neutral());
      const bText = JSON.stringify(b);
      const c1 = X.compareExperimentRuns(kept.baseline, b, end(b));
      const snapshotC1 = JSON.stringify(c1);
      c1.teams[0].fields.lane.b = 99; c1.outcome.teams[0].a.gold = -1; c1.changes.push({});
      assert.equal(JSON.stringify(X.compareExperimentRuns(kept.baseline, b, end(b))), snapshotC1);
      assert.equal(JSON.stringify(kept.baseline), before);
      assert.equal(JSON.stringify(b), bText);
    });

    await t.test("untrusted (copied, inherited, tampered or malformed) runs are refused explicitly", () => {
      const a = runOf(snapshot, "2", neutral());
      const good = runOf(snapshot, "2", neutral());
      assert.equal(X.trustedRun(good), good);
      // Identical content is not provenance: unedited copies are refused too (no file import exists).
      const bad = [null, undefined, 1, "run", [], Object.create(good), { ...good, run: () => 1 }, { ...good },
        structuredClone(good), JSON.parse(JSON.stringify(good))];
      const winner = structuredClone(good); winner.result.winner = winner.result.winner === "team_a" ? "team_b" : "team_a"; bad.push(winner);
      const trace = structuredClone(good); trace.result.events[0].amount += 1; bad.push(trace);
      const flipped = structuredClone(good); [flipped.teams.team_a.sourceId, flipped.teams.team_b.sourceId] = [flipped.teams.team_b.sourceId, flipped.teams.team_a.sourceId]; bad.push(flipped);
      const assumed = structuredClone(good); assumed.teams.team_a.assumptions.lane = 0.5; bad.push(assumed);
      const seed = structuredClone(good); seed.seed = 3; bad.push(seed);
      const endMinute = structuredClone(good); endMinute.endMinute = 1; bad.push(endMinute);
      const noRoles = structuredClone(good); delete noRoles.snapshot.roles; bad.push(noRoles);
      const inheritedTeams = structuredClone(good); inheritedTeams.teams = Object.create(good.teams); bad.push(inheritedTeams);
      for (const [i, run] of bad.entries()) {
        assert.equal(X.trustedRun(run), null, `case ${i}`);
        assert.equal(E.cloneTrustedRun(run), null, `case ${i}`);
        assert.deepEqual(codes(X.compareExperimentRuns(a, run, 999)), ["UNTRUSTED"], `case ${i}`);
        assert.deepEqual(codes(X.compareExperimentRuns(run, a, 999)), ["UNTRUSTED"], `case ${i} as baseline`);
        assert.equal(X.freezeBaseline(run, 999).ok, false);
      }
      // Trusted runs are deep-frozen, so they cannot be edited in place into a different run.
      assert.throws(() => { good.result.winner = "team_x"; });
      assert.throws(() => { good.result.events[0].amount += 1; });
      assert.equal(X.trustedRun(good), good);
    });

    await t.test("panel: collapsed, keep button only after the end, no comparison without a baseline", () => {
      const run = runOf(snapshot, "1", neutral());
      const middle = renderToStaticMarkup(createElement(ExperimentComparisonPanel, { run, shownMinute: 3, readyInput: snapshot }));
      assert.match(middle, /<details class="experiment-comparison">/);
      assert.match(middle, /<button type="button" disabled="">이 실행을 비교 기준 A로 보관/);
      assert.match(middle, /실제 승률·선수 기여도·인과 효과가 아니며/);
      assert.match(middle, /두 실행은 이 브라우저 화면에만 있어 페이지를 떠나면 사라지며, 비교 요약 글만 복사할 수 있습니다/);
      assert.doesNotMatch(middle, /모델 내부 차이 \(B − A\)|<table/);
      const done = renderToStaticMarkup(createElement(ExperimentComparisonPanel, { run, shownMinute: run.endMinute, readyInput: snapshot }));
      assert.match(done, /<button type="button">이 실행을 비교 기준 A로 보관/);
      assert.doesNotMatch(done, /기준 A 해제|<table/);
    });
  } finally {
    await vite.close();
  }
});
