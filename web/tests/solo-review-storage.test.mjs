import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Stage 2: atomic board + review sidecar storage helpers only (no UI wiring yet).
let vite, S, codec;
const previous = globalThis.indexedDB;
const REAL_TIMEOUT = globalThis.setTimeout, REAL_CLEAR = globalThis.clearTimeout;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  S = await vite.ssrLoadModule("/app/draft-session.ts");
  codec = await vite.ssrLoadModule("/app/solo-review-retention.ts");
});
after(async () => { globalThis.indexedDB = previous; await vite?.close(); });

const sleep = ms => new Promise(resolve => REAL_TIMEOUT(resolve, ms));
const quotaError = () => Object.assign(new Error("quota exceeded"), { name: "QuotaExceededError" });
const putsReview = tx => tx.ops.some(([op, key]) => op === "put" && key === S.SOLO_REVIEW_KEY);
const putsBoard = value => tx => tx.ops.some(([op, key, v]) => op === "put" && key === "current" && v === value);

/**
 * Fake IndexedDB that models transaction atomicity: put/delete only queue operations; the persistent map
 * changes at commit (a later macrotask) or never (abort). Abort/complete/error events are asynchronous.
 */
function install({ data = [], quota = () => false, hang = () => false, failGet = [], open = "ok" } = {}) {
  const s = { data: new Map(data), txns: [], opens: [], closed: 0, overlap: false, commits: [], request: null, db: null };
  s.db = {
    close() { s.closed++; },
    transaction(store, mode) {
      if (s.txns.some(t => !t.done && !t.aborted)) s.overlap = true;
      const tx = { store, mode, ops: [], done: false, aborted: false, error: null };
      s.txns.push(tx);
      const abort = error => {
        if (tx.done || tx.aborted) return;
        tx.aborted = true; tx.error = error;
        queueMicrotask(() => tx.onabort?.());
      };
      tx.abort = () => abort(null);
      const writable = () => { if (mode !== "readwrite") throw new Error("ReadOnlyError"); };
      tx.objectStore = name => {
        assert.equal(name, "sessions");
        return {
          get(key) {
            const req = {};
            tx.ops.push(["get", key]);
            queueMicrotask(() => {
              if (tx.aborted) return;
              if (failGet.includes(key)) {
                req.error = new Error(`get ${key} failed`);
                let prevented = false;
                req.onerror?.({ preventDefault() { prevented = true; } });
                if (!prevented) { tx.error = req.error; tx.onerror?.(); abort(req.error); }
                return;
              }
              req.result = s.data.get(key);
              req.onsuccess?.();
            });
            return req;
          },
          put(value, key) { writable(); tx.ops.push(["put", key, value]); return {}; },
          delete(key) { writable(); tx.ops.push(["delete", key]); return {}; },
        };
      };
      REAL_TIMEOUT(() => {
        if (tx.aborted || tx.done || hang(tx)) return;
        if (mode === "readwrite" && quota(tx)) { const error = quotaError(); tx.error = error; tx.onerror?.(); abort(error); return; }
        for (const [op, key, value] of tx.ops) { if (op === "put") s.data.set(key, value); else if (op === "delete") s.data.delete(key); }
        tx.done = true; s.commits.push(tx);
        tx.oncomplete?.();
      }, 1);
      return tx;
    },
  };
  globalThis.indexedDB = { open(name, version) {
    s.opens.push([name, version]);
    const request = {}; s.request = request;
    if (open === "ok") queueMicrotask(() => { request.result = s.db; request.onsuccess(); });
    if (open === "blocked") queueMicrotask(() => request.onblocked());
    return request;
  } };
  return s;
}

/** Counts timers the module creates and leaves pending. */
async function withTimers(run) {
  const live = new Set();
  globalThis.setTimeout = (fn, ms, ...args) => { const id = REAL_TIMEOUT(() => { live.delete(id); fn(...args); }, ms); live.add(id); return id; };
  globalThis.clearTimeout = id => { live.delete(id); REAL_CLEAR(id); };
  try { await run(); } finally { globalThis.setTimeout = REAL_TIMEOUT; globalThis.clearTimeout = REAL_CLEAR; }
  return live.size;
}

test("constants: existing DB/store/key unchanged; sidecar bound equals the codec bound", async () => {
  assert.equal(S.SOLO_REVIEW_KEY, "current-solo-review");
  assert.equal(S.SOLO_REVIEW_STORAGE_MAX_BYTES, codec.MAX_SOLO_REVIEW_BYTES);
  const s = install({ data: [["current", "board"]] });
  assert.equal(await S.readLocalDraft(100), "board", "existing reader unchanged");
  await S.writeLocalDraftWithReview("b", "r", 100);
  assert.deepEqual(s.opens, [["pro-meta-draft", 1], ["pro-meta-draft", 1]]);
  assert.ok(s.txns.every(tx => tx.store === "sessions"));
});

