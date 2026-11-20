import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { createServer } from "vite";

let vite, B, L, R, agent, report, blue, red, other, ids;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false,
    server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  B = await vite.ssrLoadModule("/app/practice-roster-bundle.ts");
  L = await vite.ssrLoadModule("/app/draft-practice-library.ts");
  R = await vite.ssrLoadModule("/app/roster-scenario.ts");
  agent = await vite.ssrLoadModule("/app/draft-agent.ts");
  report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  [blue, red, other] = report.opponent_prep.teams;
  const fixture = JSON.parse(await readFile(new URL("./fixtures/champion-asset-ids-16.16.1.json", import.meta.url), "utf8"));
  ids = fixture.champions.map(c => c.id);
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
  newId: () => `bundle-${String(++seq).padStart(4, "0")}`, now: () => new Date(Date.UTC(2026, 10, 19, 0, 0, seq)) });
const code = async p => { try { await p; return "OK"; } catch (e) { return e.code ?? e.message; } };

function draftText(b = blue, r = red, count = 6) {
  let selections = [];
  for (const id of ids.slice(0, count)) selections = agent.applyDraftSelection(selections, id, [], "BLUE");
  return agent.serializeDraftScenario(report, b, r, selections, [], null, "BLUE", null);
}
function rosterText(teamIds = [blue.team_id, red.team_id], basis = R.rosterBasis(report), mutate) {
  const index = R.buildRosterIndex(report.opponent_prep.teams);
  const sorted = teamIds.slice().sort();
  const rosters = R.observedRosters(report.opponent_prep.teams, sorted, index);
  mutate?.(rosters, index);
  return R.serializeRosterScenario({ basis, team_ids: sorted, rosters }, index);
}

test("legacy v1 entries (plain draft string) still read, with roster null", async () => {
  const idb = fakeIDB();
  const lib = make(idb);
  const text = draftText();
  const entry = await lib.save("옛 연습", text);
  assert.equal(entry.schema_version, 1);
  assert.equal(idb.databases.get(L.PRACTICE_DB_NAME).stores.get("scenarios").data.get(entry.id), text, "legacy stored verbatim");
  const read = await lib.read(entry.id);
  assert.equal(read.roster, null);
  assert.equal(L.entryHasRoster(read.entry), false);
});

test("current-player bundle round-trips draft and roster without mutating inputs", async () => {
  const idb = fakeIDB();
  const lib = make(idb);
  const text = draftText();
  const roster = rosterText();
  const reportBefore = JSON.stringify(report);
  const entry = await lib.save("선수 포함", text, roster);
  assert.equal(entry.schema_version, 2);
  assert.equal(entry.summary.roster, true);
  const { session, roster: back } = await lib.read(entry.id);
  assert.equal(agent.serializeDraftScenario(session.report, blue, red, session.selections, session.games, session.stagedChampion, session.firstPickSide, session.positions ?? null), text);
  const index = R.buildRosterIndex(session.report.opponent_prep.teams);
  assert.equal(R.serializeRosterScenario(back, index), roster, "roster-scenario v1 text unchanged");
  assert.equal(JSON.stringify(report), reportBefore, "report not mutated");
  assert.deepEqual((await lib.list()).entries, [entry]);
});

test("different basis, different pair, duplicate player and damaged roster are rejected as a whole", async () => {
  const idb = fakeIDB();
  const lib = make(idb);
  const text = draftText();
  const badBasis = rosterText(undefined, { ...R.rosterBasis(report), cutoff: "1999-01-01T00:00:00Z" });
  assert.equal(B.buildPracticeContent(text, badBasis).rosterCode, "BASIS_MISMATCH");
  if (other) assert.equal(B.buildPracticeContent(text, rosterText([blue.team_id, other.team_id])).rosterCode, "TEAM_MISMATCH");
  const dup = rosterText(undefined, undefined, rosters => {
    const [a, b] = Object.keys(rosters);
    const player = Object.values(rosters[a]).find(Boolean) ?? Object.values(rosters[b]).find(Boolean);
    assert.ok(player, "fixture has at least one observed player");
    rosters[a].TOP = { ...player }; rosters[b].TOP = { ...player };
  });
  assert.equal(B.buildPracticeContent(text, dup).rosterCode, "DUPLICATE_PLAYER");
  assert.equal(await code(lib.save("나쁨", text, "{not json")), "INVALID_ROSTER");
  assert.equal((await lib.list()).entries.length, 0, "nothing written on rejection");

  // Stored damage: envelope with a broken roster, or metadata disagreeing with content.
  const good = await lib.save("정상", text, rosterText());
  const scenarios = idb.databases.get(L.PRACTICE_DB_NAME).stores.get("scenarios").data;
  const stored = JSON.parse(scenarios.get(good.id));
  scenarios.set(good.id, JSON.stringify({ ...stored, roster: stored.roster.replace('"schema_version": 1', '"schema_version": 7') }));
  assert.equal(await code(lib.read(good.id)), "INVALID_ROSTER");
  scenarios.set(good.id, JSON.stringify({ ...stored, roster: undefined }));
  assert.equal(await code(lib.read(good.id)), "CORRUPT");
  scenarios.set(good.id, text);
  assert.equal(await code(lib.read(good.id)), "CORRUPT", "v2 says roster but content has none");
  const legacy = await lib.save("옛", text);
  // A committed readwrite replaces the fake store's Map; re-fetch so the tamper reaches the store.
  const committed = idb.databases.get(L.PRACTICE_DB_NAME).stores.get("scenarios").data;
  assert.equal(committed.get(legacy.id), text, "legacy entry stored as plain draft");
  committed.set(legacy.id, JSON.stringify(stored));
  assert.equal(await code(lib.read(legacy.id)), "CORRUPT", "v1 entry must not carry a roster");
});
