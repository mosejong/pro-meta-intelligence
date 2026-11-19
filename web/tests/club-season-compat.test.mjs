import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { before, after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let vite, C, L, current, older, club;
const ROLES = ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"];
const BASE = "https://example.test/app/";
const canonical = (x) => Array.isArray(x) ? x.map(canonical) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canonical(x[k])])) : x;
const digest = (x) => createHash("sha256").update(JSON.stringify(canonical(x)), "utf8").digest("hex");
const refOf = (catalog, card) => ({ catalog_id: catalog.catalog_id, card_id: card.id, player_id: card.player_id });

before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  C = await vite.ssrLoadModule("/app/club-season-compat.ts");
  L = await vite.ssrLoadModule("/app/season-catalog-loader.ts");
  current = JSON.parse(await readFile(new URL("../public/history/season-player-cards.json", import.meta.url), "utf8"));
  // Older but internally valid version: one card fewer, re-hashed. Remaining cards are identical.
  older = structuredClone(current);
  older.cards = older.cards.slice(1);
  older.catalog_id = digest(older.cards);
  assert.notEqual(older.catalog_id, current.catalog_id);
  const players = new Set();
  const seasonSlots = {};
  for (const role of ROLES) {
    const card = older.cards.find((c) => c.role === role && !players.has(c.player_id));
    assert.ok(card, `fixture needs a ${role} card`);
    players.add(card.player_id);
    seasonSlots[role] = role === "SUPPORT" ? null : refOf(older, card);
  }
  club = { id: "00000000-0000-4000-8000-000000000001", revision: 3, name: "테스트", headCoach: "", assistantCoach: "", baseTeamId: "t", basis: { patch_id: "p", cutoff: current.cutoff, fixture_only: false, source_versions: [] }, slots: Object.fromEntries(ROLES.map((r) => [r, null])), seasonSlots, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" };
});
after(async () => { await vite?.close(); });

/** Current catalog where the card behind `role` is replaced by `edit(card)` (not re-verified; the helper is pure). */
function currentWith(role, edit) {
  const next = structuredClone(current);
  const id = club.seasonSlots[role].card_id;
  const i = next.cards.findIndex((c) => c.id === id);
  edit(next.cards[i], next, i);
  next.catalog_id = digest(next.cards);
  return next;
}

test("identical cards switch only catalog_id; input club and catalogs stay untouched", () => {
  const snapshot = structuredClone(club), oldSnap = structuredClone(older), curSnap = structuredClone(current);
  const out = C.migrateClubSeasonSlots(club, older, current);
  assert.notEqual(out, club);
  assert.notEqual(out.seasonSlots, club.seasonSlots);
  for (const role of ROLES) {
    const ref = club.seasonSlots[role];
    if (!ref) { assert.equal(out.seasonSlots[role], null); continue; }
    assert.deepEqual(out.seasonSlots[role], { catalog_id: current.catalog_id, card_id: ref.card_id, player_id: ref.player_id });
  }
  for (const k of ["id", "revision", "createdAt", "updatedAt", "name", "slots", "basis"]) assert.deepEqual(out[k], club[k]);
  assert.deepEqual(club, snapshot);
  assert.deepEqual(older, oldSnap);
  assert.deepEqual(current, curSnap);
});

test("club already on the current catalog is returned as an unchanged copy", () => {
  const onCurrent = structuredClone(club);
  for (const role of ROLES) if (onCurrent.seasonSlots[role]) onCurrent.seasonSlots[role].catalog_id = current.catalog_id;
  const out = C.migrateClubSeasonSlots(onCurrent, null, current);
  assert.deepEqual(out, onCurrent);
  assert.notEqual(out, onCurrent);
  const empty = { ...structuredClone(club), seasonSlots: undefined };
  assert.equal(C.savedSeasonCatalogId(empty), null);
  assert.deepEqual(C.migrateClubSeasonSlots(empty, null, current), empty);
});

test("any content change in the card refuses conversion", () => {
  const edits = {
    "game count": (c) => { c.game_count += 1; c.champions[0].games += 1; },
    "champion counts": (c) => { if (c.champions.length >= 2 && c.champions[0].games > 1) { c.champions[0].games -= 1; c.champions[1].games += 1; } else c.champions[0].champion_id += "x"; },
    "source hash": (c) => { c.source_hashes = [...c.source_hashes, "f".repeat(64)]; },
    "player name": (c) => { c.player_name += " (renamed)"; },
    "team names": (c) => { c.team_names = [...c.team_names, "Other"]; },
    "patches": (c) => { c.patches = [...c.patches, "99.99"]; },
  };
  for (const [label, edit] of Object.entries(edits)) {
    const changed = currentWith("TOP", edit);
    const snapshot = structuredClone(club);
    assert.throws(() => C.migrateClubSeasonSlots(club, older, changed), /달라/, label);
    assert.deepEqual(club, snapshot, label);
  }
});

