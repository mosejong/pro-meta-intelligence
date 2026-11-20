import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Read-only preflight. A successful Pages build alone does not prove companion compatibility.
const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
try {
  const { parsePlayerSeasonHistory } = await vite.ssrLoadModule("/app/player-season-history.ts");
  const { rosterBasis } = await vite.ssrLoadModule("/app/roster-scenario.ts");
  const report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  const text = await readFile(new URL("../public/history/player-season-2026.json", import.meta.url), "utf8");
  const result = parsePlayerSeasonHistory(text, { basis: rosterBasis(report), season: 2026 });
  console.log(JSON.stringify({ status: result.ok ? "SEASON_COMPATIBLE" : "SEASON_WITHHELD", feed_cutoff: report.cutoff,
    feed_patch: report.patch_id, season_cutoff: JSON.parse(text).cutoff, code: result.ok ? null : result.code,
    detail: result.ok ? "Season companion matches this feed. This is not a recommendation-quality or outcome-validation result." : result.error }, null, 2));
  process.exitCode = result.ok ? 0 : 2;
} finally { await vite.close(); }
