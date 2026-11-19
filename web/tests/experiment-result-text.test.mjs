import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("completed assumption experiment: plain result text and share panel", async (t) => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const E = await vite.ssrLoadModule("/app/experiment-replay.ts");
    const T = await vite.ssrLoadModule("/app/experiment-result-text.ts");
    const S = await vite.ssrLoadModule("/app/simulation-scenario.ts");
    const R = await vite.ssrLoadModule("/app/roster-scenario.ts");
    const { applyDraftSelection } = await vite.ssrLoadModule("/app/draft-agent.ts");
    const { ExperimentResultSharePanel } = await vite.ssrLoadModule("/app/experiment-result-share-panel.tsx");
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
    const drafts = (a, b) => ({ [teamA.team_id]: a, [teamB.team_id]: b });
    const runOf = (seed, d, id = 1) => { const r = E.buildExperimentRun(id, snapshot, seed, d); assert.equal(r.ok, true, JSON.stringify(r.issues)); return r.run; };
    const custom = { lane: "0.5", tempo: "-0.25", teamfight: "1" };
    const run = runOf("7", drafts(custom, { ...E.NEUTRAL_DRAFT }), 3);
    const textOf = (r, minute = r.endMinute) => T.buildExperimentResultText(r, minute);
    const coreOf = (sourceId) => E.CORE_TEAM_IDS.find((core) => run.teams[core].sourceId === sourceId);
    const mutate = (edit) => { const copy = structuredClone(run); edit(copy); return copy; };
    const refused = (r, reason, minute) => { const out = textOf(r, minute); assert.equal(out.ok, false); if (reason) assert.equal(out.reason, reason); };

    await t.test("plain text carries the fixed run values and the boundary sentence last", () => {
      const out = textOf(run);
      assert.equal(out.ok, true, out.reason);
      const text = out.text;
      const lines = text.split("\n");
      assert.match(lines[0], /실행 #3/);
      assert.ok(text.includes("실행 당시 고정 기록"), "marks the run as the recorded run, not the current inputs");
      for (const value of [`패치 ${snapshot.patch}`, `자료 기준 시각 ${snapshot.cutoff}`, "고정 시드 7", "assumption-manager-v1", `모델 종료: ${run.endMinute}분`]) assert.ok(text.includes(value), value);
      assert.equal(lines.at(-1), T.RESULT_TEXT_BOUNDARY);
      assert.equal(T.RESULT_TEXT_BOUNDARY, "사용자 가정과 작성 규칙에 따른 모델 내부 결과이며 실제 LoL 승패·승률 예측이 아닙니다. 실제 선수·챔피언·룬·아이템 효과는 반영하지 않았습니다.");
      const winner = run.teams[run.result.winner];
      assert.ok(text.includes(`모델 내부 승자: ${winner.name}`));
      for (const core of E.CORE_TEAM_IDS) {
        const team = run.teams[core], state = run.result.states[core];
        const side = team.sideAtRun === "BLUE" ? "블루" : "레드";
        assert.ok(lines.some((line) => line.startsWith(`- ${team.name} (실행 당시 ${side}): 라인 ${team.assumptions.lane} · 운영 ${team.assumptions.tempo} · 한타 ${team.assumptions.teamfight}`)), core);
        assert.ok(lines.some((line) => line.startsWith(`- ${team.name}: `) && line.includes(`모델 킬 ${state.kills}`) && line.includes(`추상 오브젝트 ${state.objectives}`) &&
          line.includes(`기지 내구도 ${state.base}/100`) && line.includes(`모델 자원 ${state.gold.toLocaleString("en-US")}`)), core);
      }
      // Two separate teams, assumptions matched to their own source team.
      assert.notEqual(run.teams.team_a.sourceId, run.teams.team_b.sourceId);
      assert.deepEqual(run.teams[coreOf(teamA.team_id)].assumptions, { lane: 0.5, tempo: -0.25, teamfight: 1 });
      assert.deepEqual(run.teams[coreOf(teamB.team_id)].assumptions, { lane: 0, tempo: 0, teamfight: 0 });
      // No raw IDs, champion IDs, JSON or event trace.
      const names = `${teamA.name ?? ""} ${teamB.name ?? ""} ${run.teams.team_a.name} ${run.teams.team_b.name}`;
      for (const id of [teamA.team_id, teamB.team_id]) if (!names.includes(id)) assert.ok(!text.includes(id), id);
      for (const p of players.slice(0, 10)) if (!names.includes(p.player_id) && String(p.player_id).length > 3) assert.ok(!text.includes(p.player_id), p.player_id);
      assert.ok(!/champ\d/.test(text));
      assert.ok(!/[{}[\]"]/.test(text.replace(/^\[가정 실험 요약\]/, "")), "no JSON");
      assert.ok(!/GROWTH|SKIRMISH|OBJECTIVE|team_a|team_b/.test(text));
    });

    await t.test("only at or after the end; before the end or non-finite minutes are refused", () => {
      refused(run, "NOT_COMPLETE", 0);
      refused(run, "NOT_COMPLETE", run.endMinute - 1);
      for (const bad of [NaN, Infinity, -Infinity, String(run.endMinute)]) refused(run, "NOT_COMPLETE", bad);
      // Explicit undefined must not fall back to the end minute (textOf has a default parameter).
      assert.deepEqual(T.buildExperimentResultText(run, undefined), { ok: false, reason: "NOT_COMPLETE" });
      assert.equal(textOf(run, run.endMinute).ok, true);
      assert.equal(textOf(run, run.endMinute + 5).ok, true);
      // Back from the end and then to the end again: same text.
      refused(run, "NOT_COMPLETE", run.endMinute - 1);
      assert.equal(textOf(run).text, textOf(run, run.endMinute).text);
    });

    await t.test("malformed numbers, winner, reason or mismatched run are refused as a whole", () => {
      const other = (core) => core === "team_a" ? "team_b" : "team_a";
      const w = run.result.winner, l = other(w);
      const cases = [
        ["unknown winner", (r) => { r.result.winner = "team_c"; }],
        ["unknown reason", (r) => { r.result.reason = "SURRENDER"; }],
        ["reason flipped", (r) => { r.result.reason = r.result.reason === "TIME_LIMIT" ? "BASE_DESTROYED" : "TIME_LIMIT"; }],
        ["winner flipped", (r) => { r.result.winner = l; }],
        ["NaN gold", (r) => { r.result.states.team_a.gold = NaN; }],
        ["negative kills", (r) => { r.result.states.team_b.kills = -1; }],
        ["fractional objectives", (r) => { r.result.states.team_a.objectives = 1.5; }],
        ["base above 100", (r) => { r.result.states[w].base = 101; }],
        ["missing state", (r) => { delete r.result.states.team_b; }],
        ["result minute mismatch", (r) => { r.result.minute = r.endMinute - 1; }],
        ["end minute out of range", (r) => { r.endMinute = 99; r.result.minute = 99; }],
        ["seed mismatch", (r) => { r.seed = 8; }],
        ["ruleset mismatch", (r) => { r.result.ruleset = "other"; }],
        ["missing result input", (r) => { delete r.result.input; }],
        ["null result input", (r) => { r.result.input = null; }],
        ["result input ruleset mismatch", (r) => { r.result.input.ruleset = "other"; }],
        ["printed assumptions differ from model input", (r) => { r.teams.team_a.assumptions.lane = r.teams.team_a.assumptions.lane === 1 ? 0 : 1; }],
        ["duplicate source team", (r) => { r.teams.team_b.sourceId = r.teams.team_a.sourceId; }],
        ["same side", (r) => { r.teams.team_b.sideAtRun = r.teams.team_a.sideAtRun; }],
        ["bad run number", (r) => { r.runId = 0; }],
      ];
      for (const [label, edit] of cases) assert.equal(textOf(mutate(edit), 99).ok, false, label);
      assert.equal(textOf(mutate((r) => { r.snapshot.cutoff = "2026-11-19"; }), 99).reason, "INVALID_TEXT");
      assert.equal(textOf(mutate((r) => { r.snapshot.cutoff = "2026-11-19T00:00:00"; }), 99).reason, "INVALID_TEXT", "timezone required");
      assert.equal(textOf(mutate((r) => { r.snapshot.patch = " \n "; }), 99).reason, "INVALID_TEXT");
      assert.equal(textOf(null, 99).ok, false);
    });

    await t.test("names: injected controls removed, length capped, blank refused", () => {
      const renamed = (name) => mutate((r) => { r.teams.team_a.name = name; r.snapshot.draft.teams[r.teams.team_a.sideAtRun].name = name; });
      const out = textOf(renamed("Evil\nTeam‮\u0007 X"), run.endMinute);
      assert.equal(out.ok, true);
      assert.ok(out.text.includes("Evil Team X"));
      // Only the joining newlines may remain: no other control (Cc) or bidi override.
      assert.ok(!/[\p{Cc}‮]/u.test(out.text.replaceAll("\n", "")));
      assert.ok(out.text.split("\n").every((line) => !line.startsWith("Team")), "an injected newline never starts a new line");
      const long = textOf(renamed("가".repeat(100)), run.endMinute);
      assert.equal(long.ok, true);
      assert.ok(long.text.includes(`${"가".repeat(39)}…`) && !long.text.includes("가".repeat(40)));
      assert.equal(textOf(renamed("  ‏⁦ "), run.endMinute).reason, "INVALID_TEXT");
      assert.equal(textOf(renamed(""), run.endMinute).reason, "INVALID_TEXT");
      assert.equal(textOf(mutate((r) => { r.teams.team_a.name = "Other"; }), run.endMinute).ok, false, "name must match the frozen snapshot");
    });

    await t.test("deterministic, input untouched, no model re-run needed", () => {
      const loose = structuredClone(run);
      const before = structuredClone(loose);
      const a = textOf(loose), b = textOf(loose);
      assert.deepEqual(a, b);
      assert.deepEqual(loose, before);
      assert.equal(a.text, textOf(run).text, "clone and frozen original give the same text");
      // The text is read from the stored result only: without the event trace it is unchanged.
      assert.equal(textOf(mutate((r) => { r.result.events = []; })).text, a.text);
      // A different stored run (other seed) gives its own recorded values, not the current inputs.
      const other = runOf("8", drafts(custom, { ...E.NEUTRAL_DRAFT }), 4);
      const otherText = textOf(other);
      assert.equal(otherText.ok, true);
      assert.ok(otherText.text.includes("고정 시드 8") && !otherText.text.includes("고정 시드 7"));
    });

    await t.test("share panel SSR: disabled before end, enabled at end, no textarea initially", () => {
      const before = renderToStaticMarkup(createElement(ExperimentResultSharePanel, { run, shownMinute: 0 }));
      assert.match(before, /<button[^>]*disabled=""[^>]*>가정 실험 요약 복사<\/button>/);
      assert.ok(before.includes("결과까지 확인하면"));
      assert.ok(!before.includes("<textarea"));
      const after = renderToStaticMarkup(createElement(ExperimentResultSharePanel, { run, shownMinute: run.endMinute }));
      assert.match(after, /<button[^>]*>가정 실험 요약 복사<\/button>/);
      assert.ok(!/<button[^>]*disabled/.test(after));
      assert.ok(!after.includes("<textarea"));
      const broken = renderToStaticMarkup(createElement(ExperimentResultSharePanel, { run: mutate((r) => { r.result.winner = "team_c"; }), shownMinute: run.endMinute }));
      assert.match(broken, /<button[^>]*disabled/);
    });
  } finally {
    await vite.close();
  }
});
