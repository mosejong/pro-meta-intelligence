import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("draft save acknowledgements retain newer pending and failed changes", async () => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { createDraftSaveTracker, guardDraftUnload } = await vite.ssrLoadModule("/app/draft-autosave.ts");
    const requests = [];
    const tracker = createDraftSaveTracker((text) => new Promise((resolve, reject) => requests.push({ text, resolve, reject })));
    const listeners = new Map();
    const target = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => {
      assert.equal(listeners.get(name), fn); listeners.delete(name);
    } };
    const unguard = guardDraftUnload(target, tracker);
    function leaveIsBlocked() {
      let blocked = false;
      const event = { preventDefault() { blocked = true; }, returnValue: undefined };
      listeners.get("beforeunload")(event);
      if (blocked) assert.equal(event.returnValue, "");
      return blocked;
    }
    assert.equal(leaveIsBlocked(), false);
    const first = tracker.submit("draft-before-undo");
    assert.equal(leaveIsBlocked(), true, "protection starts before any deferred writer work");
    const second = tracker.submit("draft-after-undo");
    await Promise.resolve();
    assert.deepEqual(requests.map(r => r.text), ["draft-before-undo", "draft-after-undo"]);
    requests[0].resolve(); await first;
    assert.equal(leaveIsBlocked(), true, "old save completion must not clear newer changes");
    requests[1].reject(new Error("quota")); await assert.rejects(second, /quota/);
    assert.equal(leaveIsBlocked(), true, "failed writes remain protected");
    const retry = tracker.submit("empty-reset-series"); await Promise.resolve();
    requests[2].resolve(); await retry;
    assert.equal(leaveIsBlocked(), false);
    const afterUnmount = tracker.submit("draft-before-client-navigation");
    unguard();
    assert.equal(leaveIsBlocked(), true, "client unmount must retain a pending save's guard");
    await Promise.resolve();
    requests[3].reject(new Error("transaction aborted"));
    await assert.rejects(afterUnmount, /transaction aborted/);
    assert.equal(leaveIsBlocked(), true, "failure after unmount stays protected");
    const remountedRetry = tracker.submit("new-screen-recovery");
    await Promise.resolve(); requests[4].resolve(); await remountedRetry;
    assert.equal(listeners.has("beforeunload"), false, "retry completion releases the stale guard");

    const syncFailure = createDraftSaveTracker(() => { throw new Error("storage unavailable"); });
    await assert.rejects(syncFailure.submit("draft"), /storage unavailable/);
    assert.equal(syncFailure.hasUnsavedChanges(), true);
  } finally { await vite.close(); }
});

test("IndexedDB draft writes are serial and continue after a failed transaction", async () => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  const previous = globalThis.indexedDB;
  // Minimal fake: each put() opens a transaction the test completes or aborts by hand.
  const transactions = [];
  const stored = [];
  globalThis.indexedDB = { open() {
    const request = {};
    queueMicrotask(() => {
      request.result = {
        close() {},
        transaction() {
          const tx = { objectStore: () => ({ put(text) { tx.text = text; } }) };
          transactions.push(tx);
          return tx;
        },
      };
      request.onsuccess();
    });
    return request;
  } };
  const settle = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };
  try {
    const { writeLocalDraft } = await vite.ssrLoadModule("/app/draft-session.ts");
    const first = writeLocalDraft("one");
    const second = writeLocalDraft("two");
    const third = writeLocalDraft("three");
    await settle();
    assert.deepEqual(transactions.map((tx) => tx.text), ["one"], "later writes wait for the first transaction");
    transactions[0].error = new Error("quota"); transactions[0].onabort();
    await assert.rejects(first, /quota/);
    await settle();
    assert.deepEqual(transactions.map((tx) => tx.text), ["one", "two"], "a failed write does not block the queue");
    stored.push(transactions[1].text); transactions[1].oncomplete();
    await second; await settle();
    assert.equal(transactions[2].text, "three");
    stored.push(transactions[2].text); transactions[2].oncomplete();
    await third;
    assert.deepEqual(stored, ["two", "three"], "completion order matches submission order");
  } finally {
    globalThis.indexedDB = previous;
    await vite.close();
  }
});