test("pair read: one readonly transaction, both keys, resolves only after completion, closes", async () => {
  const s = install({ data: [["current", "board"], [S.SOLO_REVIEW_KEY, "review"]] });
  const leaked = await withTimers(async () => assert.deepEqual(await S.readLocalDraftWithReview(100), { scenario: "board", review: "review" }));
  assert.equal(leaked, 0);
  assert.equal(s.txns.length, 1);
  assert.equal(s.txns[0].mode, "readonly");
  assert.deepEqual(s.txns[0].ops, [["get", "current"], ["get", S.SOLO_REVIEW_KEY]]);
  assert.equal(s.closed, 1);

  // Both gets succeed but the transaction never completes: no early resolve, deadline aborts and closes.
  const hung = install({ data: [["current", "board"]], hang: () => true });
  await assert.rejects(S.readLocalDraftWithReview(20), /read timed out/);
  assert.equal(hung.txns[0].aborted, true);
  assert.equal(hung.closed, 1);
});

test("pair read: missing, non-string, oversized or unreadable review is dropped; the board still returns", async () => {
  const max = S.SOLO_REVIEW_STORAGE_MAX_BYTES;
  const cases = [
    [[["current", "b"]], null], [[["current", "b"], [S.SOLO_REVIEW_KEY, { x: 1 }]], null], [[["current", "b"], [S.SOLO_REVIEW_KEY, ""]], null],
    [[["current", "b"], [S.SOLO_REVIEW_KEY, "a".repeat(max)]], "a".repeat(max)], [[["current", "b"], [S.SOLO_REVIEW_KEY, "a".repeat(max + 1)]], null],
    // String length under the limit, UTF-8 bytes over it.
    [[["current", "b"], [S.SOLO_REVIEW_KEY, "가".repeat(Math.floor(max / 3) + 1)]], null],
  ];
  for (const [data, review] of cases) {
    install({ data });
    assert.deepEqual(await S.readLocalDraftWithReview(100), { scenario: "b", review });
  }
  install({ data: [[S.SOLO_REVIEW_KEY, "orphan"]] });
  assert.deepEqual(await S.readLocalDraftWithReview(100), { scenario: null, review: "orphan" }, "opaque: caller decides");
  const s = install({ data: [["current", "b"], [S.SOLO_REVIEW_KEY, "r"]], failGet: [S.SOLO_REVIEW_KEY] });
  assert.deepEqual(await S.readLocalDraftWithReview(100), { scenario: "b", review: null }, "sidecar read error does not block the board");
  assert.equal(s.txns[0].aborted, false);
  const board = install({ data: [["current", "b"]], failGet: ["current"] });
  await assert.rejects(S.readLocalDraftWithReview(100), /get current failed/);
  assert.equal(board.closed, 1);
});

test("pair write: one readwrite transaction; null/empty/invalid/oversized review deletes, never truncates", async () => {
  const s = install({ data: [[S.SOLO_REVIEW_KEY, "old"]] });
  await S.writeLocalDraftWithReview("board", "review", 100);
  assert.equal(s.txns.length, 1);
  assert.equal(s.txns[0].mode, "readwrite");
  assert.deepEqual(s.txns[0].ops, [["put", "current", "board"], ["put", S.SOLO_REVIEW_KEY, "review"]]);
  assert.equal(s.data.get("current"), "board");
  assert.equal(s.data.get(S.SOLO_REVIEW_KEY), "review");
  const max = S.SOLO_REVIEW_STORAGE_MAX_BYTES;
  for (const review of [null, "", 7, { text: "x" }, "a".repeat(max + 1), "가".repeat(Math.floor(max / 3) + 1)]) {
    const t = install({ data: [["current", "old"], [S.SOLO_REVIEW_KEY, "old"]] });
    await S.writeLocalDraftWithReview("board", review, 100);
    assert.deepEqual(t.txns.map(tx => tx.ops), [[["put", "current", "board"], ["delete", S.SOLO_REVIEW_KEY]]]);
    assert.equal(t.data.has(S.SOLO_REVIEW_KEY), false, "removed, not truncated");
    assert.equal(t.data.get("current"), "board");
    assert.equal(t.closed, 1);
  }
});

test("existing writeLocalDraft clears the sidecar atomically, even for identical board bytes", async () => {
  const s = install({ data: [["current", "same"], [S.SOLO_REVIEW_KEY, "stale reasons"]] });
  await S.writeLocalDraft("same", 100);
  assert.deepEqual(s.txns.map(tx => tx.ops), [[["put", "current", "same"], ["delete", S.SOLO_REVIEW_KEY]]]);
  assert.equal(s.data.get("current"), "same");
  assert.equal(s.data.has(S.SOLO_REVIEW_KEY), false);
  // Board-only writes never fall back: a quota abort rejects and leaves storage untouched.
  const q = install({ data: [["current", "old"], [S.SOLO_REVIEW_KEY, "r"]], quota: () => true });
  await assert.rejects(S.writeLocalDraft("new", 100), /quota/);
  assert.equal(q.txns.length, 1);
  assert.deepEqual([...q.data], [["current", "old"], [S.SOLO_REVIEW_KEY, "r"]]);
});

