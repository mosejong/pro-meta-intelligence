import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { installSeasonCompanion } from "./season-companion-transfer.mjs";

if (!process.argv[2]) throw new Error("Usage: node scripts/install-season-companion.mjs <artifact-directory>");
const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
try {
  const { parsePlayerSeasonHistory } = await vite.ssrLoadModule("/app/player-season-history.ts");
  const { rosterBasis } = await vite.ssrLoadModule("/app/roster-scenario.ts");
  const result = await installSeasonCompanion({ inputDir: process.argv[2],
    feedPath: fileURLToPath(new URL("../public/feed/current.json", import.meta.url)),
    outputPath: fileURLToPath(new URL("../public/history/player-season-2026.json", import.meta.url)),
    validateHistory: (feed, text) => parsePlayerSeasonHistory(text, { basis: rosterBasis(feed), season: 2026 }),
  });
  console.log(JSON.stringify(result, null, 2));
} finally { await vite.close(); }
