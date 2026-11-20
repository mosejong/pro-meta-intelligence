import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { createServer } from "vite";

let vite, B, L, R, S, agent, report, blue, red, ids, catalog;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false,
    server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  B = await vite.ssrLoadModule("/app/practice-roster-bundle.ts");
  L = await vite.ssrLoadModule("/app/draft-practice-library.ts");
  R = await vite.ssrLoadModule("/app/roster-scenario.ts");
  S = await vite.ssrLoadModule("/app/season-player-cards.ts");
  agent = await vite.ssrLoadModule("/app/draft-agent.ts");
  report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  [blue, red] = report.opponent_prep.teams;
  const fixture = JSON.parse(await readFile(new URL("./fixtures/champion-asset-ids-16.16.1.json", import.meta.url), "utf8"));
  ids = fixture.champions.map(c => c.id);
  catalog = S.parseSeasonCardCatalog(JSON.parse(await readFile(new URL("../public/history/season-player-cards.json", import.meta.url), "utf8")));
  await S.verifySeasonCardIntegrity(catalog);
});
after(async () => { await vite?.close(); });

/** Tiny in-memory IndexedDB (single tab): staged writes committed atomically on completion. */
function fakeIDB() {
  const databases = new Map();
  const later = fn => setTimeout(fn, 0);
  const factory = { open(name, version) {
    const request = { result: undefined, transaction: { abort() {} } };
    later(() => {
      let db = databases.get(name);
      const upgrade = !db;
      if (!db) { db = { version, stores: new Map() }; databases.set(name, db); }
      request.result = {
        objectStoreNames: { contains: s => db.stores.has(s) },
        createObjectStore(s, o = {}) { db.stores.set(s, { keyPath: o.keyPath ?? null, data: new Map() }); },
        close() {},
        transaction(names, mode) {
          const staged = new Map(names.map(n => [n, new Map([...db.stores.get(n).data].map(([k, v]) => [k, structuredClone(v)]))]));
          const queue = []; let finished = false;
          const tx = { error: null, abort() { finished = true; later(() => tx.onabort?.()); },
            objectStore(s) {
              const { keyPath } = db.stores.get(s);
              const req = run => { const r = {}; queue.push(() => { r.result = run(staged.get(s)); r.onsuccess?.(); }); return r; };
              return { get: k => req(t => structuredClone(t.get(k))), getAll: () => req(t => [...t.values()].map(v => structuredClone(v))),
                delete: k => req(t => { t.delete(k); }), add: (v, k) => req(t => { t.set(keyPath ? v[keyPath] : k, structuredClone(v)); }) };
            } };
          later(function step() {
            if (finished) return;
            const next = queue.shift();
            if (!next) { finished = true; if (mode === "readwrite") for (const [n, d] of staged) db.stores.get(n).data = d; tx.oncomplete?.(); return; }
            next(); later(step);
          });
          return tx;
        },
      };
      if (upgrade) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  } };
  return { factory, databases };
}

let seq = 0;
const make = idb => L.createPracticeLibrary({ indexedDB: () => idb.factory, timeoutMs: 500,
  newId: () => `season-${String(++seq).padStart(4, "0")}`, now: () => new Date(Date.UTC(2026, 10, 19, 1, 0, seq)) });
const code = async p => { try { await p; return "OK"; } catch (e) { return e.code ?? e.message; } };
const scenarios = idb => idb.databases.get(L.PRACTICE_DB_NAME).stores.get("scenarios").data;

function draftText() {
  let selections = [];
  for (const id of ids.slice(0, 6)) selections = agent.applyDraftSelection(selections, id, [], "BLUE");
  return agent.serializeDraftScenario(report, blue, red, selections, [], null, "BLUE", null);
}
const teamIds = () => [blue.team_id, red.team_id].sort();
const refOf = card => ({ catalog_id: catalog.catalog_id, card_id: card.id, player_id: card.player_id });

/**
 * Fixture: observed current rosters with one blue slot emptied and a season card of the same role
 * placed there. Returns current roster text, season part, and helpers.
 */
function fixture() {
  const index = R.buildRosterIndex(report.opponent_prep.teams);
  const rosters = R.observedRosters(report.opponent_prep.teams, teamIds(), index);
  const current = new Set(Object.values(rosters).flatMap(slots => Object.values(slots).filter(Boolean).map(p => p.player_id)));
  const role = R.ROSTER_ROLES.find(r => rosters[blue.team_id][r]) ?? "TOP";
  const card = catalog.cards.find(c => c.role === role && !current.has(c.player_id));
  assert.ok(card, "catalog has a card for the role");
  rosters[blue.team_id][role] = null;
  const lineups = Object.fromEntries(teamIds().map(id => [id, S.emptySeasonSlots()]));
  lineups[blue.team_id][role] = refOf(card);
  const roster = R.serializeRosterScenario({ basis: R.rosterBasis(report), team_ids: teamIds(), rosters }, index);
  const season = { catalog_id: catalog.catalog_id, cutoff: catalog.cutoff, lineups };
  return { index, rosters, roster, season, role, card, current };
}

test("season bundle round-trips draft + current roster + season refs; v1 bundle and plain draft still read", async () => {
  const idb = fakeIDB(); const lib = make(idb);
  const text = draftText(); const { roster, season, role, card } = fixture();
  const before = JSON.stringify(season);
  const entry = await lib.save("시즌 포함", text, roster, season);
  assert.equal(entry.schema_version, 3);
  assert.equal(L.entryHasSeason(entry), true); assert.equal(L.entryHasRoster(entry), true);
  assert.equal(JSON.stringify(season), before, "input not mutated");
  const back = await lib.read(entry.id);
  assert.deepEqual(back.season, season);
  assert.equal(back.season.lineups[blue.team_id][role].card_id, card.id);
  assert.equal(R.serializeRosterScenario(back.roster, R.buildRosterIndex(back.session.report.opponent_prep.teams)), roster);
  const stored = JSON.parse(scenarios(idb).get(entry.id));
  assert.deepEqual(Object.keys(stored).sort(), ["artifact_type", "draft", "roster", "schema_version", "season"]);
  assert.equal(stored.schema_version, 2);
  assert.ok(!JSON.stringify(stored.season).includes(card.player_name), "no player names stored in season part");
  const checked = B.verifySeasonPart(back.season, back.roster, catalog);
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.lineups, season.lineups);

  const v1 = await lib.save("현재 선수만", text, roster);
  assert.equal(v1.schema_version, 2);
  assert.equal((await lib.read(v1.id)).season, null);
  const plain = await lib.save("밴픽만", text);
  assert.equal(plain.schema_version, 1);
  const plainBack = await lib.read(plain.id);
  assert.equal(plainBack.roster, null); assert.equal(plainBack.season, null);
  assert.equal((await lib.list()).entries.length, 3);
});

test("catalog mismatch, missing/changed card, wrong role and offline loader never verify", () => {
  const { roster: rosterTextValue, season, role, card } = fixture();
  const roster = B.buildPracticeContent(draftText(), rosterTextValue).roster;
  assert.equal(B.verifySeasonPart(season, roster, null).code, "NO_CATALOG");
  assert.equal(B.verifySeasonPart(season, roster, { ...catalog, catalog_id: "f".repeat(64) }).code, "CATALOG_CHANGED");
  assert.equal(B.verifySeasonPart(season, roster, { ...catalog, cutoff: "2020-01-01T00:00:00Z" }).code, "CATALOG_CHANGED");
  const missing = structuredClone(season); missing.lineups[blue.team_id][role].card_id = "0".repeat(64);
  assert.equal(B.verifySeasonPart(missing, roster, catalog).code, "CARD_MISSING");
  const otherPlayer = structuredClone(season); otherPlayer.lineups[blue.team_id][role].player_id = "someone-else";
  assert.equal(B.verifySeasonPart(otherPlayer, roster, catalog).code, "CARD_MISSING", "player_id must match the card");
  const withoutCard = { ...catalog, cards: catalog.cards.filter(c => c.id !== card.id) };
  assert.equal(B.verifySeasonPart(season, roster, withoutCard).code, "CARD_MISSING");
  assert.match(B.verifySeasonPart(season, roster, null).message, /유지/);
  // Same card in a different role slot (role must match the card's observed role).
  const otherRole = R.ROSTER_ROLES.find(r => r !== role && !roster.rosters[blue.team_id][r]);
  if (otherRole) {
    const moved = structuredClone(season); moved.lineups[blue.team_id][otherRole] = moved.lineups[blue.team_id][role]; moved.lineups[blue.team_id][role] = null;
    assert.equal(B.verifySeasonPart(moved, roster, catalog).code, "CARD_MISSING");
  }
});

test("duplicates across current/season slots and across teams are rejected and nothing is written", async () => {
  const idb = fakeIDB(); const lib = make(idb);
  const text = draftText(); const { rosters, season, role, card, index } = fixture();
  const filledRole = R.ROSTER_ROLES.find(r => r !== role && rosters[blue.team_id][r]);
  assert.ok(filledRole);
  // Season ref in a slot that still holds a current player.
  const sameSlot = structuredClone(season); sameSlot.lineups[blue.team_id][filledRole] = refOf(card); sameSlot.lineups[blue.team_id][role] = null;
  assert.equal(await code(lib.save("겹침1", text, R.serializeRosterScenario({ basis: R.rosterBasis(report), team_ids: teamIds(), rosters }, index), sameSlot)), "INVALID_SEASON");
  // Same season player on both teams.
  const redRole = R.ROSTER_ROLES.find(r => rosters[red.team_id][r]) ?? role;
  const redRosters = structuredClone(rosters); redRosters[red.team_id][redRole] = null;
  const bothTeams = structuredClone(season); bothTeams.lineups[red.team_id][redRole] = refOf(card);
  const redRosterText = R.serializeRosterScenario({ basis: R.rosterBasis(report), team_ids: teamIds(), rosters: redRosters }, index);
  assert.equal(await code(lib.save("겹침2", text, redRosterText, bothTeams)), "INVALID_SEASON");
  // Season ref whose player_id equals a current player (same ID namespace, no name linking).
  const currentPlayer = Object.values(rosters[red.team_id]).find(Boolean);
  if (currentPlayer) {
    const asCurrent = structuredClone(season); asCurrent.lineups[blue.team_id][role] = { ...refOf(card), player_id: currentPlayer.player_id };
    assert.equal(await code(lib.save("겹침3", text, R.serializeRosterScenario({ basis: R.rosterBasis(report), team_ids: teamIds(), rosters }, index), asCurrent)), "INVALID_SEASON");
  }
  // Season without the roster it was checked against.
  assert.equal(B.buildPracticeContent(text, null, season).code, "INVALID_SEASON");
  assert.equal((await lib.list()).entries.length, 0, "nothing written on rejection");
});

test("stored damage, schema confusion, size limit and the 5-item limit are enforced", async () => {
  const idb = fakeIDB(); const lib = make(idb);
  const text = draftText(); const { roster, season } = fixture();
  const good = await lib.save("정상", text, roster, season);
  const stored = JSON.parse(scenarios(idb).get(good.id));
  const tamper = value => scenarios(idb).set(good.id, typeof value === "string" ? value : JSON.stringify(value));
  tamper({ ...stored, season: undefined });
  assert.equal(await code(lib.read(good.id)), "CORRUPT", "v2 envelope requires a season key");
  tamper({ ...stored, season: { ...stored.season, extra: 1 } });
  assert.equal(await code(lib.read(good.id)), "INVALID_SEASON");
  tamper({ ...stored, season: { ...stored.season, catalog_id: "not-a-hash" } });
  assert.equal(await code(lib.read(good.id)), "INVALID_SEASON");
  const mixed = structuredClone(stored.season); const t = Object.keys(mixed.lineups)[0];
  const r = Object.keys(mixed.lineups[t]).find(k => mixed.lineups[t][k]) ?? "TOP";
  if (mixed.lineups[t][r]) { mixed.lineups[t][r].catalog_id = "a".repeat(64); tamper({ ...stored, season: mixed }); assert.equal(await code(lib.read(good.id)), "INVALID_SEASON", "refs must share the part's catalog"); }
  const empty = structuredClone(stored.season); for (const id of Object.keys(empty.lineups)) empty.lineups[id] = S.emptySeasonSlots();
  tamper({ ...stored, season: empty });
  assert.equal(await code(lib.read(good.id)), "INVALID_SEASON", "a season bundle must hold at least one ref");
  tamper({ ...stored, schema_version: 1 });
  assert.equal(await code(lib.read(good.id)), "CORRUPT", "v1 envelope cannot carry season");
  tamper({ artifact_type: stored.artifact_type, schema_version: 1, draft: stored.draft, roster: stored.roster });
  assert.equal(await code(lib.read(good.id)), "CORRUPT", "v3 entry must carry season content");
  tamper("x".repeat(B.MAX_PRACTICE_CONTENT_BYTES + 1));
  assert.equal(await code(lib.read(good.id)), "TOO_LARGE");
  tamper(JSON.stringify(stored));
  assert.equal(await code(lib.read(good.id)), "OK");

  const v2Entry = await lib.save("현재만", text, roster);
  const committed = scenarios(idb);
  committed.set(v2Entry.id, JSON.stringify(stored));
  assert.equal(await code(lib.read(v2Entry.id)), "CORRUPT", "v2 entry must not carry season content");

  const big = { ...season, padding: "x".repeat(B.MAX_SEASON_PART_BYTES) };
  assert.equal(B.buildPracticeContent(text, roster, big).code, "TOO_LARGE");

  for (let i = 0; i < 3; i++) await lib.save(`추가 ${i}`, text, roster, season);
  assert.equal(await code(lib.save("여섯째", text, roster, season)), "LIMIT");
  assert.equal((await lib.list()).entries.length, 5);
  assert.equal(L.parsePracticeEntry({ ...good, summary: { ...good.summary, season: false } }), null, "v3 summary must say season");
});


test("season lineup preserves special team IDs as own keys without changing prototypes", () => {
  const teamIds = ["__proto__", "other"];
  const rosters = Object.fromEntries(teamIds.map(id => [id, S.emptySeasonSlots()]));
  const lineups = Object.fromEntries(teamIds.map(id => [id, S.emptySeasonSlots()]));
  lineups["__proto__"].TOP = { catalog_id: "a".repeat(64), card_id: "b".repeat(64), player_id: "historical-player" };
  const parsed = B.parseSeasonPart({ catalog_id: "a".repeat(64), cutoff: "2026-11-19T00:00:00Z", lineups }, { team_ids: teamIds, rosters });
  assert.ok(parsed);
  assert.ok(Object.hasOwn(parsed.lineups, "__proto__"));
  assert.equal(Object.getPrototypeOf(parsed.lineups), Object.prototype);
  assert.equal(parsed.lineups["__proto__"].TOP.player_id, "historical-player");
});
