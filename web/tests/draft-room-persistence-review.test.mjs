import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

test("room credentials cannot use built-public folders or a junction alias of one", async (t) => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  const root = await mkdtemp(join(tmpdir(), "pmi-room-path-review-"));
  try {
    const { createFileRoomPersistence } = await vite.ssrLoadModule("/server/draft-room-persistence.ts");
    for (const folder of ["public", "dist-pages", "dist-room-pages", ".next", ".site-public", "static-site"]) {
      await t.test(folder, () => assert.throws(() => createFileRoomPersistence(join(root, folder, "state.json")),
        /PUBLIC_PATH/, `built public folder ${folder} must be refused`));
    }
    const publicDir = join(root, "public");
    const alias = join(root, "room-data");
    await mkdir(publicDir);
    await symlink(publicDir, alias, process.platform === "win32" ? "junction" : "dir");
    await t.test("junction parent", () => assert.throws(() => createFileRoomPersistence(join(alias, "state.json"), { forbiddenRoots: [publicDir] }),
      /PUBLIC_PATH|SYMLINK|INVALID_PATH/, "junction parent must not bypass the server-only boundary"));
    const servedRoot = join(root, "served-feed");
    await t.test("custom served root with dot-prefixed child", () => assert.throws(
      () => createFileRoomPersistence(join(servedRoot, "..cache", "state.json"), { forbiddenRoots: [servedRoot] }),
      /PUBLIC_PATH/, "a child named ..cache remains inside its forbidden root"));
  } finally {
    await vite.close();
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  }
});
