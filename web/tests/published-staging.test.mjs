import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

test("publication staging excludes unknown old files without removing the old directory", async () => {
  const web = fileURLToPath(new URL("../", import.meta.url));
  const root = resolve(web, ".site-public");
  const canary = resolve(root, `review-canary-${crypto.randomUUID()}.tgz`);
  const created = [];
  const vite = await createServer({ root: web, configFile: false, publicDir: false,
    server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    await mkdir(root, { recursive: true });
    await writeFile(canary, "not a publication input");
    const { preparePublishedAssets } = await vite.ssrLoadModule("/prepare-public.ts");
    const first = preparePublishedAssets(); created.push(first);
    await assert.rejects(readFile(resolve(first, basename(canary))), { code: "ENOENT" });
    await writeFile(resolve(first, "unreviewed.json"), "not a publication input");
    const second = preparePublishedAssets(); created.push(second);
    assert.notEqual(first, second);
    await assert.rejects(readFile(resolve(second, "unreviewed.json")), { code: "ENOENT" });
    assert.equal(await readFile(canary, "utf8"), "not a publication input");
    assert.deepEqual(await readFile(resolve(second, "feed/current.json")), await readFile(resolve(web, "public/feed/current.json")));
  } finally {
    await vite.close();
    assert.equal(dirname(canary), root);
    await rm(canary, { force: true });
    for (const target of created) {
      assert.equal(dirname(resolve(target)), root);
      assert.ok(basename(target).startsWith("build-"));
      await rm(target, { recursive: true, force: true });
    }
  }
});
