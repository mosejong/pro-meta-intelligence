import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("end-of-draft evidence report", async (t) => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { buildDraftResultReport: build } = await vite.ssrLoadModule("/app/draft-result-report.ts");
    const { applyDraftSelection } = await vite.ssrLoadModule("/app/draft-agent.ts");
    const { sampleReport } = await vite.ssrLoadModule("/app/sample-report.ts");
    const ids = ["Aatrox", "Ahri", "Akali", "Alistar", "Amumu", "Anivia", "Wukong", "Kai'Sa", "Ashe", "Azir",
      "Bard", "Braum", "Brand", "Caitlyn", "Camille", "Corki", "Darius", "Diana", "Draven", "Ekko"];
    const row = (champion_id, game_count, role, ...evidence_event_ids) => ({ champion_id, game_count, role, evidence_event_ids });
    function fixture(firstPickSide = "BLUE") {
      const report = structuredClone(sampleReport);
      const [blueTeam, redTeam] = report.opponent_prep.teams;
      blueTeam.game_count = redTeam.game_count = 20;
      blueTeam.priority_picks = [row("Wukong", 4, "JUNGLE", "own-max"), row("MonkeyKing", 2, "TOP", "own-low"),
        row("Wukong", 4, "JUNGLE", "own-max"), row("Ahri", 9, "MID", "own-ahri"),
        row("Kai'Sa", 8, "BOTTOM", "own-kaisa"), row("Garen", 7, "TOP", "own-garen"),
        row("Gnar", 7, "TOP", "own-gnar"), row("Gwen", 6, "TOP", "own-gwen"), row("Zed", 20, "MID", "locked")];
      redTeam.priority_picks = [row("MonkeyKing", 3, "TOP", "opp-monkey"), row("Aatrox", 5, "TOP", "opp-aatrox"),
        row("Ahri", 6, "MID", "opp-ahri"), row("Azir", 0, "MID", "opp-zero")];
      let selections = [];
      for (const id of ids) selections = applyDraftSelection(selections, id, [], firstPickSide);
      return { report, blueTeam, redTeam, selections, previousPicks: ["Zed"], firstPickSide };
    }
    await t.test("counts, provenance, actual actions, nulls and missed dispositions", () => {
      const input = fixture(), result = build(input);
      assert.equal(result.status, "READY");
      const [blue, red] = result.sides;
      assert.equal(blue.game_count, 20);
      assert.equal(blue.picks.length, 5);
      assert.equal(red.picks.length, 5);
      assert.deepEqual(blue.picks[0], { champion_id: "MonkeyKing", own_games: 4, opponent_games: 3,
        roles: ["JUNGLE", "TOP"], evidence_ids: ["opp-monkey", "own-max"] });
      assert.deepEqual(blue.picks[1], { champion_id: "Azir", own_games: null, opponent_games: 0, roles: [], evidence_ids: ["opp-zero"] });
      assert.deepEqual(blue.target_bans, [{ champion_id: "Aatrox", opponent_games: 5, evidence_ids: ["opp-aatrox"] }]);
      assert.deepEqual(blue.contested_claims, [{ champion_id: "MonkeyKing", own_games: 4, opponent_games: 3, evidence_ids: ["opp-monkey", "own-max"] }]);
      assert.deepEqual(blue.missed_priorities, [
        { champion_id: "Ahri", game_count: 9, disposition: "BANNED", evidence_ids: ["own-ahri"] },
        { champion_id: "Kaisa", game_count: 8, disposition: "OPPONENT_PICKED", evidence_ids: ["own-kaisa"] },
        { champion_id: "Garen", game_count: 7, disposition: "OPEN", evidence_ids: ["own-garen"] },
      ]);
      assert.match(result.boundary, /maximum observed row count/);
      assert.equal(/"(?:winner|score|win_rate|winrate)"/.test(JSON.stringify(result)), false);
    });
    await t.test("summary order and duplicate evidence cannot change results; no mutations or escaping references", () => {
      const input = fixture(), before = structuredClone(input), expected = build(input);
      assert.deepEqual(input, before);
      for (const team of input.report.opponent_prep.teams.slice(0, 2)) {
        team.priority_picks.reverse();
        for (const r of team.priority_picks) r.evidence_event_ids.push(...r.evidence_event_ids);
      }
      assert.deepEqual(build(input), expected);
      expected.sides[0].picks[0].roles.push("INVENTED");
      expected.sides[0].picks[0].evidence_ids.push("mutated");
      assert.deepEqual(build(before), build(input));
    });
    await t.test("reject illegal replay, duplicates, unknown champions and fearless aliases", () => {
      for (const mutate of [
        (x) => { x.selections[0].side = "RED"; },
        (x) => { x.selections[1].champion_id = "Aatrox"; },
        (x) => { x.selections[6].champion_id = "NotAChampion"; },
        (x) => { x.selections[6].phase = 2; },
        (x) => { x.selections[6].slot = 4; },
        (x) => { x.selections[6].turn = 8; },
        (x) => { x.previousPicks = ["MonkeyKing"]; },
        (x) => { x.previousPicks = ["NotAChampion"]; },
        (x) => { x.selections.push(x.selections[0]); },
        (x) => { x.blueTeam = null; },
        (x) => { x.redTeam = undefined; },
        (x) => { x.redTeam = x.blueTeam; },
        (x) => { x.blueTeam = { ...x.blueTeam, team_id: "absent" }; },
        (x) => { x.firstPickSide = "OTHER"; },
      ]) {
        const input = fixture(); mutate(input);
        assert.deepEqual({ status: build(input).status, sides: build(input).sides }, { status: "INVALID", sides: [] });
      }
    });
    await t.test("legal prefixes remain empty; invalid prefixes are invalid", () => {
      for (const length of [0, 6, 19]) {
        const input = fixture(); input.selections = input.selections.slice(0, length);
        assert.equal(build(input).status, "INCOMPLETE");
        assert.deepEqual(build(input).sides, []);
      }
      const input = fixture(); input.selections = input.selections.slice(0, 2); input.selections[1].turn = 9;
      assert.equal(build(input).status, "INVALID");
    });
    await t.test("red first pick, report-owned teams, missing summaries and invalid evidence", () => {
      const input = fixture("RED");
      assert.equal(build(input).status, "READY");
      assert.equal(build(input).sides[1].picks[0].champion_id, "MonkeyKing");
      input.blueTeam = { ...input.blueTeam, priority_picks: [], game_count: 999 };
      assert.equal(build(input).sides[0].game_count, 20);
      input.report.opponent_prep.teams[0].priority_picks = [];
      assert.ok(build(input).sides[0].picks.every((p) => p.own_games === null));
      delete input.report.opponent_prep.teams[0].priority_picks;
      assert.equal(build(input).status, "INVALID");
      const bad = fixture(); bad.blueTeam.priority_picks[0].game_count = 21;
      assert.equal(build(bad).status, "INVALID");
      const missing = fixture(); delete missing.report.opponent_prep;
      assert.deepEqual(build(missing).sides, []);
      assert.equal(build(missing).status, "INVALID");
    });
  } finally { await vite.close(); }
});
