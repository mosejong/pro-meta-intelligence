import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
let vite, C, R;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  C = await vite.ssrLoadModule("/app/guest-club.ts"); R = await vite.ssrLoadModule("/app/roster-scenario.ts");
});
after(async () => { await vite?.close(); });
const basis = { patch_id: "16.20", cutoff: "2026-11-14T00:00:00Z", fixture_only: false, source_versions: ["oe@2026#hash"] };
function fixture() {
  const teams = ["blue", "red"].map(team_id => ({ team_id, team_name: team_id, player_profiles: R.ROSTER_ROLES.map(role => ({ player_id: `${team_id}-${role}`, player_name: role, role, roster_status: "CURRENT", game_count: 3 })) }));
  const index = R.buildRosterIndex(teams), state = R.observedRosters(teams, ["blue", "red"], index);
  const club = { id: "12345678-1234-4234-8234-123456789abc", revision: 1, name: "드림팀", headCoach: "우리 감독", assistantCoach: "", baseTeamId: "blue", basis, slots: structuredClone(state.blue), createdAt: "2026-11-18T00:00:00Z", updatedAt: "2026-11-18T00:00:00Z" };
  const data = new Map();
  const storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  return { index, state, club, data, storage };
}
test("save preserves a single club's five roles, empty slots, coaches and detached metadata", () => {
  const { club, storage } = fixture(); club.slots.TOP = null;
  const saved = C.saveGuestClub(storage, club);
  club.name = "changed"; club.slots.MID = null;
  assert.equal(saved.clubs[0].name, "드림팀"); assert.equal(saved.clubs[0].slots.TOP, null); assert.ok(saved.clubs[0].slots.MID);
  assert.equal(C.parseClubLibrary(storage.getItem(C.CLUB_STORAGE_KEY)).clubs[0].headCoach, "우리 감독");
});
test("load restores empty slots without mutating saved club or opponent", () => {
  const { club, state, index } = fixture(); club.slots.TOP = null;
  const before = JSON.stringify({ club, state });
  const next = C.applyGuestClub(club, "blue", state, basis, index);
  assert.equal(next.blue.TOP, null); assert.deepEqual(next.red, state.red); assert.equal(JSON.stringify({ club, state }), before);
  next.blue.MID = null; assert.ok(club.slots.MID);
});
test("opponent duplicate, unknown player and changed snapshot refuse atomically", () => {
  const { club, state, index } = fixture(); const before = JSON.stringify(state);
  club.slots.TOP = structuredClone(state.red.TOP);
  assert.throws(() => C.applyGuestClub(club, "blue", state, basis, index), /상대/);
  club.slots.TOP = { source_team_id: "missing", player_id: "missing" };
  assert.throws(() => C.applyGuestClub(club, "blue", state, basis, index), /확인할 수 없는/);
  assert.throws(() => C.applyGuestClub(club, "blue", state, { ...basis, cutoff: "2026-11-15T00:00:00Z" }, index), /자료 기준/);
  assert.equal(JSON.stringify(state), before);
});
test("old snapshot clubs remain stored and deletable even when they cannot be applied", () => {
  const { club, storage } = fixture(); club.basis = { ...basis, patch_id: "old" };
  C.saveGuestClub(storage, club); assert.equal(C.parseClubLibrary(storage.getItem(C.CLUB_STORAGE_KEY)).clubs.length, 1);
  assert.equal(C.deleteGuestClub(storage, club.id).clubs.length, 0);
});
test("corrupt, future and duplicate player libraries never get overwritten", () => {
  const { club, storage, data } = fixture();
  const envelope = { artifact_type: "guest-clubs", schema_version: 1, clubs: [club] };
  for (const raw of ["broken", JSON.stringify({ ...envelope, schema_version: 3 }), JSON.stringify({ ...envelope, clubs: [{ ...club, slots: { ...club.slots, TOP: club.slots.MID } }] })]) {
    data.set(C.CLUB_STORAGE_KEY, raw);
    assert.throws(() => C.saveGuestClub(storage, club)); assert.throws(() => C.deleteGuestClub(storage, club.id));
    assert.equal(data.get(C.CLUB_STORAGE_KEY), raw);
  }
});
test("full or denied storage does not report a phantom successful save or deletion", () => {
  const { club, storage, data } = fixture(); C.saveGuestClub(storage, club); const before = data.get(C.CLUB_STORAGE_KEY);
  const denied = { getItem: storage.getItem, setItem: () => { throw new Error("quota"); } };
  assert.throws(() => C.saveGuestClub(denied, { ...club, id: "22345678-1234-4234-8234-123456789abc" }), /quota/);
  assert.throws(() => C.deleteGuestClub(denied, club.id), /quota/); assert.equal(data.get(C.CLUB_STORAGE_KEY), before);
});
test("ten-club cap preserves all existing saves and duplicate ids are rejected", () => {
  const { club, storage } = fixture();
  for (let i = 0; i < 10; i++) C.saveGuestClub(storage, { ...club, id: `${String(i).repeat(8)}-1234-4234-8234-123456789abc` });
  const before = storage.getItem(C.CLUB_STORAGE_KEY);
  assert.throws(() => C.saveGuestClub(storage, club), /최대/);
  assert.throws(() => C.saveGuestClub(storage, { ...club, id: "00000000-1234-4234-8234-123456789abc" }), /이미/);
  assert.equal(storage.getItem(C.CLUB_STORAGE_KEY), before);
});
test("limits reject huge libraries, invalid ids, control names and malformed role slots", () => {
  const { club } = fixture();
  assert.throws(() => C.parseClubLibrary(" ".repeat(800000)), /너무 큽/);
  for (const patch of [{ id: "not-uuid" }, { name: "\n" }, { name: "a".repeat(41) }, { slots: {} }, { revision: 0 }]) {
    assert.throws(() => C.parseClubLibrary(JSON.stringify({ artifact_type: "guest-clubs", schema_version: 1, clubs: [{ ...club, ...patch }] })));
  }
});