test("missing card, changed role or changed player identity is refused", () => {
  const missing = currentWith("JUNGLE", (_c, cat, i) => { cat.cards.splice(i, 1); });
  assert.throws(() => C.migrateClubSeasonSlots(club, older, missing), /찾지 못해/);
  const role = currentWith("JUNGLE", (c) => { c.role = "SUPPORT"; });
  assert.throws(() => C.migrateClubSeasonSlots(club, older, role), /찾지 못해/);
  const player = currentWith("JUNGLE", (c) => { c.player_id += "-other"; });
  assert.throws(() => C.migrateClubSeasonSlots(club, older, player), /찾지 못해/);
  // Saved ref whose player_id disagrees with the old catalog card never resolves.
  const forgedRef = structuredClone(club); forgedRef.seasonSlots.MID.player_id += "-x";
  assert.throws(() => C.migrateClubSeasonSlots(forgedRef, older, current));
  // Saved ref placed in another role than its card is refused.
  const moved = structuredClone(club); moved.seasonSlots.SUPPORT = moved.seasonSlots.MID; moved.seasonSlots.MID = null;
  assert.throws(() => C.migrateClubSeasonSlots(moved, older, current));
});

test("mixed catalog versions or a wrong saved catalog are refused", () => {
  const mixed = structuredClone(club); mixed.seasonSlots.TOP.catalog_id = current.catalog_id;
  assert.throws(() => C.savedSeasonCatalogId(mixed), /섞어/);
  assert.throws(() => C.migrateClubSeasonSlots(mixed, older, current), /섞어/);
  assert.throws(() => C.migrateClubSeasonSlots(club, null, current), /확인하지 못해/);
  const otherOld = structuredClone(older); otherOld.catalog_id = "e".repeat(64);
  assert.throws(() => C.migrateClubSeasonSlots(club, otherOld, current), /확인하지 못해/);
});

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const href = String(url); calls.push(href);
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const route = routes[href];
    if (!route) return new Response("not found", { status: 404 });
    return typeof route === "function" ? route(init) : json(route);
  };
  return { calls, fetchImpl };
}
const archiveUrl = (id) => `${BASE}history/catalogs/${id}.json`;
const opts = (fetchImpl) => ({ fetchImpl, baseHref: BASE, timeoutMs: 2000 });

test("preserved loader requests exactly one archive path and verifies it", async () => {
  const { calls, fetchImpl } = fakeFetch({ [archiveUrl(older.catalog_id)]: older });
  const got = await L.loadPreservedSeasonCatalogById("./", older.catalog_id, new AbortController().signal, opts(fetchImpl));
  assert.equal(got.catalog_id, older.catalog_id);
  assert.deepEqual(calls, [archiveUrl(older.catalog_id)]);
});

test("preserved loader rejects invalid ids before any request", async () => {
  for (const id of ["ABC", older.catalog_id.toUpperCase(), "../../evil", "https://evil.test/x", "a".repeat(64) + "/../x", ""]) {
    const { calls, fetchImpl } = fakeFetch({});
    await assert.rejects(L.loadPreservedSeasonCatalogById("./", id, new AbortController().signal, opts(fetchImpl)), /버전 정보/);
    assert.equal(calls.length, 0);
  }
});

test("preserved loader rejects SHA forgery, swapped catalogs and missing archives", async () => {
  const tampered = structuredClone(older); tampered.cards[0].player_name += " forged";
  const a = fakeFetch({ [archiveUrl(older.catalog_id)]: tampered });
  await assert.rejects(L.loadPreservedSeasonCatalogById("./", older.catalog_id, new AbortController().signal, opts(a.fetchImpl)));
  assert.equal(a.calls.length, 1);
  const b = fakeFetch({ [archiveUrl(older.catalog_id)]: current });
  await assert.rejects(L.loadPreservedSeasonCatalogById("./", older.catalog_id, new AbortController().signal, opts(b.fetchImpl)), /정확히 일치/);
  assert.equal(b.calls.length, 1);
  const c = fakeFetch({});
  await assert.rejects(L.loadPreservedSeasonCatalogById("./", older.catalog_id, new AbortController().signal, opts(c.fetchImpl)), /찾지 못했습니다/);
  assert.equal(c.calls.length, 1);
});

test("preserved loader propagates abort", async () => {
  const done = new AbortController(); done.abort();
  const pre = fakeFetch({ [archiveUrl(older.catalog_id)]: older });
  await assert.rejects(L.loadPreservedSeasonCatalogById("./", older.catalog_id, done.signal, opts(pre.fetchImpl)), (e) => e?.name === "AbortError");
  assert.equal(pre.calls.length, 0);
  const controller = new AbortController();
  const mid = fakeFetch({ [archiveUrl(older.catalog_id)]: (init) => new Promise((_, reject) => { init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }); controller.abort(); }) });
  await assert.rejects(L.loadPreservedSeasonCatalogById("./", older.catalog_id, controller.signal, opts(mid.fetchImpl)), (e) => e?.name === "AbortError");
  assert.equal(mid.calls.length, 1);
});