test("one queue across both write APIs: invocation order, no overlap, failure does not block later writes", async () => {
  const s = install({ quota: putsBoard("B") });
  const a = S.writeLocalDraftWithReview("A", "ra", 100);
  const b = S.writeLocalDraft("B", 100);
  const c = S.writeLocalDraftWithReview("C", "rc", 100);
  const d = S.writeLocalDraft("D", 100);
  const e = S.writeLocalDraftWithReview("E", "re", 100);
  await a;
  await assert.rejects(b, /quota/);
  await c; await d; await e;
  assert.deepEqual(s.commits.map(tx => tx.ops[0][2]), ["A", "C", "D", "E"]);
  assert.deepEqual(s.txns.map(tx => tx.ops[0][2]), ["A", "B", "C", "D", "E"]);
  assert.equal(s.overlap, false);
  assert.equal(s.data.get("current"), "E");
  assert.equal(s.data.get(S.SOLO_REVIEW_KEY), "re");
  assert.equal(s.closed, 5);
});

test("quota abort with a review: original rolls back, then exactly one board-only fallback after the abort", async () => {
  const s = install({ data: [["current", "old"], [S.SOLO_REVIEW_KEY, "old reasons"]], quota: putsReview });
  const leaked = await withTimers(() => S.writeLocalDraftWithReview("new", "new reasons", 100));
  assert.equal(leaked, 0);
  assert.equal(s.txns.length, 2);
  assert.equal(s.txns[0].aborted, true);
  assert.equal(s.overlap, false, "fallback starts only after the original transaction aborted");
  assert.deepEqual(s.txns[1].ops, [["put", "current", "new"], ["delete", S.SOLO_REVIEW_KEY]]);
  assert.equal(s.data.get("current"), "new");
  assert.equal(s.data.has(S.SOLO_REVIEW_KEY), false, "old reasons never survive next to the new board");
  assert.equal(s.closed, 1);

  // Fallback failure rejects; nothing was committed; no third transaction.
  const f = install({ data: [["current", "old"], [S.SOLO_REVIEW_KEY, "old reasons"]], quota: () => true });
  await assert.rejects(S.writeLocalDraftWithReview("new", "new reasons", 100), /quota/);
  await sleep(10);
  assert.equal(f.txns.length, 2);
  assert.deepEqual([...f.data], [["current", "old"], [S.SOLO_REVIEW_KEY, "old reasons"]]);
  assert.equal(f.closed, 1);
});

test("deadline: aborts, closes, clears timers, no fallback or late writes, stale callbacks ignored", async () => {
  const s = install({ data: [["current", "old"]], hang: () => true });
  let result;
  const leaked = await withTimers(async () => { result = await S.writeLocalDraftWithReview("new", "r", 20).then(() => "ok", e => e); });
  assert.match(String(result), /write timed out/);
  assert.equal(leaked, 0);
  assert.equal(s.txns.length, 1, "a deadline never launches the fallback");
  assert.equal(s.txns[0].aborted, true);
  assert.equal(s.closed, 1);
  s.txns[0].oncomplete?.(); s.txns[0].onabort?.(); // stale late callbacks
  await sleep(10);
  assert.equal(s.txns.length, 1);
  assert.deepEqual([...s.data], [["current", "old"]]);

  // Deadline during the fallback: shared bound, both aborted, no third transaction.
  const f = install({ data: [["current", "old"]], quota: putsReview, hang: tx => !putsReview(tx) });
  const started = Date.now();
  await assert.rejects(S.writeLocalDraftWithReview("new", "r", 40), /write timed out/);
  assert.ok(Date.now() - started < 40 + 200, "one transaction deadline covers the fallback");
  await sleep(10);
  assert.equal(f.txns.length, 2);
  assert.ok(f.txns.every(tx => tx.aborted));
  assert.deepEqual([...f.data], [["current", "old"]]);
  assert.equal(f.closed, 1);
  // The queue is not stuck afterwards.
  install();
  await S.writeLocalDraft("after", 100);
});

test("open blocked or hung: rejects, no transactions, late connection closed, no timers left", async () => {
  const blocked = install({ open: "blocked" });
  const leaked = await withTimers(async () => {
    await assert.rejects(S.writeLocalDraftWithReview("b", "r", 100), /blocked/);
    await assert.rejects(S.readLocalDraftWithReview(100), /blocked/);
  });
  assert.equal(leaked, 0);
  assert.equal(blocked.txns.length, 0);
  const hung = install({ open: "hang" });
  await assert.rejects(S.writeLocalDraftWithReview("b", "r", 10), /open timed out/);
  hung.request.result = hung.db; hung.request.onsuccess();
  assert.equal(hung.closed, 1);
  await sleep(10);
  assert.equal(hung.txns.length, 0, "no delayed write after the open deadline");
});
