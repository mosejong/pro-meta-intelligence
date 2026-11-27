import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { createServer } from "vite";

// #164 P2 launch prep: trusted-proxy create limit (C1), feed reload for new rooms only (C3),
// and the client's same-patch / other-patch handling of a pinned room.
let vite, http, store, feed, client, panel, share, report, setup;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  http = await vite.ssrLoadModule("/server/draft-room-http.ts");
  store = await vite.ssrLoadModule("/server/draft-room-store.ts");
  feed = await vite.ssrLoadModule("/server/draft-room-feed.ts");
  client = await vite.ssrLoadModule("/app/draft-room-client.ts");
  panel = await vite.ssrLoadModule("/app/draft-room-panel.tsx");
  share = await vite.ssrLoadModule("/app/draft-share.ts");
  report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  const [blue, red] = report.opponent_prep.teams;
  setup = { share: new URL(share.createDraftShareUrl("https://example.test/", { report, blueTeamId: blue.team_id, redTeamId: red.team_id, selections: [], games: [], stagedChampion: null, firstPickSide: "BLUE" })).hash };
});
after(async () => { await vite?.close(); });

const peer = (address, forwarded) => ({ socket: { remoteAddress: address }, headers: forwarded === undefined ? {} : { "x-forwarded-for": forwarded } });

test("C1: X-Forwarded-For is ignored unless the socket is an explicitly trusted proxy", () => {
  const none = new Set(), proxy = new Set(["10.0.0.5"]);
  assert.equal(http.clientAddress(peer("203.0.113.7", "198.51.100.1"), none), "203.0.113.7", "untrusted peer cannot forge its address");
  assert.equal(http.clientAddress(peer("203.0.113.7", "198.51.100.1"), proxy), "203.0.113.7", "only the listed proxy is trusted");
  assert.equal(http.clientAddress(peer("10.0.0.5", "198.51.100.1"), proxy), "198.51.100.1");
  assert.equal(http.clientAddress(peer("::ffff:10.0.0.5", "198.51.100.1"), proxy), "198.51.100.1", "IPv4-mapped proxy address");
  // A client-supplied first hop is skipped: the right-most hop the proxy itself appended wins.
  assert.equal(http.clientAddress(peer("10.0.0.5", "1.2.3.4, 198.51.100.1"), proxy), "198.51.100.1");
  assert.equal(http.clientAddress(peer("10.0.0.5", "198.51.100.1, 10.0.0.5"), proxy), "198.51.100.1", "chained trusted proxies are skipped");
  assert.equal(http.clientAddress(peer("10.0.0.5", "not-an-ip"), proxy), "10.0.0.5", "malformed hop falls back to the shared proxy bucket");
  assert.equal(http.clientAddress(peer("10.0.0.5"), proxy), "10.0.0.5");
  assert.throws(() => http.createDraftRoomServer({ report, allowedOrigins: ["https://example.test"], trustedProxies: ["proxy.internal"] }), /exact IP/);
});

async function withServer(options, run) {
  const app = http.createDraftRoomServer({ report, allowedOrigins: ["https://example.test"], maxCreatesPerHour: 2, ...options });
  await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(0, "127.0.0.1", resolve); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try { await run(base, app); }
  finally { app.closeStreams(); app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); }
}
const create = (base, forwarded) => fetch(base + "/v1/rooms", { method: "POST", headers: { Origin: "https://example.test", "Content-Type": "application/json", ...(forwarded ? { "X-Forwarded-For": forwarded } : {}) }, body: JSON.stringify(setup) });

test("C1 over HTTP: forged headers cannot reset the limit; behind a trusted proxy users get their own buckets", async () => {
  await withServer({}, async base => {
    assert.equal((await create(base, "198.51.100.1")).status, 201);
    assert.equal((await create(base, "198.51.100.2")).status, 201);
    assert.equal((await create(base, "198.51.100.3")).status, 429, "a new forged address does not bypass the limit");
  });
  await withServer({ trustedProxies: ["127.0.0.1"] }, async base => {
    for (let i = 0; i < 2; i++) assert.equal((await create(base, "198.51.100.1")).status, 201);
    assert.equal((await create(base, "198.51.100.1")).status, 429, "same user is limited");
    assert.equal((await create(base, "198.51.100.2")).status, 201, "another user behind the proxy is not");
    assert.equal((await create(base, "198.51.100.2, 198.51.100.1")).status, 429, "prepending a fake hop does not escape the user's bucket");
  });
});

