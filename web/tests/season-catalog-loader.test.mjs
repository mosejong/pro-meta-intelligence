import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { before, after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let vite, L, current, older;
const BASE = "https://example.test/app/";
const ROOT = "./";
const canonical = (x) => Array.isArray(x) ? x.map(canonical) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canonical(x[k])])) : x;
const digest = (x) => createHash("sha256").update(JSON.stringify(canonical(x)), "utf8").digest("hex");

before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  L = await vite.ssrLoadModule("/app/season-catalog-loader.ts");
  current = JSON.parse(await readFile(new URL("../public/history/season-player-cards.json", import.meta.url), "utf8"));
  // A genuinely different, internally valid older version: one fewer card, re-hashed.
  older = structuredClone(current);
  older.cards = older.cards.slice(1);
  older.catalog_id = digest(older.cards);
  assert.notEqual(older.catalog_id, current.catalog_id);
});
after(async () => { await vite?.close(); });

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const href = String(url);
    calls.push(href);
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const route = routes[href];
    if (!route) return new Response("not found", { status: 404 });
    return typeof route === "function" ? route(init) : json(route);
  };
  return { calls, fetchImpl };
}
const CURRENT_URL = `${BASE}history/season-player-cards.json`;
const archiveUrl = (id) => `${BASE}history/catalogs/${id}.json`;
const opts = (fetchImpl) => ({ fetchImpl, baseHref: BASE, timeoutMs: 2000 });
const expectOf = (c) => ({ catalog_id: c.catalog_id, cutoff: c.cutoff });

test("current catalog matching the expected version uses exactly one request", async () => {
  const { calls, fetchImpl } = fakeFetch({ [CURRENT_URL]: current });
  const got = await L.loadPublishedSeasonCatalog(ROOT, new AbortController().signal, expectOf(current), opts(fetchImpl));
  assert.equal(got.catalog_id, current.catalog_id);
  assert.deepEqual(calls, [CURRENT_URL]);
});

test("legacy two-argument call still loads the current catalog with one request", async () => {
  const { calls, fetchImpl } = fakeFetch({ [CURRENT_URL]: current });
  const got = await L.loadPublishedSeasonCatalog(ROOT, new AbortController().signal, undefined, opts(fetchImpl));
  assert.equal(got.catalog_id, current.catalog_id);
  assert.equal(calls.length, 1);
});

test("different current version falls back to the preserved archive with exactly two requests", async () => {
  const { calls, fetchImpl } = fakeFetch({ [CURRENT_URL]: current, [archiveUrl(older.catalog_id)]: older });
  const got = await L.loadPublishedSeasonCatalog(ROOT, new AbortController().signal, expectOf(older), opts(fetchImpl));
  assert.equal(got.catalog_id, older.catalog_id);
  assert.equal(got.cutoff, older.cutoff);
  assert.deepEqual(calls, [CURRENT_URL, archiveUrl(older.catalog_id)]);
});

test("current 404 with a valid expected version falls back once", async () => {
  const { calls, fetchImpl } = fakeFetch({ [archiveUrl(older.catalog_id)]: older });
  const got = await L.loadPublishedSeasonCatalog(ROOT, new AbortController().signal, expectOf(older), opts(fetchImpl));
  assert.equal(got.catalog_id, older.catalog_id);
  assert.deepEqual(calls, [CURRENT_URL, archiveUrl(older.catalog_id)]);
});

test("current 404 without an expected version does not fall back", async () => {
  const { calls, fetchImpl } = fakeFetch({});
  await assert.rejects(L.loadPublishedSeasonCatalog(ROOT, new AbortController().signal, null, opts(fetchImpl)));
  assert.equal(calls.length, 1);
});

test("missing archive and exact cutoff mismatch reject with Korean errors, max two requests", async () => {
  const missing = fakeFetch({ [CURRENT_URL]: current });
  await assert.rejects(L.loadPublishedSeasonCatalog(ROOT, new AbortController().signal, expectOf(older), opts(missing.fetchImpl)), /저장 당시 버전/);
  assert.equal(missing.calls.length, 2);
  const shifted = fakeFetch({ [CURRENT_URL]: current, [archiveUrl(older.catalog_id)]: older });
  await assert.rejects(L.loadPublishedSeasonCatalog(ROOT, new AbortController().signal, { catalog_id: older.catalog_id, cutoff: "2020-01-01T00:00:00Z" }, opts(shifted.fetchImpl)), /정확히 일치/);
  assert.equal(shifted.calls.length, 2);
});

