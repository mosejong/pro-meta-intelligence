import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Independent before/after policy capture: explanation work must not change actual choices.
const [mode, path] = process.argv.slice(2);
if (!["--write", "--compare"].includes(mode) || !path) throw new Error("Usage: snapshot-solo-policy.mjs --write|--compare <file>");
const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
try {
  const A = await vite.ssrLoadModule("/app/draft-agent.ts");
  const { suggestSoloDraftTurn } = await vite.ssrLoadModule("/app/solo-draft.ts");
  const { parsePlayerSeasonHistory } = await vite.ssrLoadModule("/app/player-season-history.ts");
  const { rosterBasis } = await vite.ssrLoadModule("/app/roster-scenario.ts");
  const seasonText = await readFile(new URL("../public/history/player-season-2026.json", import.meta.url), "utf8");
  const hashes = { season: createHash("sha256").update(seasonText.replaceAll("\r\n", "\n")).digest("hex") };
  const rows = [];
  for (const [snapshot, file] of [["CURRENT", "../public/feed/current.json"], ["FROZEN_20261114", "../tests/fixtures/eligible-feed-20261114.json"]]) {
    const text = await readFile(new URL(file, import.meta.url), "utf8"), report = JSON.parse(text);
    hashes[snapshot] = createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex");
    const parsed = parsePlayerSeasonHistory(seasonText, { basis: rosterBasis(report), season: 2026 });
    const seasonHistory = parsed.ok ? parsed.value : null;
    const blueTeam = report.opponent_prep.teams.find(t => t.team_name === "T1");
    for (const team of ["Karmine Corp", "Top Esports", "Invictus Gaming", "Gen.G", "LYON", "Dplus Kia", "Bilibili Gaming"]) for (const firstPickSide of ["BLUE", "RED"]) {
      const redTeam = report.opponent_prep.teams.find(t => t.team_name === team);
      assert.ok(blueTeam && redTeam);
      let games = [];
      for (let game = 1; game <= 3; game++) {
        const previousPicks = A.fearlessLocks(games); let selections = [];
        for (let step = 1; step <= 20; step++) {
          const turn = A.nextDraftTurn(selections, firstPickSide);
          const choice = suggestSoloDraftTurn({ report, blueTeam, redTeam, selections, previousPicks, firstPickSide, manualSide: turn.side === "BLUE" ? "RED" : "BLUE", seasonHistory });
          assert.ok(choice);
          rows.push({ snapshot, team, firstPickSide, game, step, choice });
          selections = A.applyDraftSelection(selections, choice.champion_id, previousPicks, firstPickSide);
          assert.equal(selections.length, step);
        }
        games = A.completeFearlessGame(games, { blue_team_id: blueTeam.team_id, red_team_id: redTeam.team_id, selections });
      }
    }
  }
  const result = { boundary: "Deterministic practice policy identity, not prediction quality", hashes, rows };
  if (mode === "--write") await writeFile(path, JSON.stringify(result, null, 2));
  else {
    const before = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(hashes, before.hashes, "Input data changed; this comparison is not valid");
    assert.equal(rows.length, before.rows.length);
    for (let i = 0; i < rows.length; i++) assert.deepEqual(rows[i], before.rows[i], `Policy changed at row ${i}`);
  }
  console.log(`${mode === "--write" ? "Captured" : "Matched"} ${rows.length} practice decisions across ${rows.length / 20} games`);
} finally { await vite.close(); }
