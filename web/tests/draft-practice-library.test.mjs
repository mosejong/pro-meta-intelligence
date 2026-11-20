import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { createServer } from "vite";

let vite, L, agent, report, blue, red, ids;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false,
    server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  L = await vite.ssrLoadModule("/app/draft-practice-library.ts");
  agent = await vite.ssrLoadModule("/app/draft-agent.ts");
  report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  [blue, red] = report.opponent_prep.teams;
  const fixture = JSON.parse(await readFile(new URL("./fixtures/champion-asset-ids-16.16.1.json", import.meta.url), "utf8"));
  ids = fixture.champions.map(c => c.id);
});
after(async () => { await vite?.close(); });

/**
 * Minimal in-memory IndexedDB: shared backing per factory (= one device, many tabs),
 * staged transactions committed atomically on completion, readwrite transactions serialized.
 */
function fakeIDB(faults = {}) {
  const databases = new Map();
  let lockTail = Promise.resolve();
  const acquire = () => {
    let release;
    const held = new Promise(r => { release = r; });
    const ready = lockTail.then(() => release);
    lockTail = lockTail.then(() => held);
    return ready;
  };
  const stats = { opened: 0, closed: 0 };
  const later = fn => setTimeout(fn, 0);
  function connection(name) {
    const db = databases.get(name);
    return {
      objectStoreNames: { contains: store => db.stores.has(store) },
      createObjectStore(store, options = {}) { db.stores.set(store, { keyPath: options.keyPath ?? null, data: new Map() }); },
      close() { stats.closed++; },
      transaction(names, mode) {
        const list = Array.isArray(names) ? names : [names];
        for (const n of list) if (!db.stores.has(n)) throw Object.assign(new Error("NotFoundError"), { name: "NotFoundError" });
        // Snapshot is taken when the transaction actually starts (after earlier writers committed).
        let staged = null;
        const snapshot = () => { staged = new Map(list.map(n => [n, new Map([...db.stores.get(n).data].map(([k, v]) => [k, structuredClone(v)]))])); };
        const queue = [];
        let finished = false;
        let release = () => {};
        const tx = { error: null, oncomplete: null, onerror: null, onabort: null,
          abort() { if (finished) throw new Error("InvalidStateError"); finished = true; queue.length = 0; release(); later(() => tx.onabort?.()); },
          objectStore(store) {
            const { keyPath } = db.stores.get(store);
            const req = (run) => { const request = { result: undefined, error: null }; queue.push({ request, op: () => run(staged.get(store)) }); return request; };
            return {
              get: key => req(target => structuredClone(target.get(key))),
              getAll: () => req(target => [...target.values()].map(v => structuredClone(v))),
              count: () => req(target => target.size),
              delete: key => req(target => { target.delete(key); }),
              put: (value, key) => req(target => { target.set(keyPath ? value[keyPath] : key, structuredClone(value)); }),
              add: (value, key) => req(target => {
                if (faults.quotaOnAdd) throw Object.assign(new Error("quota"), { name: "QuotaExceededError" });
                const k = keyPath ? value[keyPath] : key;
                if (target.has(k)) throw Object.assign(new Error("exists"), { name: "ConstraintError" });
                target.set(k, structuredClone(value));
              }),
            };
          } };
        // Readwrite transactions run one at a time across all connections (tabs), like real IDB scopes.
        const start = mode === "readwrite" ? acquire().then(done => { release = done; }) : Promise.resolve();
        start.then(() => { snapshot(); later(function step() {
          if (finished) return;
          if (faults.hangTx) return;
          const next = queue.shift();
          if (!next) {
            finished = true;
            if (mode === "readwrite") for (const [n, data] of staged) db.stores.get(n).data = data;
            release();
            tx.oncomplete?.();
            return;
          }
          try { next.request.result = next.op(); next.request.onsuccess?.(); }
          catch (error) { next.request.error = error; tx.error = error; next.request.onerror?.(); if (!finished) { tx.onerror?.(); finished = true; queue.length = 0; release(); tx.onabort?.(); } return; }
          later(step);
        }); });
        return tx;
      },
    };
  }
  const factory = {
    open(name, version) {
      stats.opened++;
      const request = { result: undefined, error: null, transaction: { abort() {} } };
      later(() => {
        if (faults.hangOpen || faults.blockOpen) { if (faults.blockOpen) request.onblocked?.(); faults.openRequest = request; return; }
        let db = databases.get(name);
        const upgrade = !db || db.version < version;
        if (!db) { db = { version, stores: new Map() }; databases.set(name, db); }
        request.result = connection(name);
        if (upgrade) { db.version = version; request.onupgradeneeded?.(); }
        request.onsuccess?.();
      });
      return request;
    },
  };
  return { factory, databases, stats, faults, connection };
}

