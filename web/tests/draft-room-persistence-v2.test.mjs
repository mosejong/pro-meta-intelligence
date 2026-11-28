import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { createServer } from "vite";

// State v2: rooms keep their own report across feed reloads AND restarts. Fixtures A/B/C share patch and
// cutoff and differ only in the first team's name, so they can only be told apart by content hash.
// Credentials are compared with assert.ok(a === b) so a failure never prints a token.
let vite, Store, http, persistence, share, base, A, B, C, dir;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false,
    server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  Store = (await vite.ssrLoadModule("/server/draft-room-store.ts")).DraftRoomStore;
  http = await vite.ssrLoadModule("/server/draft-room-http.ts");
  persistence = await vite.ssrLoadModule("/server/draft-room-persistence.ts");
  share = await vite.ssrLoadModule("/app/draft-share.ts");
  base = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  const variant = name => { const report = structuredClone(base); report.opponent_prep.teams[0].team_name = name; return report; };
  A = variant("Fixture Team A"); B = variant("Fixture Team B"); C = variant("Fixture Team C");
  dir = await mkdtemp(join(tmpdir(), "draft-room-v2-"));
});
after(async () => { await vite?.close(); if (dir) await rm(dir, { recursive: true, force: true }); });

const T0 = Date.parse("2026-11-19T00:00:00.000Z");
const sha = report => createHash("sha256").update(JSON.stringify(report)).digest("hex");
const code = c => e => e.code === c;
const setup = report => {
  const [blue, red] = report.opponent_prep.teams;
  return { share: new URL(share.createDraftShareUrl("https://example.test/", { report, blueTeamId: blue.team_id, redTeamId: red.team_id, selections: [], games: [], stagedChampion: null, firstPickSide: "BLUE" })).hash };
};
/** In-memory backend that still goes through the real state codec (encodeState/decodeState). */
const memory = (text = null) => ({ mode: "file", text, saves: 0, failing: false,
  load() { return this.text; }, save(next) { if (this.failing) throw new Error("disk full"); this.text = next; this.saves++; } });
let counter = 0;
const file = () => join(dir, `state-${++counter}.json`);

/** Room on the store's active report: host, red guest, viewer, and a BLUE first ban (revision 2). */
function seat(store, report) {
  const host = store.create(setup(report)), guest = store.join(host.id, { invite: host.invite }), viewer = store.join(host.id, { view: host.view });
  store.act(host.id, host.token, { id: `ban-${host.id.slice(0, 8)}-0001`, revision: 1, kind: "SELECT", championId: "Ahri" });
  return { host, guest, viewer };
}
function assertRoom(store, room, report, before) {
  const read = store.read(room.host.id, room.host.token);
  assert.equal(read.role, "BLUE");
  assert.ok(read.invite === room.host.invite && read.view === room.host.view, "BLUE still gets its private invite/view keys");
  assert.equal(store.read(room.host.id, room.guest.token).role, "RED");
  assert.equal(store.read(room.host.id, room.viewer.token).role, "SPECTATOR");
  assert.throws(() => store.read(room.host.id, "x".repeat(32)), code("UNAUTHORIZED"));
  assert.equal(read.report_sha256, sha(report));
  assert.deepEqual(read.snapshot, before.snapshot, "snapshot (revision, draft, expiry) is unchanged");
  const pinned = store.roomReport(room.host.id, room.viewer.token);
  assert.equal(sha(pinned), sha(report));
  assert.equal(pinned.opponent_prep.teams[0].team_name, report.opponent_prep.teams[0].team_name);
}

