import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { createServer } from "vite";

let vite, createRoomServer, share, report, setup;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  createRoomServer = (await vite.ssrLoadModule("/server/draft-room-http.ts")).createDraftRoomServer;
  share = await vite.ssrLoadModule("/app/draft-share.ts");
  report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  const [blue, red] = report.opponent_prep.teams;
  setup = { share: new URL(share.createDraftShareUrl("https://example.test/", { report, blueTeamId: blue.team_id, redTeamId: red.team_id, selections: [], games: [], stagedChampion: null, firstPickSide: "BLUE" })).hash };
});
after(async () => { await vite?.close(); });
async function withServer(run, options = {}) {
  const app = createRoomServer({ report, allowedOrigins: ["https://example.test"], ...options });
  await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(0, "127.0.0.1", resolve); });
  const endpoint = `http://127.0.0.1:${app.server.address().port}`;
  try { await run(endpoint); }
  finally { app.closeStreams(); app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); }
}
const request = (base, path, data, token) => fetch(base + path, { method: "POST", headers: { Origin: "https://example.test", "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data) });

test("actual HTTP clients receive authoritative stream updates without credential leakage", async () => {
  await withServer(async base => {
    const response = await request(base, "/v1/rooms", setup);
    assert.equal(response.status, 201);
    const host = await response.json();
    const abort = new AbortController();
    const events = await fetch(`${base}/v1/rooms/${host.id}/events`, { headers: { Origin: "https://example.test", Authorization: `Bearer ${host.token}` }, signal: abort.signal });
    assert.equal(events.status, 200);
    assert.match(events.headers.get("content-type"), /x-ndjson/);
    const reader = events.body.getReader(), decoder = new TextDecoder();
    void reader.closed.catch(() => {});
    let buffered = "";
    async function next() {
      while (!buffered.includes("\n")) {
        const value = await reader.read(); assert.equal(value.done, false);
        buffered += decoder.decode(value.value, { stream: true });
      }
      const index = buffered.indexOf("\n"), line = buffered.slice(0, index); buffered = buffered.slice(index + 1);
      return line ? JSON.parse(line) : next();
    }
    assert.equal((await next()).snapshot.revision, 0);
    const guest = await (await request(base, `/v1/rooms/${host.id}/join`, { invite: host.invite })).json();
    assert.equal((await next()).snapshot.revision, 1);
    const selected = await request(base, `/v1/rooms/${host.id}/actions`, { id: "request-http-0001", revision: 1, kind: "SELECT", championId: "Ahri" }, host.token);
    assert.equal(selected.status, 200);
    const broadcast = await next();
    assert.equal(broadcast.snapshot.selections[0].champion_id, "Ahri");
    assert.equal(broadcast.snapshot.revision, 2);
    for (const value of [host.token, guest.token, host.invite, host.view]) assert.ok(!JSON.stringify(broadcast).includes(value));
    const viewer = await (await request(base, `/v1/rooms/${host.id}/join`, { view: host.view })).json();
    assert.equal((await request(base, `/v1/rooms/${host.id}/actions`, { id: "request-http-0002", revision: 2, kind: "SELECT", championId: "Garen" }, viewer.token)).status, 403);
    assert.equal((await fetch(`${base}/v1/rooms/${host.id}/events?token=${host.token}`)).status, 400);
    abort.abort();
  });
});

test("origin restrictions, malformed JSON, byte limits and creation limits are enforced", async () => {
  await withServer(async base => {
    const denied = await fetch(base + "/v1/rooms", { method: "POST", headers: { Origin: "https://evil.test", "Content-Type": "application/json" }, body: JSON.stringify(setup) });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
    const preflight = await fetch(base + "/v1/rooms", { method: "OPTIONS", headers: { Origin: "https://example.test" } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://example.test");
    const invalid = await fetch(base + "/v1/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
    assert.equal(invalid.status, 400);
    const oversized = await request(base, "/v1/rooms", { share: "x".repeat(17_000) });
    assert.equal(oversized.status, 413);
  }, { maxCreatesPerHour: 20 });
  await withServer(async base => {
    assert.equal((await request(base, "/v1/rooms", setup)).status, 201);
    assert.equal((await request(base, "/v1/rooms", setup)).status, 429);
  }, { maxCreatesPerHour: 1 });
});