const empty = () => ({ TOP: null, JUNGLE: null, MID: null, BOTTOM: null, SUPPORT: null });
function draft(count = 20) {
  let result = [];
  for (const id of ids.slice(0, count)) result = agent.applyDraftSelection(result, id, [], "BLUE");
  return result;
}
function scenario(count = 20, withRole = true) {
  const selections = draft(count);
  const pick = selections.find(s => s.kind === "PICK" && s.side === "BLUE")?.champion_id;
  const positions = withRole && pick ? { [blue.team_id]: { roles: { ...empty(), TOP: pick }, unassigned: [] } } : null;
  return agent.serializeDraftScenario(report, blue, red, selections, [], null, "BLUE", positions);
}
let seq = 0;
const make = (idb, extra = {}) => L.createPracticeLibrary({ indexedDB: () => idb.factory, timeoutMs: 200,
  newId: () => `practice-${String(++seq).padStart(4, "0")}`, now: () => new Date(Date.UTC(2026, 10, 18, 0, 0, seq)), ...extra });
const code = async (promise) => { try { await promise; return "OK"; } catch (error) { return error.code ?? error.message; } };

test("names: trimmed, ≤50 code points, no control/bidi characters, duplicates rejected case/NFC-insensitively", () => {
  const v = L.validatePracticeName;
  assert.deepEqual(v("  결승 1세트  "), { ok: true, name: "결승 1세트" });
  for (const raw of ["", "   ", undefined, 5]) assert.equal(v(raw).ok, false);
  assert.equal(v("가".repeat(50)).ok, true);
  assert.equal(v("가".repeat(51)).code, "NAME_TOO_LONG");
  assert.equal(v("😀".repeat(50)).ok, true, "counts code points, not UTF-16 units");
  for (const bad of ["a\nb", "a\tb", "a\u0000", "a‮b", "a b", "a\u0085b"]) assert.equal(v(bad).code, "NAME_INVALID_CHARS", JSON.stringify(bad));
  assert.equal(v("Gen Final", ["gen final"]).code, "NAME_DUPLICATE");
  assert.equal(v("Café", ["Café"]).code, "NAME_DUPLICATE");
});

test("save resolves after commit; list returns entries; read returns the exact v4 session with positions", async () => {
  const idb = fakeIDB();
  const lib = make(idb);
  const text = scenario();
  const entry = await lib.save(" 연습 A ", text);
  assert.equal(entry.name, "연습 A");
  assert.equal(entry.schema_version, 1);
  assert.equal(entry.summary.positions, true);
  assert.equal(entry.summary.selections, 20);
  const stored = idb.databases.get(L.PRACTICE_DB_NAME);
  assert.equal(stored.stores.get("scenarios").data.get(entry.id), text, "scenario string stored verbatim");
  const { entries, damaged } = await lib.list();
  assert.deepEqual(entries, [entry]);
  assert.deepEqual(damaged, []);
  const { session } = await lib.read(entry.id);
  assert.equal(Object.values(session.positions)[0].roles.TOP, draft(20).find(s => s.kind === "PICK" && s.side === "BLUE").champion_id);
  assert.deepEqual(session.report, report, "frozen snapshot kept, not replaced by newer data");
  assert.equal(agent.serializeDraftScenario(session.report, blue, red, session.selections, session.games, session.stagedChampion, session.firstPickSide, session.positions), text);
  // Existing autosave database is never opened or created.
  assert.equal(idb.databases.has("pro-meta-draft"), false);
  assert.equal(idb.stats.opened, idb.stats.closed);
});

