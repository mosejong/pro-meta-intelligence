import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("load baseline A's seed and assumptions into the inputs (numbers only)", async (t) => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const P = await vite.ssrLoadModule("/app/experiment-baseline-inputs.ts");
    const X = await vite.ssrLoadModule("/app/experiment-comparison.ts");
    const L = await vite.ssrLoadModule("/app/experiment-input-link.ts");
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
    const frozen = (run) => { const kept = X.freezeBaseline(run, run.endMinute); assert.equal(kept.ok, true); return kept.baseline; };
    const coreOf = (run, id) => E.CORE_TEAM_IDS.find((core) => run.teams[core].sourceId === id);

    /** Plan texts read back through the existing validator give exactly A's seed and numbers. */
    const checkPlan = (plan, a, ready) => {
      assert.equal(plan.ok, true, JSON.stringify(plan));
      assert.deepEqual(Object.keys(plan).sort(), ["drafts", "ok", "seedText"], "numbers only, no snapshot/player data");
      assert.equal(plan.seedText, String(a.seed));
      assert.deepEqual(Object.keys(plan.drafts).sort(), [first, second].sort(), "keyed by source team ID");
      const v = E.validateRunInputs(ready, plan.seedText, plan.drafts);
      assert.equal(v.ok, true);
      assert.equal(v.seed, a.seed);
      for (const id of [first, second]) {
        assert.deepEqual(Object.keys(plan.drafts[id]).sort(), [...E.ASSUMPTION_FIELDS].sort());
        for (const field of E.ASSUMPTION_FIELDS) {
          const want = a.teams[coreOf(a, id)].assumptions[field];
          assert.ok(Object.is(v.assumptions[id][field], want === 0 ? 0 : want), `${id} ${field}`);
          assert.doesNotMatch(plan.drafts[id][field], /e/i, "no exponent text");
        }
      }
    };

    await t.test("neutral A: seed and 0 texts", () => {
      const a = frozen(runOf(snapshot, "42", neutral()));
      const plan = P.planBaselineInputs(a, snapshot, false);
      checkPlan(plan, a, snapshot);
      assert.deepEqual(plan.drafts[first], { lane: "0", tempo: "0", teamfight: "0" });
    });

    await t.test("changed, boundary and tiny finite values are moved losslessly", () => {
      const tiny = L.plainDecimal(Number.MIN_VALUE);
      assert.ok(tiny && !/e/i.test(tiny));
      const drafts = neutral();
      drafts[first] = { lane: "0.0000001", tempo: "-0", teamfight: "-1" };
      drafts[second] = { lane: tiny, tempo: "0.123456789012345", teamfight: "1" };
      const source = runOf(snapshot, "4294967295", drafts);
      assert.equal(source.teams[coreOf(source, second)].assumptions.lane, Number.MIN_VALUE);
      const a = frozen(source);
      const plan = P.planBaselineInputs(a, structuredClone(snapshot), false);
      checkPlan(plan, a, snapshot);
      assert.equal(plan.seedText, "4294967295");
      assert.equal(plan.drafts[first].tempo, "0", "-0 → 0");
      assert.equal(plan.drafts[second].lane, tiny);
      // An explicit new run from the loaded numbers reproduces A: NONE, every difference 0.
      const again = runOf(structuredClone(snapshot), plan.seedText, plan.drafts);
      const c = X.compareExperimentRuns(a, again, again.endMinute);
      assert.equal(c.ok, true); assert.equal(c.changeKind, "NONE");
      for (const team of c.outcome.teams) for (const stat of X.OUTCOME_STATS) assert.equal(team.delta[stat], 0);
    });

    await t.test("plan does not depend on current fields; works for the live (unfrozen) A too", () => {
      const drafts = neutral(); drafts[second].teamfight = "0.75";
      const source = runOf(snapshot, "7", drafts);
      const a = frozen(source);
      const one = P.planBaselineInputs(a, snapshot, false);
      assert.equal(P.planBaselineInputs.length, 3, "no current-field argument");
      assert.deepEqual(P.planBaselineInputs(source, snapshot, false), one);
      assert.deepEqual(P.planBaselineInputs(a, snapshot, false), one, "same values again are safe");
      assert.equal(one.drafts[second].teamfight, "0.75");
    });

    await t.test("isolation: A, ready input and later plans unaffected by edits to a returned plan", () => {
      const drafts = neutral(); drafts[first].lane = "-0.5";
      const a = frozen(runOf(snapshot, "9", drafts));
      const ready = structuredClone(snapshot);
      const before = [JSON.stringify(a), JSON.stringify(ready)];
      const plan = P.planBaselineInputs(a, ready, false);
      const fresh = JSON.stringify(plan);
      plan.drafts[first].lane = "1"; plan.drafts.extra = { lane: "0" }; plan.seedText = "0";
      assert.deepEqual([JSON.stringify(a), JSON.stringify(ready)], before);
      assert.equal(JSON.stringify(P.planBaselineInputs(a, ready, false)), fresh);
      assert.equal(E.isTrustedRun(a), true);
    });

    await t.test("same display name: matched by source ID, not by name or side", () => {
      const report = structuredClone(baseReport);
      const [x, y] = report.opponent_prep.teams;
      y.team_name = x.team_name;
      const snap = snapshotOf(report, x, y);
      const d = { [x.team_id]: { ...E.NEUTRAL_DRAFT, lane: "0.3" }, [y.team_id]: { ...E.NEUTRAL_DRAFT, tempo: "-0.2" } };
      const a = frozen(runOf(snap, "4", d));
      const plan = P.planBaselineInputs(a, snap, false);
      assert.equal(plan.ok, true);
      assert.deepEqual(plan.drafts[x.team_id], { lane: "0.3", tempo: "0", teamfight: "0" });
      assert.deepEqual(plan.drafts[y.team_id], { lane: "0", tempo: "-0.2", teamfight: "0" });
    });

    await t.test("refused: untrusted, blocked, no ready input, any fixed-context mismatch", () => {
      const source = runOf(snapshot, "5", neutral());
      const a = frozen(source);
      for (const bad of [null, undefined, {}, 1, structuredClone(a), JSON.parse(JSON.stringify(a)), Object.create(a), { ...a }]) {
        assert.equal(P.planBaselineInputs(bad, snapshot, false).reason, "UNTRUSTED");
      }
      for (const blocked of [true, undefined, 1, "false"]) assert.equal(P.planBaselineInputs(a, snapshot, blocked).reason, "BLOCKED", String(blocked));
      assert.equal(P.planBaselineInputs(a, null, false).reason, "NO_READY_INPUT");
      const evidence = structuredClone(snapshot); evidence.evidenceIdentity += "-changed";
      const patched = structuredClone(snapshot); patched.patch = "99.99";
      const firstPick = structuredClone(snapshot); firstPick.draft.firstPickSide = firstPick.draft.firstPickSide === "BLUE" ? "RED" : "BLUE";
      const mismatches = {
        evidence, patched,
        draft: snapshotOf(baseReport, teamA, teamB, { picks: draftOf("other") }),
        roles: snapshotOf(baseReport, teamA, teamB, { roleShift: 1 }),
        roster: snapshotOf(baseReport, teamA, teamB, { playerOffset: 10 }),
        pair: snapshotOf(baseReport, teamA, teamC),
        sides: snapshotOf(baseReport, teamB, teamA),
        firstPick,
      };
      for (const [name, ready] of Object.entries(mismatches)) {
        const plan = P.planBaselineInputs(a, ready, false);
        assert.equal(plan.reason, "CONTEXT_MISMATCH", name);
        assert.deepEqual(Object.keys(plan).sort(), ["message", "ok", "reason"], `${name}: reason only, no numbers`);
      }
      assert.equal(P.planBaselineInputs(a, { broken: true }, false).ok, false, "malformed ready input refused, not thrown");
    });

    await t.test("panel SSR: legacy call without new props stays safe; initial buttons unchanged", () => {
      const run = runOf(snapshot, "1", neutral());
      const legacy = renderToStaticMarkup(createElement(ExperimentComparisonPanel, { run, shownMinute: run.endMinute, readyInput: snapshot }));
      assert.match(legacy, /<button type="button">이 실행을 비교 기준 A로 보관/);
      assert.doesNotMatch(legacy, /기준 A의 가정값 불러오기|기준 A 해제|<table/);
      let calls = 0;
      const wired = renderToStaticMarkup(createElement(ExperimentComparisonPanel, { run, shownMinute: 3, readyInput: snapshot, blocked: false, onLoadBaselineInputs: () => { calls++; } }));
      assert.match(wired, /<button type="button" disabled="">이 실행을 비교 기준 A로 보관/);
      assert.doesNotMatch(wired, /기준 A의 가정값 불러오기/, "no baseline → no load button");
      assert.equal(calls, 0, "render never applies inputs");
    });
  } finally {
    await vite.close();
  }
});
