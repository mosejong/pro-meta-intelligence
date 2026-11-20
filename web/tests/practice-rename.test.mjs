import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { createServer } from "vite";

let vite, L, R, S, agent, report, blue, red, ids, catalog;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false,
    server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  L = await vite.ssrLoadModule("/app/draft-practice-library.ts");
  R = await vite.ssrLoadModule("/app/roster-scenario.ts");
  S = await vite.ssrLoadModule("/app/season-player-cards.ts");
  agent = await vite.ssrLoadModule("/app/draft-agent.ts");
  report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  [blue, red] = report.opponent_prep.teams;
  const fixture = JSON.parse(await readFile(new URL("./fixtures/champion-asset-ids-16.16.1.json", import.meta.url), "utf8"));
  ids = fixture.champions.map(c => c.id);
  catalog = S.parseSeasonCardCatalog(JSON.parse(await readFile(new URL("../public/history/season-player-cards.json", import.meta.url), "utf8")));
});
after(async () => { await vite?.close(); });

/**
 * In-memory IndexedDB shared by several "tabs". Like real IDB, readwrite transactions over the same
 * stores run one at a time (snapshot taken when the transaction starts), and staged writes commit
 * only on completion. `hooks.beforeCommit(tx)` may delay/abort to simulate slow or failing commits.
 */
