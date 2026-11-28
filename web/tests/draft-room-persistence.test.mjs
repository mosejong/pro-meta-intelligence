import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { createServer } from "vite";

let vite, Store, persistence, share, agent, report, initial, champions, dir;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false,
    server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  Store = (await vite.ssrLoadModule("/server/draft-room-store.ts")).DraftRoomStore;
  persistence = await vite.ssrLoadModule("/server/draft-room-persistence.ts");
  share = await vite.ssrLoadModule("/app/draft-share.ts");
  agent = await vite.ssrLoadModule("/app/draft-agent.ts");
  champions = (await vite.ssrLoadModule("/app/share-champion-ids.ts")).SHARE_CHAMPIONS.map(c => c[1]);
  report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  const [blue, red] = report.opponent_prep.teams;
  initial = { report, blueTeamId: blue.team_id, redTeamId: red.team_id, games: [], selections: [], stagedChampion: null, firstPickSide: "BLUE" };
  dir = await mkdtemp(join(tmpdir(), "draft-room-persist-"));
});
after(async () => { await vite?.close(); if (dir) await rm(dir, { recursive: true, force: true }); });
let counter = 0;
const file = () => join(dir, `state-${++counter}.json`);
const setup = (session = initial) => ({ share: new URL(share.createDraftShareUrl("https://example.test/app/", session)).hash });
const action = (revision, championId, id = "request-00000001") => ({ id, revision, kind: "SELECT", championId });
const code = c => e => e.code === c;
const backend = path => persistence.createFileRoomPersistence(path);

function seeded(path, options = {}) {
  const store = new Store(report, { persistence: backend(path), ...options });
  const host = store.create(setup()), guest = store.join(host.id, { invite: host.invite }), viewer = store.join(host.id, { view: host.view });
  store.act(host.id, host.token, action(1, "Ahri", "request-blue-0001"));
  return { store, host, guest, viewer };
}

test("default store stays ephemeral and file mode is explicit", () => {
  assert.equal(new Store(report).storage, "ephemeral");
  assert.equal(new Store(report, { persistence: backend(file()) }).storage, "file");
});

test("restart restores rooms, seats, revision and idempotent action ids without extending expiry", async () => {
  let clock = Date.parse("2026-11-19T00:00:00.000Z");
  const path = file(), { host, guest, viewer, store } = seeded(path, { clock: () => clock });
  const expiresAt = store.read(host.id, host.token).snapshot.expiresAt;
  clock += 60_000;
  const restored = new Store(report, { persistence: backend(path), clock: () => clock });
  assert.equal(restored.read(host.id, host.token).role, "BLUE");
  assert.equal(restored.read(host.id, host.token).invite, host.invite);
  assert.equal(restored.read(host.id, guest.token).role, "RED");
  assert.equal(restored.read(host.id, viewer.token).role, "SPECTATOR");
  const snapshot = restored.read(host.id, viewer.token).snapshot;
  assert.equal(snapshot.revision, 2);
  assert.equal(snapshot.expiresAt, expiresAt, "expiry is not extended by restart");
  assert.equal(snapshot.selections[0].champion_id, "Ahri");
  assert.throws(() => restored.read(host.id, "x".repeat(32)), code("UNAUTHORIZED"));
  assert.throws(() => restored.join(host.id, { invite: host.invite }), code("SEAT_TAKEN"));
  assert.equal(restored.act(host.id, host.token, action(1, "Ahri", "request-blue-0001")).snapshot.revision, 2, "retry is idempotent after restart");
  assert.throws(() => restored.act(host.id, host.token, action(1, "Garen", "request-blue-0001")), code("ACTION_ID_REUSED"));
  assert.throws(() => restored.act(host.id, guest.token, action(1, "Garen", "request-red-0001")), code("REVISION_CONFLICT"));
  assert.throws(() => restored.act(host.id, viewer.token, action(2, "Garen", "request-view-01")), code("READ_ONLY"));
  assert.equal(restored.act(host.id, guest.token, action(2, "Garen", "request-red-0001")).snapshot.revision, 3);
  const text = await readFile(path, "utf8");
  assert.equal(JSON.parse(text).rooms[0].actions.length, 2);
  assert.deepEqual((await readdir(dir)).filter(name => name.endsWith(".tmp")), [], "no temporary files remain");
});

