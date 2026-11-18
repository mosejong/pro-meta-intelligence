import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
let vite, S, C, R, raw, catalog;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  S = await vite.ssrLoadModule("/app/season-player-cards.ts"); C = await vite.ssrLoadModule("/app/guest-club.ts"); R = await vite.ssrLoadModule("/app/roster-scenario.ts");
  raw = JSON.parse(await readFile(new URL("../public/history/season-player-cards.json", import.meta.url), "utf8"));
  catalog = S.parseSeasonCardCatalog(raw);
});
after(async () => { await vite?.close(); });
const nuguri = () => catalog.cards.find(c => c.player_id === "oe:player:f17b90d1dd0f1814bb1f82f77c2f861" && c.season === 2022 && c.role === "TOP");
const refOf = card => ({ catalog_id: catalog.catalog_id, card_id: card.id, player_id: card.player_id });
const basis = { patch_id: "16.20", cutoff: "2026-11-14T00:00:00Z", fixture_only: false, source_versions: [] };
function fixture() {
  const teams = ["blue", "red"].map(team_id => ({ team_id, team_name: team_id, player_profiles: R.ROSTER_ROLES.map(role => ({ player_id: `${team_id}-${role}`, player_name: role, role, roster_status: "CURRENT", game_count: 2 })) }));
  const index = R.buildRosterIndex(teams), state = R.observedRosters(teams, ["blue", "red"], index);
  const club = { id: "12345678-1234-4234-8234-123456789abc", revision: 1, name: "2022 너구리 구단", headCoach: "", assistantCoach: "", baseTeamId: "blue", basis, slots: structuredClone(state.blue), seasonSlots: S.emptySeasonSlots(), createdAt: "2026-11-18T03:00:00Z", updatedAt: "2026-11-18T03:00:00Z" };
  club.slots.TOP = null; club.seasonSlots.TOP = refOf(nuguri());
  return { index, state, club };
}
test("actual offline catalog passes structural and cryptographic integrity; Nuguri has 57 games", async () => {
  await S.verifySeasonCardIntegrity(catalog);
  assert.equal(nuguri().game_count, 57); assert.equal(nuguri().champions.reduce((n, c) => n + c.games, 0), 57);
  assert.deepEqual(catalog.seasons.filter(y => y.status === "LOADED").map(y => y.season), [2022, 2026]);
  assert.equal(catalog.seasons.find(y => y.season === 2015).status, "NOT_LOADED");
  assert.notEqual(catalog.cards, raw.cards);
});
test("hash verification rejects internally plausible card edits and identity substitution", async () => {
  const changed = structuredClone(catalog); changed.cards[0].player_name += " tampered";
  await assert.rejects(S.verifySeasonCardIntegrity(changed), /버전/);
  const identities = structuredClone(catalog); identities.cards[0].id = "0".repeat(64);
  await assert.rejects(S.verifySeasonCardIntegrity(identities));
});
test("invalid source, future retrieval, duplicate card, wrong role, wrong counts reject", () => {
  for (const mutate of [x => x.sources[0].source_id = "unknown", x => x.sources[0].retrieved_at = "2099-01-01T00:00:00Z", x => x.cards.push(x.cards[0]), x => x.cards[0].role = "COACH", x => x.cards[0].game_count++, x => x.cards[0].source_hashes = ["0".repeat(64)], x => x.seasons.find(y => y.season === 2015).status = "LOADED"]) {
    const x = structuredClone(raw); mutate(x); assert.throws(() => S.parseSeasonCardCatalog(x));
  }
});
test("references require exact catalog version, identity and observed role", () => {
  const ref = refOf(nuguri()); assert.equal(S.resolveSeasonRef(ref, "TOP", catalog).player_name, "Nuguri");
  assert.throws(() => S.resolveSeasonRef(ref, "TOP", null), /자료/);
  assert.throws(() => S.resolveSeasonRef({ ...ref, catalog_id: "0".repeat(64) }, "TOP", catalog));
  assert.throws(() => S.resolveSeasonRef(ref, "MID", catalog));
  assert.throws(() => S.resolveSeasonRef({ ...ref, player_id: "different" }, "TOP", catalog));
});
test("v1 clubs read without eager writes; v2 season refs survive roundtrip and legacy cannot disguise them", () => {
  const { club } = fixture(); const old = { ...club }; delete old.seasonSlots;
  const v1 = JSON.stringify({ artifact_type: "guest-clubs", schema_version: 1, clubs: [old] });
  const read = C.parseClubLibrary(v1); assert.equal(read.schema_version, 2); assert.deepEqual(read.clubs[0], old);
  const v2 = C.parseClubLibrary(JSON.stringify({ ...read, clubs: [club] }));
  assert.deepEqual(v2.clubs[0].seasonSlots.TOP, club.seasonSlots.TOP);
  assert.throws(() => C.parseClubLibrary(JSON.stringify({ ...read, schema_version: 1, clubs: [club] })));
});
test("applying season club clears current slot, preserves opponent and refuses stale catalog atomically", () => {
  const { club, state, index } = fixture(); const before = JSON.stringify(state);
  const next = C.applyGuestClub(club, "blue", state, basis, index, catalog);
  assert.equal(next.blue.TOP, null); assert.deepEqual(next.red, state.red); assert.equal(JSON.stringify(state), before);
  assert.throws(() => C.applyGuestClub(club, "blue", state, basis, index, { ...catalog, catalog_id: "0".repeat(64) }));
  assert.throws(() => C.applyGuestClub(club, "blue", state, basis, index, null));
  assert.equal(JSON.stringify(state), before);
});
test("current plus seasonal identity, another season of same player, and opposing seasonal duplicate reject", () => {
  const { club, state, index } = fixture();
  const mixed = structuredClone(club); mixed.slots.TOP = state.blue.TOP;
  assert.throws(() => C.parseClubLibrary(JSON.stringify({ artifact_type: "guest-clubs", schema_version: 2, clubs: [mixed] })));
  const other = S.emptySeasonSlots(); other.TOP = refOf(nuguri());
  assert.throws(() => C.applyGuestClub(club, "blue", state, basis, index, catalog, { red: other }), /다른 자리/);
  const next = structuredClone(state); next.blue.TOP = null; next.red.MID.player_id = nuguri().player_id;
  assert.throws(() => S.validateSeasonLineup(club.seasonSlots, next, "blue", catalog), /다른 자리/);
});