test("mixed generations: A room, reload B, B room, restart on C restores both with their own report; new rooms use C", () => {
  let clock = T0;
  const backend = memory(), first = new Store(A, { persistence: backend, clock: () => clock });
  const roomA = seat(first, A);
  assert.equal(first.replaceReport(B), true);
  assert.equal(JSON.parse(backend.text).feed.sha256, sha(B), "the reload is persisted as the active report");
  const roomB = seat(first, B);
  const beforeA = first.read(roomA.host.id, roomA.viewer.token), beforeB = first.read(roomB.host.id, roomB.viewer.token);
  assert.equal(beforeA.report_sha256, sha(A)); assert.equal(beforeB.report_sha256, sha(B));
  assert.equal(beforeA.snapshot.revision, 2);
  clock += 60_000;
  const saved = backend.text, saves = backend.saves;
  const restarted = new Store(C, { persistence: backend, clock: () => clock });
  assert.equal(backend.saves, saves, "loading never writes");
  assert.equal(backend.text, saved);
  assertRoom(restarted, roomA, A, beforeA);
  assertRoom(restarted, roomB, B, beforeB);
  assert.equal(restarted.read(roomA.host.id, roomA.host.token).snapshot.expiresAt, new Date(T0 + 2 * 3600_000).toISOString(), "expiry is not extended");
  // Restored rooms stay fully usable on their own report.
  assert.equal(restarted.act(roomA.host.id, roomA.guest.token, { id: "red-ban-after-restart", revision: 2, kind: "SELECT", championId: "Garen" }).snapshot.revision, 3);
  const fresh = restarted.create(setup(C));
  assert.equal(fresh.report_sha256, sha(C), "only new rooms use the starting feed C");
  assert.deepEqual(restarted.feed, { patch_id: C.patch_id, cutoff: C.cutoff });
  const state = JSON.parse(backend.text);
  assert.equal(state.version, 2);
  assert.equal(state.feed.sha256, sha(C));
  assert.deepEqual(state.reports.map(r => r.identity.sha256).sort(), [sha(A), sha(B), sha(C)].sort(), "each report once, keyed by hash");
  assert.deepEqual(state.rooms.map(r => r.report_sha256).sort(), [sha(A), sha(B), sha(C)].sort());
  // A second restart (same feed file C) restores the same three rooms.
  const again = new Store(C, { persistence: memory(backend.text), clock: () => clock });
  assert.equal(again.read(fresh.id, fresh.token).report_sha256, sha(C));
  assert.equal(again.read(roomA.host.id, roomA.viewer.token).snapshot.revision, 3);
});

test("the stored active report is replaced by the starting feed and dropped once no room uses it", () => {
  const backend = memory(), store = new Store(A, { persistence: backend, clock: () => T0 });
  const roomA = seat(store, A);
  store.replaceReport(B);
  assert.equal(JSON.parse(backend.text).reports.length, 2);
  const restarted = new Store(C, { persistence: backend, clock: () => T0 + 1000 });
  assert.equal(restarted.create(setup(C)).report_sha256, sha(C));
  const state = JSON.parse(backend.text);
  assert.deepEqual(state.reports.map(r => r.identity.sha256).sort(), [sha(A), sha(C)].sort(), "B had no room and is no longer active");
  assert.equal(restarted.read(roomA.host.id, roomA.host.token).report_sha256, sha(A));
});