test("C3: a reload serves new rooms the new feed while live rooms keep their own data", async () => {
  await withServer({}, async (base, app) => {
    const first = await (await create(base)).json();
    const newer = { ...structuredClone(report), cutoff: new Date(Date.parse(report.cutoff) + 3_600_000).toISOString() };
    assert.equal(feed.reloadFeed(app.store, () => JSON.stringify(newer)), "UPDATED");
    assert.equal(feed.reloadFeed(app.store, () => JSON.stringify(newer)), "UNCHANGED");
    const again = await fetch(`${base}/v1/rooms/${first.id}`, { headers: { Origin: "https://example.test", Authorization: `Bearer ${first.token}` } });
    assert.equal((await again.json()).snapshot.cutoff, report.cutoff, "the live room is pinned");
    const second = await (await create(base)).json();
    assert.equal(second.snapshot.cutoff, newer.cutoff, "a new room uses the refreshed feed");
    // Failures keep the last valid report.
    assert.equal(feed.reloadFeed(app.store, () => { throw new Error("EACCES"); }), "READ_FAILED");
    assert.equal(feed.reloadFeed(app.store, () => "{not json"), "INVALID_JSON");
    assert.equal(feed.reloadFeed(app.store, () => JSON.stringify({ patch_id: "x" })), "INVALID_REPORT");
    assert.deepEqual(app.store.feed, { patch_id: newer.patch_id, cutoff: newer.cutoff });
  });
});

test("C3: reload is refused with a persistence file, and the interval setting is validated", () => {
  const persisted = new store.DraftRoomStore(report, { persistence: { load: () => null, save: () => {} } });
  assert.throws(() => persisted.replaceReport(report), /persistence/);
  assert.equal(feed.feedReloadSeconds(undefined), null);
  assert.equal(feed.feedReloadSeconds(""), null);
  assert.equal(feed.feedReloadSeconds("300"), 300);
  for (const bad of ["59", "1.5", "abc", "-60"]) assert.throws(() => feed.feedReloadSeconds(bad), /at least 60/);
});

test("C3 client: snapshots are validated strictly on one report; the room basis note explains a pinned room", async () => {
  const { DRAFT_MODEL_VERSION } = await vite.ssrLoadModule("/app/draft-agent.ts");
  const [blue, red] = report.opponent_prep.teams;
  const room = { id: "a".repeat(22), revision: 0, patch_id: report.patch_id, cutoff: report.cutoff, model_version: DRAFT_MODEL_VERSION,
    blueTeamId: blue.team_id, redTeamId: red.team_id, firstPickSide: "BLUE", selections: [], games: [], seats: { BLUE: true, RED: false }, status: "WAITING", expiresAt: "2026-12-01T00:00:00.000Z" };
  assert.equal(client.validateRoomSnapshot(room, report).session.report.cutoff, report.cutoff);
  // No loose acceptance: another cutoff or patch never validates against this report.
  assert.throws(() => client.validateRoomSnapshot({ ...room, cutoff: "2026-11-20T00:00:00.000Z" }, report));
  assert.throws(() => client.validateRoomSnapshot({ ...room, patch_id: "99.99" }, report));
  assert.equal(panel.roomCutoffLabel("2026-11-27T00:40:40Z"), "11/27 09:40");
  assert.match(panel.roomBasisNote("2026-11-20T00:00:00Z", "2026-11-27T00:00:00Z"), /방을 만든 시점 자료로 밴픽·분석을 끝까지/);
  assert.match(panel.roomBasisNote("2026-11-28T00:00:00Z", "2026-11-27T00:00:00Z"), /새로고침/);
  assert.equal(panel.roomBasisNote(report.cutoff, report.cutoff), "");
});

const memoryStore = () => { const values = new Map(); return { get warning() { return false; }, get: id => values.get(id) ?? null, set: c => values.set(c.id, c), delete: id => values.delete(id) }; };
const until = async (check, ms = 5000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error("timed out"); await new Promise(r => setTimeout(r, 10)); } };