test("expired rooms are dropped on restore and sweep prunes the file", async () => {
  let clock = Date.parse("2026-11-19T00:00:00.000Z");
  const path = file(), { host } = seeded(path, { clock: () => clock, ttlMs: 1000 });
  clock += 1001;
  const restored = new Store(report, { persistence: backend(path), clock: () => clock, ttlMs: 1000 });
  assert.throws(() => restored.read(host.id, host.token), code("ROOM_NOT_FOUND"));
  const live = new Store(report, { persistence: backend(path), clock: () => clock - 1001, ttlMs: 1000 });
  assert.equal(JSON.parse(await readFile(path, "utf8")).rooms.length, 1);
  clock += 0;
  const later = { now: clock };
  const sweeper = new Store(report, { persistence: backend(path), clock: () => later.now - 1001, ttlMs: 1000 });
  later.now += 2000; sweeper.sweep();
  assert.equal(JSON.parse(await readFile(path, "utf8")).rooms.length, 0, "sweep removes expired credentials from the file");
  assert.ok(live);
});

test("corrupt, schema, feed, draft, credential and expiry tampering fail closed without rewriting", async () => {
  const path = file(); seeded(path);
  const original = await readFile(path, "utf8");
  const cases = [
    ["STATE_CORRUPT", () => "{not json"],
    ["STATE_SCHEMA", s => ({ ...s, version: 3 })],
    ["FEED_MISMATCH", s => ({ ...s, feed: { ...s.feed, sha256: "0".repeat(64) } })],
    ["ILLEGAL_DRAFT", s => { s.rooms[0].snapshot.selections[0].champion_id = "Garen"; s.rooms[0].snapshot.selections.push({ ...s.rooms[0].snapshot.selections[0], turn: 2 }); return s; }],
    ["ILLEGAL_DRAFT", s => { s.rooms[0].snapshot.selections[0].side = "RED"; return s; }],
    ["ILLEGAL_DRAFT", s => { s.rooms[0].snapshot.status = "COMPLETE"; return s; }],
    ["CREDENTIAL_INVALID", s => { s.rooms[0].guest = s.rooms[0].host; return s; }],
    ["CREDENTIAL_INVALID", s => { s.rooms[0].view = "short"; return s; }],
    ["CREDENTIAL_INVALID", s => { s.rooms[0].guest = null; return s; }],
    ["EXPIRY_INVALID", s => { s.rooms[0].snapshot.expiresAt = new Date(Date.now() + 365 * 864e5).toISOString(); return s; }],
    ["STATE_CORRUPT", s => { s.rooms[0].actions.push(["BLUE:x", "y"]); return s; }],
    ["STATE_CORRUPT", s => { s.rooms[0].extra = true; return s; }],
  ];
  for (const [expected, mutate] of cases) {
    const result = mutate(JSON.parse(original)), text = typeof result === "string" ? result : JSON.stringify(result);
    await writeFile(path, text);
    assert.throws(() => new Store(report, { persistence: backend(path) }), code(expected), expected);
    assert.equal(await readFile(path, "utf8"), text, `${expected} leaves the file untouched`);
  }
  await writeFile(path, original);
  const changed = { ...structuredClone(report), cutoff: "2000-01-01T00:00:00Z" };
  // State v2: a different starting feed no longer refuses the file; rooms keep their own stored report and the new
  // starting feed is saved as active before the store is returned (a v1 file with the same identity is not rewritten;
  // see draft-room-persistence-v2.test.mjs).
  assert.equal(new Store(changed, { persistence: backend(path) }).storage, "file");
  const rewritten = JSON.parse(await readFile(path, "utf8"));
  assert.equal(rewritten.feed.cutoff, changed.cutoff);
  assert.deepEqual(rewritten.rooms.map(room => room.snapshot.id), JSON.parse(original).rooms.map(room => room.snapshot.id));
  await writeFile(path, original);
  const small = persistence.createFileRoomPersistence(path, { maxBytes: 16 });
  assert.throws(() => new Store(report, { persistence: small }), code("STATE_TOO_LARGE"));
  assert.throws(() => new Store(report, { persistence: backend(dir) }), code("STATE_UNREADABLE"), "directories are not state files");
});

