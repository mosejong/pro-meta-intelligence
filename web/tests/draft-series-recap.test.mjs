import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("multi-game Fearless series recap", async (t) => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { buildSeriesRecap: recap } = await vite.ssrLoadModule("/app/draft-series-recap.ts");
    const { applyDraftSelection, draftSequence } = await vite.ssrLoadModule("/app/draft-agent.ts");
    const { sampleReport } = await vite.ssrLoadModule("/app/sample-report.ts");
    const { SHARE_CHAMPIONS } = await vite.ssrLoadModule("/app/share-champion-ids.ts");
    const pool = SHARE_CHAMPIONS.map(([, id]) => id);
    const [A, B, C] = sampleReport.opponent_prep.teams.map((team) => team.team_id);
    /** Builds a legal 20-turn game from `ids` (picks must avoid earlier picks; bans may repeat). */
    function play(ids, firstPickSide = "BLUE") {
      let selections = [];
      for (const id of ids) {
        const next = applyDraftSelection(selections, id, [], firstPickSide);
        assert.notEqual(next, selections, `fixture turn ${selections.length + 1} rejected ${id}`);
        selections = next;
      }
      return selections;
    }
    const game = (blue, red, ids, first) => ({ blue_team_id: blue, red_team_id: red, selections: play(ids, first) });
    const banIdx = draftSequence("BLUE").map((turn, index) => turn.kind === "BAN" ? index : -1).filter((i) => i >= 0);
    const ids1 = pool.slice(0, 20), ids2 = pool.slice(20, 40), ids3 = pool.slice(40, 60);
    // Game 2 reuses game 1's bans (legal: only picks lock in Fearless).
    for (const i of banIdx) ids2[i] = ids1[i];
    const picksOf = (ids, first = "BLUE") => draftSequence(first).flatMap((turn, i) => turn.kind === "PICK" ? [ids[i]] : []);
    const series = () => ({ report: structuredClone(sampleReport), games: [game(A, B, ids1, "BLUE"), game(B, A, ids2, "RED"), game(A, B, ids3, "BLUE")] });

    await t.test("three games accumulate pick locks; bans do not lock", () => {
      const result = recap(series());
      assert.deepEqual(result.games.map((g) => g.status), ["READY", "READY", "READY"]);
      assert.deepEqual(result.games.map((g) => g.locks_before.length), [0, 10, 20]);
      assert.deepEqual(result.games.map((g) => g.new_locks.length), [10, 10, 10]);
      assert.equal(result.total_locks.length, 30);
      assert.deepEqual(result.games[1].locks_before, result.games[0].new_locks);
      assert.deepEqual(result.games[1].sides.flatMap((s) => s.bans).sort(), result.games[0].sides.flatMap((s) => s.bans).sort());
      assert.equal(result.games.some((g) => g.current), false);
    });
    await t.test("first-pick side per game and side swap keep historic team IDs", () => {
      const result = recap(series());
      assert.deepEqual(result.games.map((g) => g.first_pick_side), ["BLUE", "RED", "BLUE"]);
      assert.deepEqual(result.games.map((g) => g.sides.map((s) => s.team_id)), [[A, B], [B, A], [A, B]]);
      assert.deepEqual(result.games.map((g) => g.sides.map((s) => s.side)), [["BLUE", "RED"], ["BLUE", "RED"], ["BLUE", "RED"]]);
      const names = new Map(sampleReport.opponent_prep.teams.map((team) => [team.team_id, team.team_name]));
      assert.equal(result.games[1].sides[0].team_name, names.get(B));
      assert.equal(result.games[1].sides[0].picks.length, 5);
    });
    await t.test("current game: incomplete excluded, complete included once and flagged", () => {
      const input = series();
      const done = input.games.pop();
      const partial = { ...done, selections: done.selections.slice(0, 19) };
      assert.equal(recap({ ...input, current: partial }).games.length, 2);
      assert.equal(recap({ ...input, current: { ...done, selections: [] } }).games.length, 2);
      const withCurrent = recap({ ...input, current: done });
      assert.equal(withCurrent.games.length, 3);
      assert.deepEqual(withCurrent.games.map((g) => g.current), [false, false, true]);
      assert.deepEqual(withCurrent, { ...recap(series()), games: recap(series()).games.map((g, i) => ({ ...g, current: i === 2 })) });
      // A current board identical to an already-finished game cannot be counted twice.
      const dup = recap({ ...series(), current: series().games[2] });
      assert.equal(dup.games.length, 4);
      assert.deepEqual({ status: dup.games[3].status, reason: dup.games[3].reason }, { status: "UNSUPPORTED", reason: "INVALID_GAME" });
      assert.equal(dup.total_locks, null);
    });
    await t.test("illegal pick reuse rejects the game and marks dependents unverified", () => {
      const input = series();
      const reused = [...ids2];
      const pickTurn = draftSequence("RED").findIndex((turn) => turn.kind === "PICK");
      reused[pickTurn] = picksOf(ids1)[0];
      input.games[1] = { blue_team_id: B, red_team_id: A, selections: play(reused, "RED") };
      const result = recap(input);
      assert.equal(result.games[0].status, "READY");
      assert.deepEqual(result.games.slice(1).map((g) => g.reason), ["INVALID_GAME", "DEPENDS_ON_UNVERIFIED"]);
      assert.equal(result.total_locks, null);
    });
    await t.test("corrupt input, unknown teams and pair changes are refused without guessing", () => {
      const cases = [
        [(x) => { x.games[0] = null; }, "INVALID_GAME"],
        [(x) => { x.games[0].selections = "nope"; }, "INVALID_GAME"],
        [(x) => { x.games[0].selections[3] = null; }, "INVALID_GAME"],
        [(x) => { x.games[0].selections[3].champion_id = "NotAChampion"; }, "INVALID_GAME"],
        [(x) => { x.games[0].selections[3].side = x.games[0].selections[3].side === "BLUE" ? "RED" : "BLUE"; }, "INVALID_GAME"],
        [(x) => { x.games[0].selections[0].side = "GREEN"; }, "INVALID_GAME"],
        [(x) => { x.games[0].selections.pop(); }, "INCOMPLETE_GAME"],
        [(x) => { x.games[0].blue_team_id = "synthetic:team:absent"; }, "UNKNOWN_TEAM"],
        [(x) => { x.games[0].red_team_id = ""; }, "UNKNOWN_TEAM"],
        [(x) => { x.games[0].red_team_id = x.games[0].blue_team_id; }, "INVALID_GAME"],
        [(x) => { x.report.opponent_prep.teams.push(structuredClone(x.report.opponent_prep.teams[0])); }, "UNKNOWN_TEAM"],
      ];
      for (const [mutate, reason] of cases) {
        const input = series(); mutate(input);
        const result = recap(input);
        assert.equal(result.games[0].reason, reason, mutate.toString());
        assert.ok(result.games.slice(1).every((g) => g.reason === "DEPENDS_ON_UNVERIFIED"));
        assert.equal(result.total_locks, null);
      }
      for (const row of [null, 7, "team", [], {}, { team_id: 3 }]) {
        const input = series(); input.report.opponent_prep.teams.push(row);
        let result;
        assert.doesNotThrow(() => { result = recap(input); });
        assert.deepEqual(result.games.map((g) => g.reason), ["INVALID_REPORT", "DEPENDS_ON_UNVERIFIED", "DEPENDS_ON_UNVERIFIED"]);
        assert.equal(result.total_locks, null);
      }
      const mismatch = series(); mismatch.games[1] = game(A, C, ids2, "RED");
      assert.equal(recap(mismatch).games[1].reason, "PAIR_MISMATCH");
      assert.deepEqual(recap({ report: sampleReport, games: "bad" }), { games: [], total_locks: null });
      assert.deepEqual(recap({ report: sampleReport, games: [] }), { games: [], total_locks: [] });
    });
    await t.test("dependent report data missing stays unverified, never zero or guessed", () => {
      const noPrep = series(); delete noPrep.report.opponent_prep;
      assert.ok(recap(noPrep).games.every((g) => g.status === "UNSUPPORTED"));
      const noSummary = series(); delete noSummary.report.opponent_prep.teams[0].priority_picks;
      assert.equal(recap(noSummary).games[0].reason, "INVALID_GAME");
      const emptySummary = series();
      for (const team of emptySummary.report.opponent_prep.teams) team.priority_picks = [];
      const result = recap(emptySummary);
      assert.ok(result.games.every((g) => g.status === "READY" && g.sides.every((s) => !s.contested_claims.length && !s.target_bans.length)));
    });
    await t.test("inputs are not mutated, output is detached and carries no prediction fields", () => {
      const input = series(); input.current = null;
      const before = structuredClone(input);
      const result = recap(input);
      assert.deepEqual(input, before);
      result.games[0].sides[0].picks.push("Invented"); result.games[0].locks_before.push("Invented");
      assert.deepEqual(input, before);
      assert.deepEqual(recap(before), recap(input));
      assert.equal(/"(?:winner|score|win_rate|winrate|probability|value|reason_text)"/.test(JSON.stringify(recap(input))), false);
    });
  } finally { await vite.close(); }
});
