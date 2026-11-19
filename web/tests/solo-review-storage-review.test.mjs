import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

test("writer queue waits for terminal abort after a bubbled request error", async () => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  const previous = globalThis.indexedDB;
  const transactions = [];
  globalThis.indexedDB = { open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { close() {}, transaction() {
        const tx = { objectStore: () => ({ put() {}, delete() {} }), abort() {} };
        transactions.push(tx);
        return tx;
      } };
      request.onsuccess();
    });
    return request;
  } };
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  let first, second;
  try {
    const storage = await vite.ssrLoadModule("/app/draft-session.ts");
    first = storage.writeLocalDraft("one", 1000);
    first.catch(() => {});
    second = storage.writeLocalDraft("two", 1000);
    second.catch(() => {});
    await flush();
    assert.equal(transactions.length, 1);
    const tx = transactions[0];
    tx.error = new Error("request failed");
    tx.onerror();
    await flush();
    assert.equal(transactions.length, 1, "request error is not terminal; next writer must wait for abort");
    tx.onabort();
    await assert.rejects(first, /request failed/);
    await flush();
    assert.equal(transactions.length, 2);
    transactions[1].oncomplete();
    await second;
  } finally {
    for (const tx of transactions) tx.onabort?.();
    await Promise.allSettled([first, second].filter(Boolean));
    globalThis.indexedDB = previous;
    await vite.close();
  }
});