test("hard Fearless history survives restart and is re-validated", () => {
  let selections = [];
  for (const id of champions.slice(0, 20)) selections = agent.applyDraftSelection(selections, id);
  const path = file(), store = new Store(report, { persistence: backend(path) });
  const host = store.create(setup({ ...initial, selections }));
  store.join(host.id, { invite: host.invite });
  store.act(host.id, host.token, { id: "request-next-blue", revision: 1, kind: "NEXT_GAME" });
  const restored = new Store(report, { persistence: backend(path) });
  const priorPick = selections.find(s => s.kind === "PICK").champion_id;
  assert.equal(restored.read(host.id, host.token).snapshot.games.length, 1);
  assert.throws(() => restored.act(host.id, host.token, action(2, priorPick)), code("CHAMPION_LOCKED"));
});

test("write failures roll back create, join and act with no notify or memory mutation", async () => {
  const path = file(), real = backend(path);
  let failing = false;
  const flaky = { mode: "file", load: () => real.load(), save: text => { if (failing) throw new Error("disk full"); real.save(text); } };
  const store = new Store(report, { persistence: flaky });
  failing = true;
  assert.throws(() => store.create(setup()), code("STORAGE_UNAVAILABLE"));
  assert.equal(real.load(), null, "no file written for a failed create");
  failing = false;
  const host = store.create(setup()), messages = [];
  store.subscribe(host.id, host.token, s => messages.push(s));
  failing = true;
  assert.throws(() => store.join(host.id, { invite: host.invite }), code("STORAGE_UNAVAILABLE"));
  assert.equal(store.read(host.id, host.token).snapshot.seats.RED, false);
  assert.equal(messages.length, 1);
  failing = false;
  const guest = store.join(host.id, { invite: host.invite });
  const before = await readFile(path, "utf8");
  failing = true;
  assert.throws(() => store.act(host.id, host.token, action(1, "Ahri")), code("STORAGE_UNAVAILABLE"));
  assert.equal(store.read(host.id, guest.token).snapshot.revision, 1);
  assert.equal(store.read(host.id, guest.token).snapshot.selections.length, 0);
  assert.equal(messages.length, 2);
  assert.equal(await readFile(path, "utf8"), before);
  failing = false;
  assert.equal(store.act(host.id, host.token, action(1, "Ahri")).snapshot.revision, 2, "same action id is not burned by the failed write");
});

test("atomic file writes leave the previous state when rename cannot happen", async () => {
  const path = file(); seeded(path);
  const original = await readFile(path, "utf8");
  const missing = persistence.createFileRoomPersistence(join(dir, "missing-dir", "state.json"));
  assert.throws(() => missing.save("{}"), code("STATE_WRITE_FAILED"));
  assert.equal(await readFile(path, "utf8"), original);
  assert.deepEqual((await readdir(dir)).filter(name => name.endsWith(".tmp")), []);
});

test("public, dist and static paths are refused and snapshots never carry the path", () => {
  for (const bad of [join(dir, "public", "s.json"), join(dir, "dist", "s.json"), join(dir, "Static", "s.json"), ""]) {
    assert.throws(() => persistence.createFileRoomPersistence(bad), e => e.code === "PUBLIC_PATH" || e.code === "INVALID_PATH", bad);
  }
  assert.throws(() => persistence.createFileRoomPersistence(join(dir, "deploy", "s.json"), { forbiddenRoots: [join(dir, "deploy")] }), code("PUBLIC_PATH"));
  const path = file(), { store, host, viewer } = seeded(path);
  const json = JSON.stringify(store.read(host.id, viewer.token));
  assert.ok(!json.includes(path) && !json.includes("state-"));
  assert.ok(!json.includes(host.token) && !json.includes(host.invite));
});