test("draft lab submits saves through useDraftSave without a debounce window (static source check)", async () => {
  // Static evidence only: guards against restoring the old cancellable 300ms timer or
  // leaving the hook commented out. It does not prove browser runtime behaviour.
  const source = await readFile(new URL("../app/draft-lab.tsx", import.meta.url), "utf8");
  assert.match(source, /^\s*const retrySave = useDraftSave\(saveSnapshot, setStorageStatus\);/m, "hook must be called, not commented out");
  // The retry button is user-triggered only and reuses the hook (latest snapshot), never an older text.
  assert.match(source, /storageStatus\.code === "SAVE_FAILED"[\s\S]{0,400}onClick=\{retrySave\} disabled=\{!saveSnapshot\}/);
  assert.equal((source.match(/retrySave/g) ?? []).length, 2, "retry is only wired to the button");
  assert.doesNotMatch(source, /writeLocalDraft/, "lab must not write directly (bypasses the tracker/leave guard)");
  assert.doesNotMatch(source, /PROBE/);
  const memo = source.match(/const saveSnapshot = useMemo\([\s\S]*?\}, \[([^\]]*)\]\);/);
  assert.ok(memo, "save snapshot is memoized");
  assert.doesNotMatch(memo[1], /timer|locale|storageStatus|importStatus|query|studioTab/, "re-renders from these must not resubmit");
  const hook = await readFile(new URL("../app/use-draft-save.ts", import.meta.url), "utf8");
  assert.doesNotMatch(hook, /setTimeout|clearTimeout|setInterval/, "no cancellable debounce or automatic retry timer");
});

test("manual save retry resubmits only the latest snapshot and never loops", async () => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  const settle = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };
  try {
    const { createDraftSaveSession, createDraftSaveTracker, guardDraftUnload } = await vite.ssrLoadModule("/app/draft-autosave.ts");
    const requests = [];
    const tracker = createDraftSaveTracker((text) => new Promise((resolve, reject) => requests.push({ text, resolve, reject })));
    const statuses = [];
    const session = createDraftSaveSession(tracker, (code) => statuses.push(code));
    const listeners = new Map();
    const target = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
    const release = guardDraftUnload(target, tracker);
    const leaveIsBlocked = () => { let blocked = false; listeners.get("beforeunload")?.({ preventDefault() { blocked = true; } }); return blocked; };

    assert.equal(session.retry(), null, "nothing to retry before any save");
    const older = session.submit("draft-1"); await settle();
    const latest = session.submit("draft-2"); await settle();
    assert.equal(session.retry(), null, "retry is a no-op while a write is pending");
    requests[1].reject(new Error("quota")); await assert.rejects(latest, /quota/); await settle();
    assert.equal(statuses.at(-1), "SAVE_FAILED");
    requests[0].resolve(); await older; await settle();
    assert.equal(statuses.at(-1), "SAVE_FAILED", "a superseded write's success cannot hide the latest failure");
    assert.equal(leaveIsBlocked(), true, "failed latest draft keeps leave protection");
    assert.equal(requests.length, 2, "no automatic retry after failure");

    const retried = session.retry();
    assert.ok(retried);
    assert.equal(session.retry(), null, "double click while retrying does not queue a second write");
    await settle();
    assert.deepEqual(requests.map((r) => r.text), ["draft-1", "draft-2", "draft-2"], "retry writes the latest snapshot, never an older one");
    assert.equal(statuses.at(-1), "SAVING");
    assert.equal(leaveIsBlocked(), true, "pending retry stays protected");
    requests[2].resolve(); await retried; await settle();
    assert.equal(statuses.at(-1), "SAVED");
    assert.equal(leaveIsBlocked(), false, "successful retry releases leave protection");
    assert.equal(session.retry(), null, "nothing to retry after success");

    const failedAgain = session.submit("draft-3"); await settle();
    requests[3].reject(new Error("quota")); await assert.rejects(failedAgain, /quota/); await settle();
    assert.equal(session.submit(null), null, "importing/loading: no savable snapshot");
    assert.equal(session.canRetry(), false);
    assert.equal(session.retry(), null, "retry is unavailable while importing/loading");
    assert.equal(requests.length, 4);
    assert.equal(leaveIsBlocked(), true, "the unsaved failure is still protected during import");
    const statusCount = statuses.length;
    await settle();
    assert.equal(statuses.length, statusCount, "status updates alone never trigger more saves");

    release();
    const recovered = session.submit("draft-after-import"); await settle();
    requests[4].resolve(); await recovered; await settle();
    assert.equal(listeners.has("beforeunload"), false, "released guard is removed once the latest draft is saved");
  } finally { await vite.close(); }
});