test("HTTP: restored rooms answer read and /report with their own report and hash; new rooms use C", async () => {
  const stateFile = file();
  const options = report => ({ report, allowedOrigins: ["https://example.test"], persistence: persistence.createFileRoomPersistence(stateFile) });
  const headers = token => ({ Origin: "https://example.test", ...(token ? { Authorization: `Bearer ${token}` } : {}) });
  const post = async (url, data, token) => { const r = await fetch(url, { method: "POST", headers: { ...headers(token), "Content-Type": "application/json" }, body: JSON.stringify(data) }); return { status: r.status, body: await r.json() }; };
  let app;
  const start = async report => {
    app = http.createDraftRoomServer(options(report));
    await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(0, "127.0.0.1", resolve); });
    return `http://127.0.0.1:${app.server.address().port}`;
  };
  const stop = async () => { app.closeStreams(); app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); app = undefined; };
  try {
    let url = await start(A);
    const hostA = (await post(`${url}/v1/rooms`, setup(A))).body;
    assert.equal(hostA.report_sha256, sha(A));
    const guestA = (await post(`${url}/v1/rooms/${hostA.id}/join`, { invite: hostA.invite })).body;
    assert.equal((await post(`${url}/v1/rooms/${hostA.id}/actions`, { id: "http-blue-ban-0001", revision: 1, kind: "SELECT", championId: "Ahri" }, hostA.token)).status, 200);
    assert.equal(app.store.replaceReport(B), true);
    const hostB = (await post(`${url}/v1/rooms`, setup(B))).body;
    assert.equal(hostB.report_sha256, sha(B));
    await stop();
    url = await start(C);
    for (const [room, token, role, report] of [[hostA, hostA.token, "BLUE", A], [hostA, guestA.token, "RED", A], [hostA, hostA.view, "SPECTATOR", A], [hostB, hostB.token, "BLUE", B], [hostB, hostB.view, "SPECTATOR", B]]) {
      const read = await fetch(`${url}/v1/rooms/${room.id}`, { headers: headers(token) });
      assert.equal(read.status, 200);
      const body = await read.json();
      assert.equal(body.role, role);
      assert.equal(body.report_sha256, sha(report));
      const served = await fetch(`${url}/v1/rooms/${room.id}/report`, { headers: headers(token) });
      assert.equal(served.status, 200);
      const pinned = await served.json();
      assert.equal(sha(pinned), sha(report), "the served report hashes to the room's report_sha256");
      assert.equal(pinned.opponent_prep.teams[0].team_name, report.opponent_prep.teams[0].team_name);
    }
    assert.equal((await fetch(`${url}/v1/rooms/${hostA.id}/report`, { headers: headers() })).status, 401);
    const read = await (await fetch(`${url}/v1/rooms/${hostA.id}`, { headers: headers(hostA.view) })).json();
    assert.equal(read.snapshot.revision, 2);
    assert.equal(read.snapshot.selections[0].champion_id, "Ahri");
    const hostC = await post(`${url}/v1/rooms`, setup(C));
    assert.equal(hostC.status, 201);
    assert.equal(hostC.body.report_sha256, sha(C));
    await stop();
    assert.deepEqual((await readdir(dir)).filter(name => name.endsWith(".tmp")), []);
  } finally { if (app) await stop(); }
});

test("v1 files load only for the identical starting report and loading does not rewrite them", () => {
  const backend = memory(), store = new Store(A, { persistence: backend, clock: () => T0 });
  const room = seat(store, A);
  const v2 = JSON.parse(backend.text);
  const v1 = JSON.stringify({ schema: "draft-room-state", version: 1, feed: persistence.feedIdentity(A), saved_at: v2.saved_at,
    rooms: v2.rooms.map(room => { const rest = { ...room }; delete rest.report_sha256; return rest; }) });
  const legacy = memory(v1);
  const restored = new Store(A, { persistence: legacy, clock: () => T0 + 1000 });
  assert.equal(legacy.saves, 0); assert.equal(legacy.text, v1, "load alone leaves the v1 file as it was");
  assert.equal(restored.read(room.host.id, room.guest.token).role, "RED");
  assert.equal(restored.read(room.host.id, room.viewer.token).report_sha256, sha(A));
  assert.equal(sha(restored.roomReport(room.host.id, room.viewer.token)), sha(A));
  restored.sweep();
  assert.equal(legacy.saves, 0, "a sweep with nothing expired does not write either");
  for (const other of [B, C]) {
    const refused = memory(v1);
    assert.throws(() => new Store(other, { persistence: refused, clock: () => T0 + 1000 }), code("FEED_MISMATCH"));
    assert.equal(refused.text, v1);
  }
  // The next real mutation upgrades the file to v2.
  restored.act(room.host.id, room.guest.token, { id: "red-ban-after-upgrade", revision: 2, kind: "SELECT", championId: "Garen" });
  const upgraded = JSON.parse(legacy.text);
  assert.equal(upgraded.version, 2);
  assert.equal(upgraded.rooms[0].report_sha256, sha(A));
  assert.equal(new Store(C, { persistence: memory(legacy.text), clock: () => T0 + 2000 }).read(room.host.id, room.viewer.token).snapshot.revision, 3);
});