test("limit of 5 and duplicate names never overwrite; damaged entries hold a slot until deleted", async () => {
  const idb = fakeIDB();
  const lib = make(idb);
  const text = scenario(8, false);
  for (let i = 1; i <= 5; i++) await lib.save(`연습 ${i}`, text);
  assert.equal(await code(lib.save("연습 6", text)), "LIMIT");
  const before = (await lib.list()).entries.map(e => e.id);
  assert.equal(before.length, 5);
  await lib.remove(before[0]);
  assert.equal(await code(lib.save("연습 2", text)), "NAME_DUPLICATE");
  assert.equal((await lib.list()).entries.length, 4);
  // A damaged/unsupported record is listed separately, still counts, and is deletable by ID.
  const entries = idb.databases.get(L.PRACTICE_DB_NAME).stores.get("entries").data;
  entries.set("damaged-0001", { schema_version: 99, id: "damaged-0001", name: "x" });
  const listed = await lib.list();
  assert.deepEqual(listed.damaged, ["damaged-0001"]);
  assert.equal(listed.entries.length, 4);
  assert.equal(await code(lib.save("연습 7", text)), "LIMIT");
  assert.equal(await code(lib.read("damaged-0001")), "CORRUPT");
  await lib.remove("damaged-0001");
  assert.equal(await code(lib.save("연습 7", text)), "OK");
});

test("two tabs saving concurrently respect the limit and unique names inside readwrite transactions", async () => {
  const idb = fakeIDB();
  const tabA = make(idb), tabB = make(idb);
  const text = scenario(4, false);
  for (let i = 1; i <= 4; i++) await tabA.save(`기존 ${i}`, text);
  const results = await Promise.all([code(tabA.save("A탭", text)), code(tabB.save("B탭", text))]);
  assert.deepEqual(results.sort(), ["LIMIT", "OK"]);
  assert.equal((await tabB.list()).entries.length, 5);
  await tabA.remove((await tabA.list()).entries[0].id);
  await tabA.remove((await tabA.list()).entries[0].id);
  const same = await Promise.all([code(tabA.save("같은 이름", text)), code(tabB.save("같은 이름", text))]);
  assert.deepEqual(same.sort(), ["NAME_DUPLICATE", "OK"]);
});

test("invalid scenarios, corrupt bodies and quota failures leave the library unchanged", async () => {
  const idb = fakeIDB();
  const lib = make(idb);
  const good = await lib.save("정상", scenario(6, false));
  for (const bad of ["{}", "not json", scenario(8).replace('"schema_version": "4"', '"schema_version": "9"')]) {
    assert.notEqual(bad, scenario(8));
    const error = await lib.save("잘못", bad).catch(e => e);
    assert.equal(error.code, "INVALID_SCENARIO", bad.slice(0, 40));
  }
  assert.equal(await code(lib.save("너무 큼", "x".repeat(16 * 1024 * 1024 + 1))), "TOO_LARGE");
  assert.equal((await lib.list()).entries.length, 1);
  idb.databases.get(L.PRACTICE_DB_NAME).stores.get("scenarios").data.set(good.id, "{broken");
  const error = await lib.read(good.id).catch(e => e);
  assert.equal(error.code, "INVALID_SCENARIO");
  assert.equal(error.sessionCode, "INVALID_JSON");
  idb.databases.get(L.PRACTICE_DB_NAME).stores.get("scenarios").data.delete(good.id);
  assert.equal(await code(lib.read(good.id)), "CORRUPT");
  assert.equal(await code(lib.read("missing-0001")), "NOT_FOUND");
  assert.equal(await code(lib.read("../bad")), "NOT_FOUND");
  idb.faults.quotaOnAdd = true;
  assert.equal(await code(lib.save("공간 부족", scenario(6, false))), "QUOTA");
  const db = idb.databases.get(L.PRACTICE_DB_NAME);
  assert.equal(db.stores.get("entries").data.size, 1, "atomic: no half-written entry");
  assert.equal(db.stores.get("scenarios").data.size, 0);
});

