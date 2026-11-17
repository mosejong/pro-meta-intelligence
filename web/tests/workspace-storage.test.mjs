import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let vite, storage;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  storage = await vite.ssrLoadModule("/app/workspace-storage.ts");
});
after(async () => { delete globalThis.window; await vite?.close(); });

test("preferences remain optional when storage methods or the getter are denied", () => {
  const denied = () => { throw new Error("denied"); };
  for (const value of [{ localStorage: { getItem: denied, setItem: denied, removeItem: denied } },
    Object.defineProperty({}, "localStorage", { get: denied })]) {
    globalThis.window = value;
    assert.equal(storage.readWorkspacePreference("team"), null);
    assert.equal(storage.writeWorkspacePreference("team", "id"), false);
    assert.equal(storage.writeWorkspacePreference("team", null), false);
  }
});

test("available storage still reads, writes and removes preferences", () => {
  const data = new Map();
  globalThis.window = { localStorage: {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  } };
  assert.equal(storage.writeWorkspacePreference("team", "id"), true);
  assert.equal(storage.readWorkspacePreference("team"), "id");
  assert.equal(storage.writeWorkspacePreference("team", null), true);
  assert.equal(storage.readWorkspacePreference("team"), null);
});