test("tampered v2 files fail closed with no partial restore and no rewrite", async () => {
  const backend = memory(), store = new Store(A, { persistence: backend, clock: () => T0 });
  seat(store, A); store.replaceReport(B); seat(store, B);
  const original = backend.text;
  const index = (state, report) => state.reports.findIndex(r => r.identity.sha256 === sha(report));
  const rekey = (state, report, mutate) => {
    // A self-consistent new report (valid hash and identity) that the room's draft is no longer legal on.
    const i = index(state, report), body = state.reports[i].report;
    mutate(body);
    const identity = persistence.feedIdentity(body), old = state.reports[i].identity.sha256;
    state.reports[i].identity = identity;
    for (const room of state.rooms) if (room.report_sha256 === old) room.report_sha256 = identity.sha256;
    if (state.feed.sha256 === old) state.feed = identity;
    return state;
  };
  const cases = [
    ["REPORT_MISMATCH", s => { s.reports[index(s, A)].report.opponent_prep.teams[0].team_name = "Edited body, same key"; return s; }],
    ["REPORT_INVALID", s => { delete s.reports[index(s, A)].report.opponent_prep; return s; }],
    ["REPORT_MISMATCH", s => { s.reports[index(s, A)].identity.cutoff = "2000-01-01T00:00:00Z"; return s; }],
    ["REPORT_MISSING", s => { s.rooms[0].report_sha256 = "0".repeat(64); return s; }],
    ["STATE_CORRUPT", s => { delete s.rooms[0].report_sha256; return s; }],
    ["FEED_MISMATCH", s => { s.feed = { ...s.feed, sha256: "1".repeat(64) }; return s; }],
    ["STATE_CORRUPT", s => { s.reports.push(structuredClone(s.reports[0])); return s; }],
    ["STATE_CORRUPT", s => { s.rooms = s.rooms.filter(r => r.report_sha256 !== sha(A)); return s; }],
    ["CREDENTIAL_INVALID", s => { s.rooms[1].view = s.rooms[0].view; return s; }],
    ["STATE_CORRUPT", s => { s.rooms[1].snapshot.id = s.rooms[0].snapshot.id; return s; }],
    ["ILLEGAL_DRAFT", s => rekey(s, B, report => { report.opponent_prep.teams[0].team_id = "oe:team:fixture-renamed-team"; })],
    ["FEED_MISMATCH", s => { const i = s.rooms.findIndex(r => r.report_sha256 === sha(B)); s.rooms[i].snapshot.cutoff = "2000-01-01T00:00:00.000Z"; return s; }],
  ];
  for (const [expected, mutate] of cases) {
    const text = JSON.stringify(mutate(JSON.parse(original))), tampered = memory(text);
    assert.throws(() => new Store(C, { persistence: tampered, clock: () => T0 + 1000 }), code(expected), expected);
    assert.equal(tampered.text, text, `${expected} leaves the file untouched`);
    assert.equal(tampered.saves, 0);
  }
  // The same checks hold through the real file backend.
  const path = file();
  await writeFile(path, JSON.stringify(cases[0][1](JSON.parse(original))));
  const before = await readFile(path, "utf8");
  assert.throws(() => new Store(C, { persistence: persistence.createFileRoomPersistence(path), clock: () => T0 + 1000 }), code("REPORT_MISMATCH"));
  assert.equal(await readFile(path, "utf8"), before);
});

test("a failed write during create or reload leaves file, active report, rooms and listeners unchanged", () => {
  const backend = memory(), store = new Store(A, { persistence: backend, clock: () => T0 });
  const room = seat(store, A), messages = [];
  store.subscribe(room.host.id, room.viewer.token, snapshot => messages.push(snapshot));
  const saved = backend.text;
  backend.failing = true;
  assert.throws(() => store.replaceReport(B), code("STORAGE_UNAVAILABLE"));
  assert.throws(() => store.create(setup(A)), code("STORAGE_UNAVAILABLE"));
  assert.equal(backend.text, saved);
  assert.deepEqual(store.feed, { patch_id: A.patch_id, cutoff: A.cutoff });
  assert.equal(messages.length, 1, "no notification from failed writes");
  backend.failing = false;
  assert.equal(new Store(A, { persistence: memory(backend.text), clock: () => T0 }).read(room.host.id, room.host.token).snapshot.revision, 2);
  const next = store.create(setup(A));
  assert.equal(next.report_sha256, sha(A), "the failed reload did not switch new rooms to B");
  assert.equal(JSON.parse(backend.text).rooms.length, 2, "the failed create left no room behind");
  assert.equal(store.replaceReport(B), true, "the same reload succeeds once storage is back");
  assert.equal(store.create(setup(B)).report_sha256, sha(B));
});

