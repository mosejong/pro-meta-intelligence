import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

test("actual HTTP server restart keeps seats and action deduplication without renewing expiry", async () => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  const dir = await mkdtemp(join(tmpdir(), "pmi-room-http-review-"));
  let app;
  try {
    const { createDraftRoomServer } = await vite.ssrLoadModule("/server/draft-room-http.ts");
    const { createFileRoomPersistence } = await vite.ssrLoadModule("/server/draft-room-persistence.ts");
    const { createDraftShareUrl } = await vite.ssrLoadModule("/app/draft-share.ts");
    const report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
    const stateFile = join(dir, "rooms.json");
    const options = { report, allowedOrigins: ["https://example.test"], persistence: createFileRoomPersistence(stateFile) };
    async function start() {
      app = createDraftRoomServer(options);
      await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(0, "127.0.0.1", resolve); });
      return `http://127.0.0.1:${app.server.address().port}`;
    }
    async function stop() {
      if (!app) return;
      app.closeStreams(); app.server.closeAllConnections();
      await new Promise(resolve => app.server.close(resolve)); app = undefined;
    }
    const post = async (base, path, data, token) => {
      const response = await fetch(base + path, { method: "POST", headers: { Origin: "https://example.test", "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data) });
      return { status: response.status, body: await response.json() };
    };
    let base = await start();
    const [blue, red] = report.opponent_prep.teams;
    const share = new URL(createDraftShareUrl("https://example.test/", { report, blueTeamId: blue.team_id, redTeamId: red.team_id,
      firstPickSide: "BLUE", selections: [], games: [], stagedChampion: null })).hash;
    const host = await post(base, "/v1/rooms", { share });
    assert.equal(host.status, 201);
    const path = `/v1/rooms/${host.body.id}`;
    const guest = await post(base, path + "/join", { invite: host.body.invite });
    assert.equal(guest.status, 200);
    const action = { id: "review-restart-action-001", revision: 1, kind: "SELECT", championId: "Ahri" };
    const picked = await post(base, path + "/actions", action, host.body.token);
    assert.equal(picked.status, 200);
    await stop(); base = await start();
    assert.equal((await (await fetch(base + "/health")).json()).storage, "file");
    for (const [token, role] of [[host.body.token, "BLUE"], [guest.body.token, "RED"], [host.body.view, "SPECTATOR"]]) {
      const response = await fetch(base + path, { headers: { Origin: "https://example.test", Authorization: `Bearer ${token}` } });
      assert.equal(response.status, 200);
      const restored = await response.json();
      assert.equal(restored.role, role);
      assert.deepEqual(restored.snapshot, picked.body.snapshot);
      assert.equal(JSON.stringify(restored.snapshot).includes(token), false);
    }
    assert.equal((await post(base, path + "/actions", action, host.body.token)).body.snapshot.revision, 2);
    assert.equal((await post(base, path + "/actions", { ...action, championId: "Lux" }, host.body.token)).status, 409);
    assert.equal((await post(base, path + "/actions", { ...action, id: "review-spectator-action" }, host.body.view)).status, 403);
    assert.equal((await post(base, path + "/join", { invite: host.body.invite })).status, 409);
    assert.equal((await fetch(base + path, { headers: { Origin: "https://example.test", Authorization: "Bearer invalid" } })).status, 401);
    await stop();
  } finally {
    if (app) { app.closeStreams(); app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); }
    await vite.close();
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    await rm(dir, { recursive: true, force: true });
  }
});
