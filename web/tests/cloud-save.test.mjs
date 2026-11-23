import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
let vite, client, panel, worker;
before(async () => {
  vite = await createServer({ root: webRoot, configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  client = await vite.ssrLoadModule("/app/cloud-save.ts");
  panel = await vite.ssrLoadModule("/app/cloud-save-panel.tsx");
  worker = await import(new URL("../../cloud/src/handler.mjs", import.meta.url).href);
});
after(async () => { await vite?.close(); });

/** In-memory store with the worker's store contract, and a fetch that calls the real handler. */
function workerFetch() {
  const rows = new Map(), hits = new Map();
  const store = {
    async get(h) { return rows.get(h) ?? null; },
    async put(r) { if (rows.has(r.code_hash)) return false; rows.set(r.code_hash, r); return true; },
    async update(h, r) { const row = rows.get(h); if (!row || row.expires_at <= r.now) return false; rows.set(h, { ...row, ...r }); return true; },
    async remove(h) { return rows.delete(h); },
    async hit(b, w, limit) { const k = `${b}|${w}`; hits.set(k, (hits.get(k) ?? 0) + 1); return hits.get(k) <= limit; },
  };
  const env = { ALLOWED_ORIGINS: "https://mosejong.github.io" };
  return (url, init) => worker.handleRequest(new Request(url, { ...init, headers: { ...init?.headers, Origin: "https://mosejong.github.io", "CF-Connecting-IP": "1.1.1.1" } }), env, store);
}

test("endpoint accepts https or loopback only", () => {
  assert.equal(client.cloudSaveEndpoint("https://save.example.workers.dev/"), "https://save.example.workers.dev");
  assert.equal(client.cloudSaveEndpoint("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
  for (const bad of [undefined, "", "http://save.example", "https://u:p@save.example", "https://save.example/?x=1", "javascript:alert(1)", 5]) {
    assert.equal(client.cloudSaveEndpoint(bad), null, String(bad));
  }
});

test("codes normalize like the worker", () => {
  assert.equal(client.normalizeCloudCode("abcde fghjk"), "ABCDE-FGHJK");
  assert.equal(client.normalizeCloudCode("oiL23-45678"), "01123-45678");
  assert.equal(client.normalizeCloudCode("ABCDE-FGHJU"), null);
  for (const code of ["ABCDE-FGHJK", "abcde-fghjk", "00111-12345"]) assert.equal(client.normalizeCloudCode(code), worker.normalizeCode(code));
});

test("upload then download returns the exact scenario text through the real handler", async () => {
  const fetchImpl = workerFetch();
  const text = JSON.stringify({ schema_version: "1", selections: ["Ahri", "Vi"], note: "한글" });
  const up = await client.uploadCloudSave(text, "https://save.example", fetchImpl);
  assert.equal(up.ok, true);
  assert.match(up.code, /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  const down = await client.downloadCloudSave(up.code.toLowerCase(), "https://save.example", fetchImpl);
  assert.deepEqual(down, { ok: true, text });
  assert.deepEqual(await client.downloadCloudSave("ZZZZZ-ZZZZZ", "https://save.example", fetchImpl), { ok: false, error: "NOT_FOUND" });
});

test("errors map to stable codes and never throw", async () => {
  assert.deepEqual(await client.uploadCloudSave("{}", null), { ok: false, error: "NOT_CONFIGURED" });
  assert.deepEqual(await client.downloadCloudSave("nope", "https://save.example", async () => { throw new Error("x"); }), { ok: false, error: "INVALID_CODE" });
  assert.deepEqual(await client.uploadCloudSave("{}", "https://save.example", async () => { throw new Error("offline"); }), { ok: false, error: "NETWORK" });
  assert.deepEqual(await client.uploadCloudSave("{}", "https://save.example", async () => new Response("{}", { status: 429 })), { ok: false, error: "RATE_LIMITED" });
  assert.deepEqual(await client.uploadCloudSave("{}", "https://save.example", async () => new Response("{\"code\":\"bad\"}", { status: 201 })), { ok: false, error: "SERVER" });
  assert.deepEqual(await client.uploadCloudSave("x".repeat(client.CLOUD_SAVE_MAX_BYTES + 1), "https://save.example", async () => { throw new Error("not called"); }), { ok: false, error: "TOO_LARGE" });
});

test("panel renders nothing without an endpoint and the controls with one", () => {
  const props = { getScenario: () => null, onLoad: async () => false, disabled: false };
  assert.equal(renderToStaticMarkup(createElement(panel.CloudSavePanel, { ...props, endpoint: null })), "");
  const html = renderToStaticMarkup(createElement(panel.CloudSavePanel, { ...props, endpoint: "https://save.example" }));
  assert.match(html, /다른 기기에서 이어하기/);
  assert.match(html, /코드 만들기/);
  assert.match(html, /코드로 불러오기/);
});