test("C3 end to end: room A, reload B, new room B, then a B screen joins room A and its board uses A's report", async () => {
  const reportA = structuredClone(report);
  const reportB = { ...structuredClone(report), cutoff: new Date(Date.parse(report.cutoff) + 3_600_000).toISOString() };
  await withServer({ maxCreatesPerHour: 10 }, async (base, app) => {
    const roomA = await (await create(base)).json();
    assert.equal(feed.reloadFeed(app.store, () => JSON.stringify(reportB)), "UPDATED");
    assert.equal(feed.reloadFeed(app.store, () => "{broken"), "INVALID_JSON");
    const roomB = await (await create(base)).json();
    assert.equal(roomB.snapshot.cutoff, reportB.cutoff);
    // The room report is participant-only and pinned per room.
    assert.equal((await fetch(`${base}/v1/rooms/${roomA.id}/report`, { headers: { Origin: "https://example.test" } })).status, 401);
    const pinnedA = await (await fetch(`${base}/v1/rooms/${roomA.id}/report`, { headers: { Origin: "https://example.test", Authorization: `Bearer ${roomA.view}` } })).json();
    assert.equal(pinnedA.cutoff, reportA.cutoff);
    const pinnedB = await (await fetch(`${base}/v1/rooms/${roomB.id}/report`, { headers: { Origin: "https://example.test", Authorization: `Bearer ${roomB.token}` } })).json();
    assert.equal(pinnedB.cutoff, reportB.cutoff);

    // A screen already on report B joins room A as red: validation and the board use A.
    const sessions = [], states = [];
    const request = (url, init = {}) => fetch(url, { ...init, headers: { ...(init.headers ?? {}), Origin: "https://example.test" } });
    const joiner = new client.DraftRoomClient(base, () => reportB, s => states.push(s), session => sessions.push(session), memoryStore(), request);
    await joiner.enter({ v: 1, id: roomA.id, invite: roomA.invite });
    await until(() => sessions.length > 0);
    assert.equal(sessions[0].report.cutoff, reportA.cutoff, "board/analysis report is the room's A report");
    assert.equal(states.at(-1).snapshot.cutoff, reportA.cutoff);
    assert.ok(!states.some(s => s.ended), "joining a pinned room does not end it");
    // The same screen joining room B (its own report) needs no extra report.
    const joinerB = new client.DraftRoomClient(base, () => reportB, () => {}, session => sessions.push(session), memoryStore(), request);
    await joinerB.enter({ v: 1, id: roomB.id, view: roomB.view });
    await until(() => sessions.length > 1);
    assert.equal(sessions.at(-1).report.cutoff, reportB.cutoff);
    joiner.leave(); joinerB.leave();
  });
});

test("C3: a room whose report cannot be loaded ends with an explanation instead of using this screen's report", async () => {
  const [blue, red] = report.opponent_prep.teams;
  const { DRAFT_MODEL_VERSION } = await vite.ssrLoadModule("/app/draft-agent.ts");
  const snapshot = { id: "a".repeat(22), revision: 1, patch_id: report.patch_id, cutoff: "2026-11-20T00:00:00.000Z", model_version: DRAFT_MODEL_VERSION,
    blueTeamId: blue.team_id, redTeamId: red.team_id, firstPickSide: "BLUE", selections: [], games: [], seats: { BLUE: true, RED: true }, status: "DRAFTING", expiresAt: "2026-12-01T00:00:00.000Z" };
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  const states = [], sessions = [];
  // The server answers the join but returns a report for another cutoff: never accepted.
  const fake = async url => url.endsWith("/join") ? json({ id: snapshot.id, role: "RED", token: "t".repeat(32), snapshot })
    : url.endsWith("/report") ? json({ ...report }) : json({ error: { code: "NOT_FOUND" } }, 404);
  const room = new client.DraftRoomClient("https://rooms.example", () => report, s => states.push(s), s => sessions.push(s), memoryStore(), fake);
  await room.enter({ v: 1, id: snapshot.id, invite: "i".repeat(32) });
  assert.equal(sessions.length, 0, "nothing is applied with the wrong report");
  assert.match(states.at(-1).message, /자료를 불러오지 못했어요/);
  room.leave();
});

test("C2: the room address from the build is used only when it is a safe https (or local) URL", () => {
  for (const unset of [undefined, "", "   ", "ftp://rooms.example", "http://rooms.example", "https://user:pw@rooms.example", "https://rooms.example/?k=1", "https://rooms.example/#x", "not a url"])
    assert.equal(panel.draftRoomEndpoint(unset), "", String(unset));
  assert.equal(panel.draftRoomEndpoint(" https://rooms.example/api/ "), "https://rooms.example/api");
  assert.equal(panel.draftRoomEndpoint("http://127.0.0.1:4271"), "http://127.0.0.1:4271");
});
