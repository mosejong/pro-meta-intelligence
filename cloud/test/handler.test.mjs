import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { handleRequest, newCode, normalizeCode, MAX_RAW_BYTES, RATE_LIMITS, TTL_MS } from "../src/handler.mjs";
import { d1Store } from "../src/d1-store.mjs";

/** Minimal D1 facade over node:sqlite so the real SQL in d1-store.mjs is exercised. */
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  return {
    prepare(sql) {
      let args = [];
      const stmt = db.prepare(sql);
      return {
        bind(...values) { args = values; return this; },
        async first() { return stmt.get(...args) ?? null; },
        async run() { const r = stmt.run(...args); return { meta: { changes: Number(r.changes) } }; },
      };
    },
  };
}

const ENV = { ALLOWED_ORIGINS: "https://mosejong.github.io", RATE_SALT: "s" };
const BASE = "https://cloud.example/v1/saves";
const scenario = JSON.stringify({ schema_version: "1", artifact_type: "draft-scenario", selections: ["Ahri"], filler: "x".repeat(200_000) });
const req = (method, path = "", body, headers = {}) => new Request(`${BASE}${path}`, { method, body, headers: { Origin: "https://mosejong.github.io", "CF-Connecting-IP": "1.2.3.4", ...headers } });

function setup() {
  let clock = Date.UTC(2026, 10, 23);
  const store = d1Store(fakeD1());
  let n = 0;
  const deps = { now: () => clock, code: () => n++ === 0 ? "ABCDE-FGHJK" : newCode() };
  return { store, deps, run: (r, env = ENV) => handleRequest(r, env, store, deps), advance: (ms) => { clock += ms; } };
}

test("codes are 10 Crockford characters and normalize common typos", () => {
  const code = newCode();
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  assert.equal(normalizeCode(" abcde fghjk "), "ABCDE-FGHJK");
  assert.equal(normalizeCode("abcdefghjk"), "ABCDE-FGHJK");
  assert.equal(normalizeCode("ooiil-12345"), "00111-12345");
  for (const bad of ["", "ABCD-EFGHJ", "ABCDE-FGHJU", null, 7, "ABCDE-FGHJK-1"]) assert.equal(normalizeCode(bad), null);
});

test("create, read back the exact JSON, update and delete", async () => {
  const { run } = setup();
  const created = await run(req("POST", "", scenario, { "Content-Type": "application/json" }));
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("Access-Control-Allow-Origin"), "https://mosejong.github.io");
  assert.equal(created.headers.get("Cache-Control"), "no-store");
  const { code, expires_at } = await created.json();
  assert.equal(code, "ABCDE-FGHJK");
  assert.equal(Date.parse(expires_at), Date.UTC(2026, 10, 23) + TTL_MS);
  const read = await run(req("GET", "/abcde-fghjk"));
  assert.equal(read.status, 200);
  assert.equal(await read.text(), scenario);
  const updated = await run(req("PUT", `/${code}`, JSON.stringify({ v: 2 })));
  assert.equal(updated.status, 200);
  assert.equal(await (await run(req("GET", `/${code}`))).text(), JSON.stringify({ v: 2 }));
  assert.equal((await run(req("DELETE", `/${code}`))).status, 204);
  assert.equal((await run(req("GET", `/${code}`))).status, 404);
  assert.equal((await run(req("DELETE", `/${code}`))).status, 404);
});

test("only the code hash is stored, and large JSON is compressed", async () => {
  const db = fakeD1();
  const store = d1Store(db);
  await handleRequest(req("POST", "", scenario), ENV, store, { now: () => 0, code: () => "ABCDE-FGHJK" });
  const row = await db.prepare("SELECT code_hash, length(body) AS size, raw_bytes FROM saves").first();
  assert.match(row.code_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(row.code_hash, "ABCDE-FGHJK");
  assert.ok(row.size < row.raw_bytes / 10, `gzip shrinks the repetitive scenario (${row.size} vs ${row.raw_bytes})`);
});

test("expired saves are gone and cannot be updated", async () => {
  const { run, advance } = setup();
  const { code } = await (await run(req("POST", "", scenario))).json();
  advance(TTL_MS);
  assert.equal((await run(req("GET", `/${code}`))).status, 404);
  assert.equal((await run(req("PUT", `/${code}`, "{}"))).status, 404);
});

test("rejects bad input: invalid JSON, non-object, oversize, bad code, wrong method and path", async () => {
  const { run } = setup();
  assert.equal((await run(req("POST", "", "{nope"))).status, 400);
  assert.equal((await run(req("POST", "", "[1,2]"))).status, 400);
  assert.equal((await run(req("POST", "", "x".repeat(MAX_RAW_BYTES + 1)))).status, 413);
  assert.equal((await run(req("GET", "/not-a-code"))).status, 400);
  assert.equal((await run(req("GET", "/ABCDE-FGHJK"))).status, 404);
  assert.equal((await run(req("GET"))).status, 405);
  assert.equal((await run(new Request("https://cloud.example/v1/other", { headers: { "CF-Connecting-IP": "1" } }))).status, 404);
});

test("CORS answers only allowed origins", async () => {
  const { run } = setup();
  assert.equal((await run(req("OPTIONS"))).status, 204);
  const foreign = await run(req("OPTIONS", "", undefined, { Origin: "https://evil.example" }));
  assert.equal(foreign.status, 403);
  const read = await run(req("GET", "/ABCDE-FGHJK", undefined, { Origin: "https://evil.example" }));
  assert.equal(read.headers.get("Access-Control-Allow-Origin"), null);
});

test("writes are rate limited per client per hour", async () => {
  const { run, advance } = setup();
  for (let i = 0; i < RATE_LIMITS.write; i++) assert.notEqual((await run(req("POST", "", "{}"))).status, 429);
  assert.equal((await run(req("POST", "", "{}"))).status, 429);
  assert.equal((await run(req("POST", "", "{}", { "CF-Connecting-IP": "9.9.9.9" }))).status, 201, "other clients unaffected");
  advance(3600 * 1000);
  assert.equal((await run(req("POST", "", "{}"))).status, 201, "a new window resets the count");
});

test("a colliding code is retried with a fresh one", async () => {
  const store = d1Store(fakeD1());
  const codes = ["ABCDE-FGHJK", "ABCDE-FGHJK", "MNPQR-STVWX"];
  const deps = { now: () => 0, code: () => codes.shift() };
  assert.equal((await (await handleRequest(req("POST", "", "{}"), ENV, store, deps)).json()).code, "ABCDE-FGHJK");
  assert.equal((await (await handleRequest(req("POST", "", "{}"), ENV, store, deps)).json()).code, "MNPQR-STVWX");
});

test("cleanup removes expired saves and stale rate windows", async () => {
  const db = fakeD1();
  const store = d1Store(db);
  await handleRequest(req("POST", "", "{}"), ENV, store, { now: () => 0, code: () => "ABCDE-FGHJK" });
  await store.cleanup(TTL_MS + 1);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM saves").first()).n, 0);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM rate_limits").first()).n, 0);
});
