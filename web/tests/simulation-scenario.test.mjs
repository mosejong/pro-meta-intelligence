import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("simulation input readiness: explicit roles, current rosters, detached snapshot and read-only replay", async (t) => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const S = await vite.ssrLoadModule("/app/simulation-scenario.ts");
    const R = await vite.ssrLoadModule("/app/roster-scenario.ts");
    const { applyDraftSelection, completeFearlessGame } = await vite.ssrLoadModule("/app/draft-agent.ts");
    const { SimulationReadinessPanel } = await vite.ssrLoadModule("/app/simulation-readiness-panel.tsx");
    const report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
    const [teamA, teamB] = report.opponent_prep.teams;
    const ROLES = R.ROSTER_ROLES;
    const index = R.buildRosterIndex(report.opponent_prep.teams);
    const players = [...index.players.values()];
    assert.ok(players.length >= 10, "fixture needs at least ten unambiguous players");
    const draft = (side = "BLUE", prefix = "champ", locks = []) => Array.from({ length: 20 }, (_, i) => i)
      .reduce((all, i) => applyDraftSelection(all, `${prefix}${i}`, locks, side), []);
    /** Full roster: ten distinct observed players (virtual placements allowed). */
    const fullRoster = (blue = teamA, red = teamB) => {
      const ids = [blue.team_id, red.team_id];
      const rosters = Object.fromEntries(ids.map((id, t) => [id, Object.fromEntries(ROLES.map((role, r) => {
        const p = players[t * 5 + r]; return [role, { source_team_id: p.source_team_id, player_id: p.player_id }];
      }))]));
      return { basis: R.rosterBasis(report), teamIds: ids.slice().sort(), rosters };
    };
    const picksOf = (selections, side) => S.teamPicks(selections, side);
    const rolesFor = (selections, blue = teamA, red = teamB) => ({
      [blue.team_id]: Object.fromEntries(ROLES.map((role, i) => [role, picksOf(selections, "BLUE")[i]])),
      [red.team_id]: Object.fromEntries(ROLES.map((role, i) => [role, picksOf(selections, "RED")[i]])),
    });
    const input = (overrides = {}) => {
      const selections = overrides.selections ?? draft(overrides.firstPickSide ?? "BLUE");
      return { report, blueTeam: teamA, redTeam: teamB, games: [], firstPickSide: "BLUE", roster: fullRoster(), roles: rolesFor(selections), ...overrides, selections };
    };
    const ready = (value) => { const result = S.buildSimulationReadiness(value); assert.equal(result.ok, true, JSON.stringify(result.issues)); return result.snapshot; };
    const codes = (value) => { const result = S.buildSimulationReadiness(value); assert.equal(result.ok, false); return result.issues.map((issue) => issue.code); };

    await t.test("incomplete draft and missing roster are not ready", () => {
      const partial = draft().slice(0, 19);
      assert.deepEqual(codes(input({ selections: partial, roles: {} })), ["DRAFT_INCOMPLETE"]);
      assert.deepEqual(codes(input({ roster: null })), ["ROSTER_PENDING"]);
      assert.deepEqual(codes(input({ blueTeam: null })), ["NO_TEAMS"]);
    });

    await t.test("empty roster slot blocks readiness", () => {
      const roster = fullRoster(); roster.rosters[teamA.team_id].MID = null;
      assert.ok(codes(input({ roster })).includes("ROSTER_EMPTY_SLOT"));
      const empty = fullRoster(); for (const id of Object.keys(empty.rosters)) for (const role of ROLES) empty.rosters[id][role] = null;
      assert.equal(codes(input({ roster: empty })).filter((code) => code === "ROSTER_EMPTY_SLOT").length, 10);
    });

    await t.test("unknown player, duplicated player and changed basis are rejected", () => {
      const ghost = fullRoster(); ghost.rosters[teamA.team_id].TOP = { source_team_id: teamA.team_id, player_id: "ghost-player" };
      assert.deepEqual(codes(input({ roster: ghost })), ["ROSTER_INVALID"]);
      const dup = fullRoster(); dup.rosters[teamB.team_id].TOP = { ...dup.rosters[teamA.team_id].TOP };
      assert.deepEqual(codes(input({ roster: dup })), ["ROSTER_INVALID"]);
      const basis = fullRoster(); basis.basis = { ...basis.basis, cutoff: "2000-01-01T00:00:00Z" };
      assert.deepEqual(codes(input({ roster: basis })), ["ROSTER_INVALID"]);
      const otherPair = fullRoster(teamA, report.opponent_prep.teams[2]);
      assert.deepEqual(codes(input({ roster: otherPair })), ["ROSTER_INVALID"], "stale roster of another pair never attaches");
    });

    await t.test("roles: unassigned, duplicate, other team's pick, ban and wrong team keys are rejected", () => {
      const selections = draft();
      const roles = () => rolesFor(selections);
      const unassigned = roles(); unassigned[teamA.team_id].MID = null;
      assert.deepEqual(codes(input({ roles: unassigned })), ["ROLE_UNASSIGNED"]);
      const duplicate = roles(); duplicate[teamA.team_id].MID = duplicate[teamA.team_id].TOP;
      assert.deepEqual(codes(input({ roles: duplicate })), ["ROLE_DUPLICATE"]);
      const otherTeam = roles(); otherTeam[teamA.team_id].TOP = picksOf(selections, "RED")[0];
      assert.deepEqual(codes(input({ roles: otherTeam })), ["ROLE_NOT_TEAM_PICK"]);
      const ban = roles(); ban[teamA.team_id].TOP = selections.find((s) => s.kind === "BAN").champion_id;
      assert.deepEqual(codes(input({ roles: ban })), ["ROLE_NOT_TEAM_PICK"]);
      const name = roles(); name[teamA.team_id].TOP = teamA.team_name;
      assert.ok(codes(input({ roles: name })).includes("ROLE_NOT_TEAM_PICK"));
      const swapped = { [teamA.team_id]: roles()[teamA.team_id], "ghost-team": roles()[teamB.team_id] };
      assert.deepEqual(codes(input({ roles: swapped })), ["ROLE_SHAPE"]);
      const extra = roles(); extra[teamA.team_id].COACH = "x";
      assert.deepEqual(codes(input({ roles: extra })), ["ROLE_SHAPE"]);
    });

    await t.test("side swap: roles stay keyed by team ID and are checked against that team's current picks", () => {
      const selections = draft();
      const original = rolesFor(selections);
      // After swapping sides, teamA now plays RED; its old BLUE-pick roles do not fit its RED picks.
      assert.ok(codes(input({ blueTeam: teamB, redTeam: teamA, roster: fullRoster(teamB, teamA), roles: original })).includes("ROLE_NOT_TEAM_PICK"));
      const snapshot = ready(input({ blueTeam: teamB, redTeam: teamA, roster: fullRoster(teamB, teamA), roles: rolesFor(selections, teamB, teamA) }));
      assert.equal(snapshot.draft.teams.RED.id, teamA.team_id);
      assert.deepEqual(Object.values(snapshot.roles[teamA.team_id]), picksOf(selections, "RED"));
    });

    await t.test("first selection RED is recorded and role picks follow sides, not pick order", () => {
      const selections = draft("RED");
      const roles = rolesFor(selections);
      // Explicit order differs from pick order: reverse a team's assignment.
      const reversed = picksOf(selections, "BLUE").slice().reverse();
      roles[teamA.team_id] = Object.fromEntries(ROLES.map((role, i) => [role, reversed[i]]));
      const snapshot = ready(input({ selections, firstPickSide: "RED", roles }));
      assert.equal(snapshot.draft.firstPickSide, "RED");
      assert.equal(snapshot.roles[teamA.team_id].TOP, reversed[0]);
      assert.equal(snapshot.roleSource, "USER_ASSIGNED");
      assert.equal(codes(input({ selections, firstPickSide: "BLUE", roles })).includes("DRAFT_INVALID"), true);
    });

    await t.test("fearless: a champion from an earlier game cannot be assigned", () => {
      const first = draft("BLUE", "old");
      const games = completeFearlessGame([], { blue_team_id: teamA.team_id, red_team_id: teamB.team_id, selections: first });
      assert.equal(games.length, 1);
      const selections = draft("BLUE", "champ", games.flatMap((g) => g.selections.filter((s) => s.kind === "PICK").map((s) => s.champion_id)));
      const roles = rolesFor(selections);
      const snapshot = ready(input({ games, selections, roles }));
      assert.equal(snapshot.draft.games.length, 1);
      const stale = rolesFor(selections); stale[teamA.team_id].TOP = picksOf(first, "BLUE")[0];
      assert.deepEqual(codes(input({ games, selections, roles: stale })), ["ROLE_NOT_TEAM_PICK"]);
    });

    await t.test("snapshot is a detached, frozen copy with basis and evidence scope", () => {
      const value = input();
      const snapshot = ready(value);
      value.selections[6].champion_id = "mutated";
      value.roles[teamA.team_id].TOP = "mutated";
      value.roster.rosters[teamA.team_id].TOP = null;
      assert.equal(snapshot.draft.selections[6].champion_id, "champ6");
      assert.notEqual(snapshot.roles[teamA.team_id].TOP, "mutated");
      assert.ok(snapshot.draft.roster.teams[teamA.team_id].TOP);
      assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.roles[teamA.team_id]) && Object.isFrozen(snapshot.draft.selections[0]));
      assert.throws(() => { "use strict"; snapshot.roles[teamA.team_id].TOP = "x"; });
      assert.equal(snapshot.rosterEvidenceScope, "CURRENT_REPORT_PLAYER_OBSERVATIONS");
      assert.equal(snapshot.patch, report.patch_id);
      assert.equal(snapshot.cutoff, report.cutoff);
      assert.deepEqual(snapshot.sourceVersions, R.rosterBasis(report).source_versions);
    });

    await t.test("input identity: same vs. different (roster slot, role, side)", () => {
      const a = ready(input());
      assert.equal(S.sameSimulationInput(a, ready(input())), true);
      const roster = fullRoster(); roster.rosters[teamA.team_id].TOP = { source_team_id: players[12].source_team_id, player_id: players[12].player_id };
      assert.equal(S.sameSimulationInput(a, ready(input({ roster }))), false);
      const roles = rolesFor(draft()); [roles[teamA.team_id].TOP, roles[teamA.team_id].MID] = [roles[teamA.team_id].MID, roles[teamA.team_id].TOP];
      assert.equal(S.sameSimulationInput(a, ready(input({ roles }))), false);
    });

    await t.test("previous-game side ownership is part of input identity and replay consistency", () => {
      const previous = (side) => ({ blue_team_id: teamA.team_id, red_team_id: teamB.team_id, selections: draft(side, "prior") });
      const a = ready(input({ games: [previous("BLUE")] }));
      const b = ready(input({ games: [previous("RED")] }));
      assert.equal(S.sameSimulationInput(a, b), false, "same champion order with reversed ownership is a different prior game");
      const saved = S.serializeManagerScenario(report, a);
      assert.equal(saved.ok, true);
      const changed = JSON.parse(saved.text);
      changed.input.previous_games = [previous("RED")];
      const replay = S.replayManagerScenario(JSON.stringify(changed));
      assert.equal(replay.ok, false);
      assert.match(replay.message, /준비 결과/);
    });

    const snapshot = ready(input());
    const exported = S.serializeManagerScenario(report, snapshot);
    assert.equal(exported.ok, true);
    const file = JSON.parse(exported.text);

    await t.test("export: schema 1, one report, no outcome fields; replay reproduces the same input", () => {
      assert.equal(file.artifact_type, "manager-scenario");
      assert.equal(file.schema_version, 1);
      assert.equal(file.input.roster.evidence_scope, "CURRENT_REPORT_PLAYER_OBSERVATIONS");
      assert.equal(file.readiness.outcome_computed, false);
      assert.equal(file.readiness.season_history_included, false);
      assert.equal(exported.text.split('"opponent_prep"').length - 1, 1, "report embedded exactly once");
      assert.doesNotMatch(exported.text, /"winner"|win_probability/);
      const replay = S.replayManagerScenario(exported.text);
      assert.equal(replay.ok, true, replay.message);
      assert.equal(S.sameSimulationInput(replay.snapshot, snapshot), true);
      const otherReport = structuredClone(report); otherReport.cutoff = "2000-01-01T00:00:00Z";
      assert.equal(S.serializeManagerScenario(otherReport, snapshot).ok, false);
    });

    await t.test("replay rejects tampering, unknown versions and rule violations", () => {
      const reject = (mutate, label) => {
        const copy = structuredClone(file); mutate(copy);
        const result = S.replayManagerScenario(JSON.stringify(copy));
        assert.equal(result.ok, false, label);
        return result.message;
      };
      assert.match(reject((f) => { f.schema_version = 2; }, "future"), /버전/);
      assert.match(reject((f) => { f.schema_version = "1"; }, "string version"), /버전/);
      reject((f) => { f.artifact_type = "assumption-manager-run"; }, "type");
      reject((f) => { f.winner = f.input.blue_team.team_id; }, "extra outcome field");
      reject((f) => { f.input.winner = "x"; }, "extra input field");
      reject((f) => { f.readiness.input_fingerprint = "0000000000000000"; }, "tampered readiness");
      reject((f) => { f.readiness.outcome_computed = true; }, "tampered readiness flag");
      // A legal but different input with the old readiness record is reported as tampering.
      assert.match(reject((f) => { const r = f.input.champion_roles[teamA.team_id]; [r.TOP, r.MID] = [r.MID, r.TOP]; }, "swapped roles"), /준비 결과/);
      reject((f) => { f.input.champion_roles[teamA.team_id].TOP = f.input.champion_roles[teamA.team_id].MID; }, "duplicate role champion");
      reject((f) => { f.input.champion_roles[teamA.team_id].TOP = S.teamPicks(f.input.selections, "RED")[0]; }, "other team champion");
      reject((f) => { f.input.roster.rosters[teamA.team_id].TOP.player_id = "ghost-id"; }, "unknown player");
      reject((f) => { f.input.roster.rosters[teamB.team_id].TOP = { ...f.input.roster.rosters[teamA.team_id].TOP }; }, "duplicate player");
      reject((f) => { f.input.roster.rosters[teamA.team_id].TOP.player_name = "Renamed"; }, "renamed player");
      reject((f) => { f.input.roster.basis.cutoff = "x"; }, "basis");
      reject((f) => { f.input.roster.evidence_scope = "SEASON_HISTORY"; }, "scope");
      reject((f) => { f.input.blue_team.team_id = report.opponent_prep.teams[2].team_id; }, "other team");
      reject((f) => { f.input.blue_team.team_name = "Spoofed"; }, "team name");
      reject((f) => { f.input.selections.pop(); }, "incomplete draft");
      reject((f) => { f.input.first_pick_side = "RED"; }, "first selection");
      reject((f) => { f.patch_id = "0.0"; }, "patch");
      reject((f) => { f.evidence.source_versions = []; }, "sources");
      reject((f) => { f.analysis_snapshot.cutoff = "x"; }, "report edit");
      assert.equal(S.replayManagerScenario("{").ok, false);
      assert.equal(S.replayManagerScenario("x".repeat(S.MAX_MANAGER_SCENARIO_BYTES + 1)).ok, false);
    });

    await t.test("file entry: oversize by metadata, read failure and bad content never throw", async () => {
      let read = false;
      const big = await S.replayManagerScenarioFile({ size: S.MAX_MANAGER_SCENARIO_BYTES + 1, text: async () => { read = true; return ""; } });
      assert.equal(big.ok, false); assert.equal(read, false);
      assert.equal((await S.replayManagerScenarioFile({ size: 10, text: async () => { throw new Error("io"); } })).ok, false);
      assert.equal((await S.replayManagerScenarioFile({ size: 4, text: async () => "null" })).ok, false);
      assert.equal((await S.replayManagerScenarioFile({ size: exported.bytes, text: async () => exported.text })).ok, true);
    });

    await t.test("panel: collapsed, incomplete notice, boundary copy and no winner", () => {
      const nameOf = (id) => id;
      const html = renderToStaticMarkup(createElement(SimulationReadinessPanel, { report, blueTeam: teamA, redTeam: teamB,
        selections: draft().slice(0, 4), games: [], firstPickSide: "BLUE", roster: fullRoster(), nameOf }));
      assert.match(html, /^<details class="simulation-readiness"/);
      assert.doesNotMatch(html, /<details[^>]* open/);
      assert.match(html, /시뮬레이션 입력 준비/);
      assert.match(html, /현재 4\/20개/);
      assert.match(html, /역할은 사용자 배정/);
      assert.match(html, /선수 근거는 현재 관측이며 연간 자료는 포함하지 않습니다/);
      assert.match(html, /학습된 선수\/챔피언 효과·상성·룬·아이템·실제 승률은 아직 계산하지 않습니다/);
      const done = renderToStaticMarkup(createElement(SimulationReadinessPanel, { report, blueTeam: teamA, redTeam: teamB,
        selections: draft(), games: [], firstPickSide: "BLUE", roster: fullRoster(), nameOf }));
      assert.equal((done.match(/<select/g) ?? []).length, 10);
      assert.match(done, /챔피언을 배정하세요/, "no role is pre-filled from pick order");
      assert.doesNotMatch(done, /승리|승자|winner/i);
    });
  } finally {
    await vite.close();
  }
});