test("hung/blocked opens and hung transactions time out; late successes are closed and never applied", async () => {
  assert.equal(await code(L.createPracticeLibrary({ indexedDB: () => undefined }).list()), "UNAVAILABLE");
  const hung = fakeIDB({ hangOpen: true });
  const lib = make(hung, { timeoutMs: 20 });
  assert.equal(await code(lib.list()), "TIMEOUT");
  // Late open success after the timeout: connection is closed, nothing resolves.
  hung.databases.set(L.PRACTICE_DB_NAME, { version: 1, stores: new Map([["entries", { keyPath: "id", data: new Map() }], ["scenarios", { keyPath: null, data: new Map() }]]) });
  const late = hung.faults.openRequest;
  let closed = false;
  late.result = { close() { closed = true; } };
  late.onsuccess();
  assert.equal(closed, true);
  const blocked = fakeIDB({ blockOpen: true });
  assert.equal(await code(make(blocked).list()), "BLOCKED");
  const stalled = fakeIDB();
  const ok = make(stalled);
  await ok.save("먼저", scenario(4, false));
  stalled.faults.hangTx = true;
  assert.equal(await code(make(stalled, { timeoutMs: 20 }).save("늦은 저장", scenario(4, false))), "TIMEOUT");
  stalled.faults.hangTx = false;
  await new Promise(r => setTimeout(r, 20));
  const names = (await ok.list()).entries.map(e => e.name);
  assert.deepEqual(names, ["먼저"], "aborted late write is not committed");
});

test("load gate: a delayed read cannot apply after the board, context or lock changes (incl. A→B→A)", () => {
  const gate = L.createPracticeLoadGate();
  const empty = JSON.stringify([["p", "c"], "b", "r", "BLUE", [], [], null, null, false, false, true]);
  const staged = JSON.stringify([["p", "c"], "b", "r", "BLUE", [], [], "Ahri", null, false, false, true]);
  gate.observe(empty, false);
  // Codex repro: Open with no work, then stage a champion before the read resolves.
  const click = gate.ticket();
  assert.equal(gate.check(click), "OK");
  gate.observe(staged, false);
  assert.equal(gate.check(click), "BOARD_CHANGED");
  // Unstaging back to the identical board still invalidates the old ticket (revision, not value).
  gate.observe(empty, false);
  assert.equal(gate.check(click), "BOARD_CHANGED");
  // Re-observing the same key/lock (unrelated render, new onLoad identity) does not invalidate.
  const fresh = gate.ticket();
  gate.observe(empty, false);
  gate.observe(empty, false);
  assert.equal(gate.check(fresh), "OK");
  // Confirmed load on a non-empty board, then reset/import/matchup/next game before the read finishes.
  for (const changed of ["reset", "import", "matchup", "lock-mode", "next-game"]) {
    const ticket = gate.ticket();
    gate.observe(`${empty}:${changed}`, false);
    assert.equal(gate.check(ticket), "BOARD_CHANGED", changed);
    gate.observe(empty, false);
  }
  // Room entry, and entry+exit back to the same board, both invalidate.
  const beforeRoom = gate.ticket();
  gate.observe(empty, true);
  assert.equal(gate.check(beforeRoom), "LOCKED");
  assert.equal(gate.check(gate.ticket()), "LOCKED");
  gate.observe(empty, false);
  assert.equal(gate.check(beforeRoom), "LOCK_CHANGED");
  assert.equal(gate.check(gate.ticket()), "OK");
  for (const result of ["LOCKED", "LOCK_CHANGED", "BOARD_CHANGED"]) assert.ok(L.PRACTICE_GATE_TEXT[result].includes("적용하지 않았습니다"));
});
