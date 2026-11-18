import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

test("official champion names and canonical IDs resolve to case-sensitive Data Dragon assets", async () => {
  const catalog = JSON.parse(await readFile(new URL("./fixtures/champion-asset-ids-16.16.1.json", import.meta.url), "utf8"));
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const assets = await vite.ssrLoadModule("/app/champion-assets.ts");
    assert.equal(assets.DATA_DRAGON_VERSION, catalog.version);
    assert.ok(catalog.champions.length >= 170);
    for (const champion of catalog.champions) {
      assert.equal(assets.championAssetId(champion.name), champion.id, champion.name);
      assert.equal(assets.championAssetId(champion.id), champion.id, champion.id);
    }
    for (const [input, canonical] of [["Vel'Koz", "Velkoz"], ["VelKoz", "Velkoz"], ["Bel'Veth", "Belveth"], ["BelVeth", "Belveth"]]) {
      assert.equal(assets.championImageUrl(input), `https://ddragon.leagueoflegends.com/cdn/${catalog.version}/img/champion/${canonical}.png`);
      assert.equal(assets.championSplashUrl(input), `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${canonical}_0.jpg`);
    }
  } finally { await vite.close(); }
});