function fakeIDB(hooks = {}) {
  const databases = new Map();
  const later = fn => setTimeout(fn, 0);
  let writer = Promise.resolve();
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
          let staged = null; const queue = []; let finished = false;
          const tx = { error: null, abort() { if (finished) return; finished = true; later(() => tx.onabort?.()); },
            objectStore(s) {
              const { keyPath } = db.stores.get(s);
              const req = run => { const r = {}; queue.push(() => { r.result = run(staged.get(s)); r.onsuccess?.(); }); return r; };
              const write = (v, k) => req(t => { t.set(keyPath ? v[keyPath] : k, structuredClone(v)); });
              return { get: k => req(t => structuredClone(t.get(k))), getAll: () => req(t => [...t.values()].map(v => structuredClone(v))),
                delete: k => req(t => { t.delete(k); }), add: write, put: write };
            } };
          const start = () => new Promise(done => {
            staged = new Map(names.map(n => [n, new Map([...db.stores.get(n).data].map(([k, v]) => [k, structuredClone(v)]))]));
            later(async function step() {
              if (finished) { done(); return; }
              const next = queue.shift();
              if (next) { next(); later(step); return; }
              if (mode === "readwrite" && hooks.beforeCommit) await hooks.beforeCommit(tx);
              if (finished) { done(); return; }
              finished = true;
              if (mode === "readwrite") for (const [n, d] of staged) db.stores.get(n).data = d;
              tx.oncomplete?.(); done();
            });
          });
          if (mode === "readwrite") writer = writer.then(start); else start();
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
const make = (idb, timeoutMs = 500) => L.createPracticeLibrary({ indexedDB: () => idb.factory, timeoutMs,
  newId: () => `rename-${String(++seq).padStart(4, "0")}`, now: () => new Date(Date.UTC(2026, 10, 19, 2, 0, seq)) });
const code = async p => { try { await p; return "OK"; } catch (e) { return e.code ?? e.message; } };
const store = (idb, s) => idb.databases.get(L.PRACTICE_DB_NAME).stores.get(s).data;
const snapshot = idb => JSON.stringify(["entries", "scenarios"].map(s => [...store(idb, s)].sort()));

function draftText() {
  let selections = [];
  for (const id of ids.slice(0, 6)) selections = agent.applyDraftSelection(selections, id, [], "BLUE");
  return agent.serializeDraftScenario(report, blue, red, selections, [], null, "BLUE", null);
}
const teamIds = () => [blue.team_id, red.team_id].sort();
function rosterAndSeason() {
  const index = R.buildRosterIndex(report.opponent_prep.teams);
  const rosters = R.observedRosters(report.opponent_prep.teams, teamIds(), index);
  const plain = R.serializeRosterScenario({ basis: R.rosterBasis(report), team_ids: teamIds(), rosters }, index);
  const current = new Set(Object.values(rosters).flatMap(slots => Object.values(slots).filter(Boolean).map(p => p.player_id)));
  const role = R.ROSTER_ROLES.find(r => rosters[blue.team_id][r]) ?? "TOP";
  const card = catalog.cards.find(c => c.role === role && !current.has(c.player_id));
  assert.ok(card);
  const seasonRosters = structuredClone(rosters); seasonRosters[blue.team_id][role] = null;
  const lineups = Object.fromEntries(teamIds().map(id => [id, S.emptySeasonSlots()]));
  lineups[blue.team_id][role] = { catalog_id: catalog.catalog_id, card_id: card.id, player_id: card.player_id };
  const seasonRoster = R.serializeRosterScenario({ basis: R.rosterBasis(report), team_ids: teamIds(), rosters: seasonRosters }, index);
  return { plain, seasonRoster, season: { catalog_id: catalog.catalog_id, cutoff: catalog.cutoff, lineups } };
}

test("rename keeps id/created_at/summary/schema/body for v1, v2 (current roster) and v3 (season) entries", async () => {
  const idb = fakeIDB(); const lib = make(idb);
  const text = draftText(); const { plain, seasonRoster, season } = rosterAndSeason();
  const saved = [await lib.save("밴픽만", text), await lib.save("현재 선수", text, plain), await lib.save("시즌 포함", text, seasonRoster, season)];
  assert.deepEqual(saved.map(e => e.schema_version), [1, 2, 3]);
  const readBefore = await Promise.all(saved.map(e => lib.read(e.id)));
  const bodies = saved.map(e => store(idb, "scenarios").get(e.id));
  for (const [i, entry] of saved.entries()) {
    const renamed = await lib.rename(entry.id, `  새 이름 ${i}  `);
    assert.deepEqual(renamed, { ...entry, name: `새 이름 ${i}` });
    assert.deepEqual(store(idb, "entries").get(entry.id), { ...entry, name: `새 이름 ${i}` });
    assert.equal(store(idb, "scenarios").get(entry.id), bodies[i], "stored body byte-identical");
    const back = await lib.read(entry.id);
    assert.deepEqual(back.session, readBefore[i].session);
    assert.deepEqual(back.roster, readBefore[i].roster);
    assert.deepEqual(back.season, readBefore[i].season);
  }
  const { entries, damaged } = await lib.list();
  assert.equal(entries.length, 3); assert.equal(damaged.length, 0);
});

test("own name (exact or case/NFC variant) is allowed; other entries' names are rejected", async () => {
  const idb = fakeIDB(); const lib = make(idb);
  const text = draftText();
  const a = await lib.save("Alpha", text); const b = await lib.save("Café", text);
  const before = snapshot(idb);
  assert.equal((await lib.rename(a.id, "Alpha")).name, "Alpha");
  assert.equal(snapshot(idb), before, "identical name writes nothing");
  assert.equal((await lib.rename(a.id, "ALPHA")).name, "ALPHA", "case change of own name allowed");
  const afterOwn = snapshot(idb);
  for (const dup of ["café", " CAFÉ ", "Café"]) assert.equal(await code(lib.rename(a.id, dup)), "NAME_DUPLICATE", dup);
  assert.equal(await code(lib.rename(b.id, "alpha")), "NAME_DUPLICATE");
  assert.equal(snapshot(idb), afterOwn, "rejected renames change nothing");
});

test("name validation reuses save rules; deleted or malformed ids are NOT_FOUND", async () => {
  const idb = fakeIDB(); const lib = make(idb);
  const a = await lib.save("원래", draftText());
  const before = snapshot(idb);
  assert.equal(await code(lib.rename(a.id, "   ")), "NAME_EMPTY");
  assert.equal(await code(lib.rename(a.id, "가".repeat(L.PRACTICE_NAME_MAX + 1))), "NAME_TOO_LONG");
  assert.equal(await code(lib.rename(a.id, "줄\n바꿈")), "NAME_INVALID_CHARS");
  assert.equal(await code(lib.rename(a.id, "a‮b")), "NAME_INVALID_CHARS");
  assert.equal(await code(lib.rename("bad id!", "새")), "NOT_FOUND");
  assert.equal(await code(lib.rename("rename-9999", "새")), "NOT_FOUND");
  assert.equal(snapshot(idb), before);
  await lib.remove(a.id);
  assert.equal(await code(lib.rename(a.id, "새")), "NOT_FOUND");
  assert.equal(store(idb, "entries").size, 0, "deleted entry is not recreated");
  assert.equal(store(idb, "scenarios").size, 0);
});

test("damaged entry/body is never overwritten with a valid-looking entry", async () => {
  const idb = fakeIDB(); const lib = make(idb);
  const text = draftText();
  const good = await lib.save("정상", text);
  const badSummary = await lib.save("요약 손상", text);
  const badBody = await lib.save("본문 손상", text);
  const noBody = await lib.save("본문 없음", text);
  const noEntry = await lib.save("항목 없음", text);
  store(idb, "entries").get(badSummary.id).summary.selections = 3;
  store(idb, "scenarios").set(badBody.id, "{not json");
  store(idb, "scenarios").delete(noBody.id);
  store(idb, "entries").delete(noEntry.id);
  const before = snapshot(idb);
  assert.equal(await code(lib.rename(badSummary.id, "고침")), "CORRUPT");
  assert.notEqual(await code(lib.rename(badBody.id, "고침")), "OK");
  assert.equal(await code(lib.rename(noBody.id, "고침")), "CORRUPT");
  assert.equal(await code(lib.rename(noEntry.id, "고침")), "CORRUPT");
  assert.equal(snapshot(idb), before, "no damaged item touched");
  // Raw damaged entry with an unparseable shape stays as-is too.
  store(idb, "entries").set("rename-raw-01", { id: "rename-raw-01", name: "x", extra: true });
  store(idb, "scenarios").set("rename-raw-01", text);
  const withRaw = snapshot(idb);
  assert.equal(await code(lib.rename("rename-raw-01", "고침")), "CORRUPT");
  assert.equal(snapshot(idb), withRaw);
  assert.notEqual(before, withRaw);
  // Rename works at the limit (no slot used) and damaged names do not block.
  assert.ok(store(idb, "entries").size >= L.PRACTICE_LIMIT);
  assert.equal((await lib.rename(good.id, "x")).name, "x");
  assert.equal(store(idb, "entries").size, 5);
});

test("concurrent tabs: rename vs save and rename vs rename cannot produce duplicate names", async () => {
  const idb = fakeIDB(); const tabA = make(idb); const tabB = make(idb);
  const text = draftText();
  const a = await tabA.save("하나", text); const b = await tabA.save("둘", text);
  const [r1, s1] = await Promise.all([code(tabA.rename(a.id, "충돌")), code(tabB.save("충돌", text))]);
  assert.deepEqual([r1, s1].sort(), ["NAME_DUPLICATE", "OK"]);
  const [r2, r3] = await Promise.all([code(tabA.rename(a.id, "셋")), code(tabB.rename(b.id, "셋"))]);
  assert.deepEqual([r2, r3].sort(), ["NAME_DUPLICATE", "OK"]);
  const [r4, d4] = await Promise.all([code(tabA.rename(b.id, "넷")), code(tabB.remove(b.id))]);
  const names = (await tabA.list()).entries.map(e => e.name.normalize("NFC").toLowerCase());
  assert.equal(new Set(names).size, names.length, "no duplicate names");
  assert.equal(d4, "OK");
  if (r4 === "OK") assert.equal(store(idb, "entries").has(b.id), false, "remove after rename still removed");
  else assert.equal(r4, "NOT_FOUND");
  assert.equal(store(idb, "scenarios").has(b.id), store(idb, "entries").has(b.id));
});

test("abort and timeout keep the previous name", async () => {
  let mode = "ok";
  const idb = fakeIDB({ beforeCommit: async tx => {
    if (mode === "abort") tx.abort();
    if (mode === "slow") await new Promise(r => setTimeout(r, 1500));
  } });
  const lib = make(idb, 1000);
  const a = await lib.save("원래", draftText());
  const before = snapshot(idb);
  mode = "abort";
  assert.equal(await code(lib.rename(a.id, "실패")), "FAILED");
  assert.equal(snapshot(idb), before);
  mode = "slow";
  assert.equal(await code(lib.rename(a.id, "느림")), "TIMEOUT");
  await new Promise(r => setTimeout(r, 1800));
  assert.equal(snapshot(idb), before, "late commit after timeout is discarded");
  mode = "ok";
  assert.equal((await lib.list()).entries[0].name, "원래");
});
