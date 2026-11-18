import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { createServer } from "vite";

let vite, Store, share, agent, report, initial, champions;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false,
    server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  Store = (await vite.ssrLoadModule("/server/draft-room-store.ts")).DraftRoomStore;
  share = await vite.ssrLoadModule("/app/draft-share.ts");
  agent = await vite.ssrLoadModule("/app/draft-agent.ts");
  champions = (await vite.ssrLoadModule("/app/share-champion-ids.ts")).SHARE_CHAMPIONS.map(c => c[1]);
  report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  const [blue, red] = report.opponent_prep.teams;
  initial = { report, blueTeamId: blue.team_id, redTeamId: red.team_id, games: [], selections: [], stagedChampion: null, firstPickSide: "BLUE" };
});
after(async () => { await vite?.close(); });
const setup = (session = initial) => ({ share: new URL(share.createDraftShareUrl("https://example.test/app/", session)).hash });
const action = (revision, championId, id = "request-00000001") => ({ id, revision, kind: "SELECT", championId });
const error = code => e => e.code === code;

test("private seats, waiting state, single red claim and spectator authority", () => {
  const store = new Store(report), host = store.create(setup());
  assert.equal(host.role, "BLUE");
  assert.equal(host.snapshot.status, "WAITING");
  assert.throws(() => store.act(host.id, host.token, action(0, "Ahri")), error("WAITING_FOR_RED"));
  assert.throws(() => store.join(host.id, { invite: "wrong" }), error("INVALID_INVITE"));
  const guest = store.join(host.id, { invite: host.invite });
  assert.equal(guest.role, "RED");
  assert.notEqual(guest.token, host.invite);
  assert.throws(() => store.join(host.id, { invite: host.invite }), error("SEAT_TAKEN"));
  const viewer = store.join(host.id, { view: host.view });
  assert.equal(viewer.role, "SPECTATOR");
  assert.throws(() => store.act(host.id, viewer.token, action(1, "Ahri")), error("READ_ONLY"));
  assert.throws(() => store.read(host.id, host.invite), error("UNAUTHORIZED"));
  assert.equal(store.read(host.id, host.token).invite, host.invite, "host can recover invitations after reload");
  assert.equal(store.read(host.id, host.token).view, host.view);
  assert.equal(store.read(host.id, guest.token).invite, undefined);
  const json = JSON.stringify(store.read(host.id, viewer.token));
  for (const token of [host.token, guest.token, host.invite, host.view]) assert.ok(!json.includes(token));
});

test("only own turn, stale revision and locked champions are rejected on the server", () => {
  const store = new Store(report), host = store.create(setup()), guest = store.join(host.id, { invite: host.invite });
  assert.throws(() => store.act(host.id, guest.token, action(1, "Ahri")), error("NOT_YOUR_TURN"));
  assert.equal(store.act(host.id, host.token, action(1, "Vel'Koz")).snapshot.selections[0].champion_id, "Velkoz");
  assert.throws(() => store.act(host.id, host.token, action(2, "Ahri", "request-00000002")), error("NOT_YOUR_TURN"));
  assert.throws(() => store.act(host.id, guest.token, action(1, "Ahri")), error("REVISION_CONFLICT"));
  assert.throws(() => store.act(host.id, guest.token, action(2, "VelKoz")), error("CHAMPION_LOCKED"));
  assert.equal(store.read(host.id, host.token).snapshot.revision, 2);
  assert.equal(store.act(host.id, guest.token, action(2, "Ahri")).snapshot.revision, 3);
  assert.equal(store.read(host.id, host.token).snapshot.selections.length, 2);
});

test("red first, detached snapshots and idempotent commands do not duplicate picks", () => {
  const store = new Store(report), host = store.create(setup({ ...initial, firstPickSide: "RED" }));
  const guest = store.join(host.id, { invite: host.invite });
  const request = action(1, "Ahri");
  store.act(host.id, guest.token, request);
  store.act(host.id, host.token, action(2, "Garen"));
  const retried = store.act(host.id, guest.token, request);
  assert.equal(retried.snapshot.revision, 3);
  assert.equal(retried.snapshot.selections.length, 2);
  retried.snapshot.selections.length = 0;
  assert.equal(store.read(host.id, host.token).snapshot.selections.length, 2);
  assert.throws(() => store.act(host.id, guest.token, { ...request, championId: "Azir" }), error("ACTION_ID_REUSED"));
});

test("complete draft and next set retain actual hard Fearless picks; reset is host-only", () => {
  let selections = [];
  for (const id of champions.slice(0, 20)) selections = agent.applyDraftSelection(selections, id);
  const store = new Store(report), host = store.create(setup({ ...initial, selections }));
  const guest = store.join(host.id, { invite: host.invite });
  assert.equal(guest.snapshot.status, "COMPLETE");
  assert.throws(() => store.act(host.id, guest.token, { id: "request-next-red", revision: 1, kind: "NEXT_GAME" }), error("HOST_ONLY"));
  const next = store.act(host.id, host.token, { id: "request-next-blue", revision: 1, kind: "NEXT_GAME" });
  assert.equal(next.snapshot.games.length, 1);
  assert.equal(next.snapshot.selections.length, 0);
  const priorPick = selections.find(s => s.kind === "PICK").champion_id;
  assert.throws(() => store.act(host.id, host.token, action(2, priorPick)), error("CHAMPION_LOCKED"));
  const reset = store.act(host.id, host.token, { id: "request-reset-blue", revision: 2, kind: "RESET" });
  assert.deepEqual(reset.snapshot.games, []);
  assert.deepEqual(reset.snapshot.selections, []);
});

test("expiry, capacity, subscription cleanup and malformed setups fail closed", () => {
  let clock = Date.now();
  const store = new Store(report, { clock: () => clock, ttlMs: 10, maxRooms: 1, maxListeners: 1 });
  const host = store.create(setup()), messages = [];
  const release = store.subscribe(host.id, host.token, s => messages.push(s));
  assert.equal(messages.length, 1);
  assert.throws(() => store.subscribe(host.id, host.token, () => {}), error("CONNECTION_LIMIT"));
  release();
  store.subscribe(host.id, host.token, s => messages.push(s));
  assert.throws(() => store.create(setup()), error("ROOM_LIMIT"));
  clock += 11;
  assert.throws(() => store.read(host.id, host.token), error("ROOM_EXPIRED"));
  assert.equal(messages.at(-1), null);
  assert.ok(store.create(setup()).id);
  assert.throws(() => store.create({ share: "#room=bad" }), error("INVALID_SETUP"));
});

test("array-valued action kinds never fall through to a destructive reset", () => {
  const store = new Store(report), host = store.create(setup());
  store.join(host.id, { invite: host.invite });
  store.act(host.id, host.token, action(1, "Ahri"));
  const before = store.read(host.id, host.token).snapshot;
  for (const kind of [["SELECT"], ["NEXT_GAME"], ["RESET"], null, {}]) {
    assert.throws(() => store.act(host.id, host.token, { id: "request-malformed", revision: 2, kind }), error("BAD_ACTION"));
    assert.deepEqual(store.read(host.id, host.token).snapshot, before);
  }
});