test("a write over the 8 MiB budget is refused and never deletes a live room", () => {
  let clock = T0;
  const backend = memory(), store = new Store(A, { persistence: backend, clock: () => clock });
  const reports = Array.from({ length: 14 }, (_, i) => { const report = structuredClone(base); report.opponent_prep.teams[0].team_name = `Budget ${i}`; return report; });
  const rooms = [];
  let refused = null;
  store.replaceReport(reports[0]);
  for (let i = 0; i < reports.length; i++) {
    const created = store.create(setup(reports[i]));
    rooms.push({ id: created.id, token: created.token, report: reports[i] });
    clock += 1000;
    if (i + 1 === reports.length) break;
    try { store.replaceReport(reports[i + 1]); }
    catch (error) { refused = { error, at: i + 1 }; break; }
  }
  assert.ok(refused, "some reload must exceed the budget with ~0.7 MB reports");
  assert.equal(refused.error.code, "STORAGE_UNAVAILABLE");
  const saved = backend.text;
  assert.ok(Buffer.byteLength(saved) <= persistence.MAX_STATE_BYTES);
  assert.deepEqual(store.feed, { patch_id: reports[refused.at - 1].patch_id, cutoff: reports[refused.at - 1].cutoff });
  // Every room is still in memory and in the file; new rooms keep using the last stored report.
  const state = JSON.parse(saved);
  assert.equal(state.rooms.length, rooms.length);
  assert.equal(state.feed.sha256, sha(reports[refused.at - 1]));
  const extra = store.create(setup(reports[refused.at - 1]));
  assert.equal(extra.report_sha256, sha(reports[refused.at - 1]));
  const restored = new Store(C, { persistence: memory(backend.text), clock: () => clock });
  for (const room of rooms) assert.equal(restored.read(room.id, room.token).report_sha256, sha(room.report), "no live room was deleted to make space");
});

test("expired rooms drop their no-longer-referenced reports on the next write", () => {
  let clock = T0;
  const backend = memory(), store = new Store(A, { persistence: backend, clock: () => clock, ttlMs: 60_000 });
  const roomA = store.create(setup(A));
  store.replaceReport(B);
  clock += 30_000;
  const roomB = store.create(setup(B));
  assert.deepEqual(JSON.parse(backend.text).reports.map(r => r.identity.sha256).sort(), [sha(A), sha(B)].sort());
  clock += 30_001; // room A expired, room B still live
  const saves = backend.saves;
  // A restart in between drops the expired room without writing.
  new Store(C, { persistence: memory(backend.text), clock: () => clock, ttlMs: 60_000 });
  assert.equal(backend.saves, saves);
  store.join(roomB.id, { invite: roomB.invite });
  const state = JSON.parse(backend.text);
  assert.deepEqual(state.rooms.map(r => r.snapshot.id), [roomB.id]);
  assert.deepEqual(state.reports.map(r => r.identity.sha256), [sha(B)], "A's report left with its last room");
  assert.throws(() => store.read(roomA.id, roomA.token), e => e.code === "ROOM_EXPIRED" || e.code === "ROOM_NOT_FOUND");
});

