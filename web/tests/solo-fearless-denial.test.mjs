import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createServer } from "vite";

test("seven opponents survive three Fearless sets under targeted bans without illegal choices or hidden role warnings", async () => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const A = await vite.ssrLoadModule("/app/draft-agent.ts");
    const { suggestSoloDraftTurn: suggest } = await vite.ssrLoadModule("/app/solo-draft.ts");
    const { soloRoleCandidates, canCoverRoles } = await vite.ssrLoadModule("/app/solo-role-candidates.ts");
    const { parsePlayerSeasonHistory } = await vite.ssrLoadModule("/app/player-season-history.ts");
    const { rosterBasis } = await vite.ssrLoadModule("/app/roster-scenario.ts");
    const { SHARE_CHAMPIONS } = await vite.ssrLoadModule("/app/share-champion-ids.ts");
    const report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
    // Record-path coverage: the published feed now carries patch_presence (default policy), which these
    // branch tests deliberately exclude; the presence path is covered in solo-ban-policy.test.mjs.
    delete report.patch_presence;
    const parsed = parsePlayerSeasonHistory(await readFile(new URL("../public/history/player-season-2026.json", import.meta.url), "utf8"), { basis: rosterBasis(report), season: 2026 });
    const history = parsed.ok ? parsed.value : null;
    const blueTeam = report.opponent_prep.teams.find(t => t.team_name === "T1");
    assert.ok(blueTeam);
    const rows = [];
    for (const name of ["Karmine Corp", "Top Esports", "Invictus Gaming", "Gen.G", "LYON", "Dplus Kia", "Bilibili Gaming"]) for (const firstPickSide of ["BLUE", "RED"]) {
      const redTeam = report.opponent_prep.teams.find(t => t.team_name === name); assert.ok(redTeam);
      let games = [];
      for (let game = 1; game <= 3; game++) {
        const previousPicks = A.fearlessLocks(games); let selections = [], unsupportedPicks = 0;
        const candidates = soloRoleCandidates(redTeam, report, history);
        const targeted = [...new Set([...candidates.map(c => c.champion_id), ...report.entries.filter(e => e.eligible_for_review).sort((a,b) => a.rank-b.rank).map(e => e.champion_id), ...SHARE_CHAMPIONS.map(([,id]) => id)])];
        for (let step = 1; step <= 20; step++) {
          const turn = A.nextDraftTurn(selections, firstPickSide);
          let id;
          if (turn.side === "BLUE" && turn.kind === "BAN") id = targeted.find(id => A.applyDraftSelection(selections, id, previousPicks, firstPickSide) !== selections);
          else {
            const choice = suggest({ report, blueTeam, redTeam, selections, previousPicks, firstPickSide, manualSide: turn.side === "BLUE" ? "RED" : "BLUE", seasonHistory: history });
            assert.ok(choice); id = choice.champion_id;
            if (turn.side === "RED" && turn.kind === "PICK" && choice.role_supported === false) { unsupportedPicks++; assert.match(choice.reason, /포지션 근거가 부족/); }
          }
          const next = A.applyDraftSelection(selections, id, previousPicks, firstPickSide); assert.equal(next.length, step); selections = next;
        }
        const meta = report.entries.filter(e => e.eligible_for_review).map(e => ({ champion_id: e.champion_id, roles: [e.role === "ADC" ? "BOTTOM" : e.role], score: 0, season: false }));
        const supported = canCoverRoles(selections.filter(s => s.side === "RED" && s.kind === "PICK").map(s => s.champion_id), [...candidates,...meta]);
        if (!supported) assert.ok(unsupportedPicks > 0);
        rows.push({ team: name, game, firstPickSide, roleSupported: supported, unsupportedPicks, seasonAvailable: !!history });
        games = A.completeFearlessGame(games, { blue_team_id: blueTeam.team_id, red_team_id: redTeam.team_id, selections });
        assert.equal(A.fearlessLocks(games).length, game * 10);
      }
    }
    assert.equal(rows.length, 42);
    console.log(`Targeted-ban diagnostic: ${rows.filter(r => r.roleSupported).length}/42 observed-role-supported opponent lineups`);
    if (process.env.SOLO_SERIES_REPORT) await writeFile(new URL("../../outputs/solo-fearless-targeted-bans-20261118.json", import.meta.url), JSON.stringify({ boundary: "Targeted public candidate bans; role coverage and legality only, not strategy or win prediction.", rows }, null, 2));
  } finally { await vite.close(); }
});