test("invalid hash or timezone-less cutoff rejects before any request", async () => {
  for (const expected of [
    { catalog_id: "ABC", cutoff: current.cutoff },
    { catalog_id: current.catalog_id.toUpperCase(), cutoff: current.cutoff },
    { catalog_id: "0".repeat(63) + "g", cutoff: current.cutoff },
    { catalog_id: current.catalog_id, cutoff: "2026-11-14T00:00:00" },
    { catalog_id: current.catalog_id, cutoff: "not a date Z" },
  ]) {
    const { calls, fetchImpl } = fakeFetch({ [CURRENT_URL]: current });
    await assert.rejects(L.loadPublishedSeasonCatalog(ROOT, new AbortController().signal, expected, opts(fetchImpl)), /버전 정보/);
    assert.equal(calls.length, 0);
  }
});

test("path or remote URL injection through catalog_id is refused without requests", async () => {
  for (const catalog_id of ["../../evil", "https://evil.test/x", "//evil.test/" + "a".repeat(52), "a".repeat(64) + "/../x", "%2e%2e" + "a".repeat(58)]) {
    const { calls, fetchImpl } = fakeFetch({ [CURRENT_URL]: current });
    await assert.rejects(L.loadPublishedSeasonCatalog(ROOT, new AbortController().signal, { catalog_id, cutoff: current.cutoff }, opts(fetchImpl)));
    assert.equal(calls.length, 0);
    assert.ok(calls.every((u) => u.startsWith(BASE)));
  }
});

test("forged archive (tampered cards or mismatched id) is rejected", async () => {
  const tampered = structuredClone(older); tampered.cards[0].player_name += " forged";
  const a = fakeFetch({ [CURRENT_URL]: current, [archiveUrl(older.catalog_id)]: tampered });
  await assert.rejects(L.loadPublishedSeasonCatalog(ROOT, new AbortController().signal, expectOf(older), opts(a.fetchImpl)), /버전/);
  assert.equal(a.calls.length, 2);
  // Serving the valid current catalog under the old archive path must not be accepted.
  const swapped = fakeFetch({ [CURRENT_URL]: current, [archiveUrl(older.catalog_id)]: current });
  await assert.rejects(L.loadPublishedSeasonCatalog(ROOT, new AbortController().signal, expectOf(older), opts(swapped.fetchImpl)), /정확히 일치/);
  // A tampered current catalog is reported, not silently replaced by an archive.
  const badCurrent = structuredClone(current); badCurrent.cards[0].player_name += " forged";
  const c = fakeFetch({ [CURRENT_URL]: badCurrent, [archiveUrl(older.catalog_id)]: older });
  await assert.rejects(L.loadPublishedSeasonCatalog(ROOT, new AbortController().signal, expectOf(older), opts(c.fetchImpl)));
  assert.equal(c.calls.length, 1);
});

test("abort during the current request never issues a fallback request", async () => {
  const controller = new AbortController();
  const { calls, fetchImpl } = fakeFetch({
    [CURRENT_URL]: (init) => new Promise((_, reject) => { init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }); controller.abort(); }),
    [archiveUrl(older.catalog_id)]: older,
  });
  await assert.rejects(L.loadPublishedSeasonCatalog(ROOT, controller.signal, expectOf(older), opts(fetchImpl)), (e) => e?.name === "AbortError");
  assert.deepEqual(calls, [CURRENT_URL]);
  const pre = fakeFetch({ [CURRENT_URL]: current });
  const done = new AbortController(); done.abort();
  await assert.rejects(L.loadPublishedSeasonCatalog(ROOT, done.signal, expectOf(older), opts(pre.fetchImpl)));
  assert.equal(pre.calls.length, 0);
});
