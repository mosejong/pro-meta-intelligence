import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let vite, S;
const previous = globalThis.indexedDB;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  S = await vite.ssrLoadModule("/app/draft-session.ts");
});
after(async () => { globalThis.indexedDB = previous; await vite?.close(); });

test("a hung or blocked database open rejects and closes a late connection", async () => {
  let request;
  let closed = 0;
  globalThis.indexedDB = { open() { request = {}; return request; } };
  await assert.rejects(S.readLocalDraft(10), /open timed out/);
  request.result = { close() { closed++; } };
  request.onsuccess();
  assert.equal(closed, 1);
  const blocked = S.readLocalDraft(100);
  request.onblocked();
  await assert.rejects(blocked, /blocked/);
  request.result = { close() { closed++; } };
  request.onsuccess();
  assert.equal(closed, 2);
});

test("a hung read aborts its transaction and closes its database", async () => {
  let aborted = 0, closed = 0;
  globalThis.indexedDB = { open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { close() { closed++; }, transaction() {
        return { objectStore: () => ({ get: () => ({}) }), abort() { aborted++; this.onabort?.(); } };
      } };
      request.onsuccess();
    });
    return request;
  } };
  await assert.rejects(S.readLocalDraft(10), /read timed out/);
  assert.equal(aborted, 1);
  assert.equal(closed, 1);
});

test("a timed out write cannot permanently block later writes", async () => {
  const stored = [];
  let aborted = 0, closed = 0;
  globalThis.indexedDB = { open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { close() { closed++; }, transaction() {
        const tx = { objectStore: () => ({ put(text) {
          if (text === "retry") queueMicrotask(() => { stored.push(text); tx.oncomplete(); });
        }, delete() { /* board-only writes also clear the review sidecar in the same transaction */ } }), abort() { aborted++; this.onabort?.(); } };
        return tx;
      } };
      request.onsuccess();
    });
    return request;
  } };
  const timedOut = S.writeLocalDraft("hung", 10);
  const retry = S.writeLocalDraft("retry", 100);
  await assert.rejects(timedOut, /write timed out/);
  await retry;
  assert.deepEqual(stored, ["retry"]);
  assert.equal(aborted, 1);
  assert.equal(closed, 2);
});
