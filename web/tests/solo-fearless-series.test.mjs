import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createServer } from "vite";

test("seven teams complete three continuous Fearless sets from either first side", async () => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const A = await vite.ssrLoadModule("/app/draft-agent.ts");
    const { suggestSoloDraftTurn: suggest } = await vite.ssrLoadModule("/app/solo-draft.ts");
    const { soloRoleCandidates, canCoverRoles } = await vite.ssrLoadModule("/app/solo-role-candidates.ts");
    const { parsePlayerSeasonHistory } = await vite.ssrLoadModule("/app/player-season-history.ts");
    const { rosterBasis } = await vite.ssrLoadModule("/app/roster-scenario.ts");
    const season = await readFile(new URL("../public/history/player-season-2026.json", import.meta.url), "utf8");
    const rows = [];
    for (const [snapshot, path] of [["CURRENT", "../public/feed/current.json"], ["FROZEN_20261114", "./fixtures/eligible-feed-20261114.json"]]) {
      const report = JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
      const parsed = parsePlayerSeasonHistory(season, { basis: rosterBasis(report), season: 2026 });
      const history = parsed.ok ? parsed.value : null;
      // A later companion refresh may no longer match the frozen report; withhold it too.
      const blueTeam = report.opponent_prep.teams.find(t => t.team_name === "T1");
      assert.ok(blueTeam);
      for (const name of ["Karmine Corp", "Top Esports", "Invictus Gaming", "Gen.G", "LYON", "Dplus Kia", "Bilibili Gaming"]) for (const firstPickSide of ["BLUE", "RED"]) {
        const redTeam = report.opponent_prep.teams.find(t => t.team_name === name); assert.ok(redTeam, name);
        let games = [];
        for (let game = 1; game <= 3; game++) {
          const previousPicks = A.fearlessLocks(games); let selections = []; const sources = {}; let unsupportedPicks = 0;
          for (let turn = 1; turn <= 20; turn++) {
            const next = A.nextDraftTurn(selections, firstPickSide);
            const choice = suggest({ report, blueTeam, redTeam, selections, previousPicks, firstPickSide, manualSide: next.side === "BLUE" ? "RED" : "BLUE", seasonHistory: history });
            assert.ok(choice); assert.ok(!previousPicks.includes(choice.champion_id));
            if (next.kind === "PICK" && choice.role_supported === false) { unsupportedPicks++; assert.match(choice.reason, /포지션 근거가 부족/); }
            selections = A.applyDraftSelection(selections, choice.champion_id, previousPicks, firstPickSide);
            assert.equal(selections.length, turn);
            sources[choice.source] = (sources[choice.source] ?? 0) + 1;
          }
          const roleLayoutSupported = {};
          for (const [side, team] of [["BLUE", blueTeam], ["RED", redTeam]]) {
            const candidates = soloRoleCandidates(team, report, history);
            for (const e of report.entries.filter(e => e.eligible_for_review)) candidates.push({ champion_id: e.champion_id, roles: [e.role === "ADC" ? "BOTTOM" : e.role], score: 0, season: false });
            roleLayoutSupported[side] = canCoverRoles(selections.filter(s => s.side === side && s.kind === "PICK").map(s => s.champion_id), candidates);
          }
          rows.push({ snapshot, team: name, firstPickSide, game, seasonAvailable: !!history, sources, unsupportedPicks, roleLayoutSupported });
          games = A.completeFearlessGame(games, { blue_team_id: blueTeam.team_id, red_team_id: redTeam.team_id, selections });
          assert.equal(games.length, game); assert.equal(A.fearlessLocks(games).length, game * 10);
        }
      }
    }
    assert.equal(rows.length, 84);
    const failures = rows.filter(s => !s.roleLayoutSupported.BLUE || !s.roleLayoutSupported.RED);
    const result = { boundary: "Practice legality and observed-role diagnostic, not predictive accuracy or current-patch strength. Mismatched season evidence is withheld.", game_count: rows.length, role_supported_games: rows.length - failures.length, rows };
    if (process.env.SOLO_SERIES_REPORT) await writeFile(new URL("../../outputs/solo-fearless-three-set-20261118.json", import.meta.url), JSON.stringify(result, null, 2));
    console.log(`Fearless: ${rows.length} games, ${rows.length - failures.length} with five-role evidence on both sides`);
    assert.ok(rows.filter(s => s.seasonAvailable).every(s => s.roleLayoutSupported.BLUE && s.roleLayoutSupported.RED), "Complete compatible season evidence must cover all five roles across three sets");
    assert.ok(failures.every(s => s.unsupportedPicks > 0), "Unsupported layouts must warn rather than claim role coverage");
  } finally { await vite.close(); }
});