test("real file backend: mixed generations survive a restart with a new backend instance, including action idempotency", async () => {
  let clock = T0;
  const path = file(), first = new Store(A, { persistence: persistence.createFileRoomPersistence(path), clock: () => clock });
  const host = first.create(setup(A)), guest = first.join(host.id, { invite: host.invite });
  const ban = { id: "file-blue-ban-0001", revision: 1, kind: "SELECT", championId: "Ahri" };
  const banned = first.act(host.id, host.token, ban);
  assert.equal(banned.snapshot.revision, 2);
  assert.equal(first.replaceReport(B), true);
  const hostB = first.create(setup(B));
  const beforeA = first.read(host.id, guest.token), beforeB = first.read(hostB.id, hostB.view);
  clock += 60_000;
  const bytes = await readFile(path, "utf8");
  const restarted = new Store(C, { persistence: persistence.createFileRoomPersistence(path), clock: () => clock });
  assert.equal(await readFile(path, "utf8"), bytes, "restart alone does not rewrite the file");
  const readA = restarted.read(host.id, host.token);
  assert.equal(readA.role, "BLUE");
  assert.ok(readA.invite === host.invite && readA.view === host.view);
  assert.equal(restarted.read(host.id, guest.token).role, "RED");
  assert.equal(restarted.read(host.id, host.view).role, "SPECTATOR");
  assert.equal(restarted.read(hostB.id, hostB.token).role, "BLUE");
  assert.deepEqual(restarted.read(host.id, guest.token).snapshot, beforeA.snapshot, "revision, selections and expiry unchanged");
  assert.deepEqual(restarted.read(hostB.id, hostB.view).snapshot, beforeB.snapshot);
  assert.equal(readA.report_sha256, sha(A));
  assert.equal(restarted.read(hostB.id, hostB.view).report_sha256, sha(B));
  assert.equal(sha(restarted.roomReport(host.id, host.view)), sha(A));
  assert.equal(sha(restarted.roomReport(hostB.id, hostB.view)), sha(B));
  // Same action id after the restart returns the same result; a different action under it is refused.
  const retried = restarted.act(host.id, host.token, ban);
  assert.deepEqual(retried.snapshot, banned.snapshot);
  assert.throws(() => restarted.act(host.id, host.token, { ...ban, championId: "Lux" }), code("ACTION_ID_REUSED"));
  assert.equal(await readFile(path, "utf8"), bytes, "an idempotent retry writes nothing");
  const fresh = restarted.create(setup(C));
  assert.equal(fresh.report_sha256, sha(C));
  assert.equal(restarted.read(host.id, host.view).report_sha256, sha(A), "existing rooms stay on their report");
  assert.deepEqual((await readdir(dir)).filter(name => name.endsWith(".tmp")), []);
});

test("real file backend: a failed reload write keeps bytes, rooms and the active report; the retry then succeeds", async () => {
  const path = file(), real = persistence.createFileRoomPersistence(path);
  let failing = false;
  const flaky = { mode: "file", load: () => real.load(), save: text => { if (failing) throw new Error("disk full"); real.save(text); } };
  const store = new Store(A, { persistence: flaky, clock: () => T0 });
  const room = seat(store, A);
  const before = store.read(room.host.id, room.viewer.token), bytes = await readFile(path, "utf8");
  failing = true;
  assert.throws(() => store.replaceReport(B), code("STORAGE_UNAVAILABLE"));
  assert.equal(await readFile(path, "utf8"), bytes, "file bytes unchanged");
  assert.deepEqual(store.read(room.host.id, room.viewer.token), before, "room snapshot and report hash unchanged");
  assert.equal(sha(store.roomReport(room.host.id, room.viewer.token)), sha(A));
  assert.deepEqual(store.feed, { patch_id: A.patch_id, cutoff: A.cutoff });
  failing = false;
  const afterRecovery = store.create(setup(A));
  assert.equal(afterRecovery.report_sha256, sha(A), "new rooms still use A after the failed reload");
  assert.equal(store.replaceReport(B), true, "the retry succeeds once writes work again");
  const onB = store.create(setup(B));
  assert.equal(onB.report_sha256, sha(B));
  assert.equal(store.read(afterRecovery.id, afterRecovery.view).report_sha256, sha(A));
  const restored = new Store(C, { persistence: persistence.createFileRoomPersistence(path), clock: () => T0 });
  assert.equal(restored.read(onB.id, onB.token).report_sha256, sha(B));
  assert.equal(restored.read(afterRecovery.id, afterRecovery.token).report_sha256, sha(A));
  assert.deepEqual((await readdir(dir)).filter(name => name.endsWith(".tmp")), []);
});
