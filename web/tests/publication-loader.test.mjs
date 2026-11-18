import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let vite;
let L;
const feed = {};
const files = ["current.json", "collection-status.json", "current-creator.json", "history-status.json",
  "decision-outcomes.json", "ai-validation.json", "schedule.json", "schedule-changes.json"];

before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  L = await vite.ssrLoadModule("/app/publication-loader.ts");
  for (const file of files) feed[file] = JSON.parse(await readFile(new URL(`../public/feed/${file}`, import.meta.url), "utf8"));
});
after(async () => { await vite?.close(); });

const base = new URL("https://example.test/pro-meta-intelligence/");
const never = () => new Promise(() => {});
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) });

/** Route map: file -> body | { status } | "hang-headers" | "hang-body" | Error. Records every fetch init. */
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = (url, init) => {
    const file = String(url).split("/feed/")[1];
    calls.push({ file, init });
    const route = file in routes ? routes[file] : feed[file];
    if (route === "hang-headers") return never();
    if (route === "hang-body") return Promise.resolve({ ok: true, status: 200, json: never });
    if (route instanceof Error) return Promise.reject(route);
    if (route && typeof route === "object" && "status" in route && Object.keys(route).length === 1) return Promise.resolve(response(null, route.status));
    return Promise.resolve(response(route));
  };
  return { fetchImpl, calls };
}

const ctx = (routes, extra = {}) => {
  const fake = fakeFetch(routes);
  const controller = extra.controller ?? new AbortController();
  return { fake, controller, context: { base, signal: controller.signal, fetchImpl: fake.fetchImpl, timeoutMs: extra.timeoutMs } };
};

test("published fixtures load and keep their cross-file checks", async () => {
  const { context, fake } = ctx({});
  const core = await L.loadCoreReport(context);
  assert.equal(core.patch_id, feed["current.json"].patch_id);
  assert.equal((await L.loadCreatorBrief(context, core)).source_snapshot.cutoff, core.cutoff);
  const history = await L.loadHistoryAndOutcomes(context, core);
  assert.ok(history.historyStatus);
  assert.ok(history.outcomes, "matching outcomes are accepted");
  const schedule = await L.loadScheduleAndChanges(context, feed["schedule.json"].retrieved_at);
  assert.equal(schedule.state, "connected");
  assert.ok(schedule.changes, "matching change log is accepted");
  assert.ok(fake.calls.every(({ init }) => init.cache === "no-store" && init.signal instanceof AbortSignal));
});

test("dependent companions are rejected when they do not match", async () => {
  const core = feed["current.json"];
  const creator = structuredClone(feed["current-creator.json"]);
  creator.source_snapshot.cutoff = "2000-01-01T00:00:00+00:00";
  await assert.rejects(L.loadCreatorBrief(ctx({ "current-creator.json": creator }).context, core), /does not match/);

  const outcomes = structuredClone(feed["decision-outcomes.json"]);
  outcomes.as_of = "2000-01-01T00:00:00+00:00";
  const mismatched = await L.loadHistoryAndOutcomes(ctx({ "decision-outcomes.json": outcomes }).context, core);
  assert.ok(mismatched.historyStatus);
  assert.equal(mismatched.outcomes, null);

  const flipped = structuredClone(feed["decision-outcomes.json"]);
  flipped.benchmark_ready = !flipped.benchmark_ready;
  assert.equal((await L.loadHistoryAndOutcomes(ctx({ "decision-outcomes.json": flipped }).context, core)).outcomes, null);

  // Without any history status, outcomes cannot be verified and are dropped.
  const coreWithoutHistory = { ...core, history_status: undefined };
  assert.equal((await L.loadHistoryAndOutcomes(ctx({ "history-status.json": { status: 404 } }).context, coreWithoutHistory)).outcomes, null);

  const changes = structuredClone(feed["schedule-changes.json"]);
  changes.current_snapshot.content_hash = "different";
  assert.equal((await L.loadScheduleAndChanges(ctx({ "schedule-changes.json": changes }).context, feed["schedule.json"].retrieved_at)).changes, null);
  const retrieved = structuredClone(feed["schedule-changes.json"]);
  retrieved.current_snapshot.retrieved_at = "2000-01-01T00:00:00+00:00";
  assert.equal((await L.loadScheduleAndChanges(ctx({ "schedule-changes.json": retrieved }).context, feed["schedule.json"].retrieved_at)).changes, null);

  // The change log alone cannot rescue a failed schedule; a failed change log does not fail the schedule.
  await assert.rejects(L.loadScheduleAndChanges(ctx({ "schedule.json": { status: 500 } }).context, feed["schedule.json"].retrieved_at));
  assert.equal((await L.loadScheduleAndChanges(ctx({ "schedule-changes.json": "hang-body" }, { timeoutMs: 20 }).context, feed["schedule.json"].retrieved_at)).changes, null);
  const old = await L.loadScheduleAndChanges(ctx({}).context, new Date(Date.parse(feed["schedule.json"].retrieved_at) + 40 * 3600_000).toISOString());
  assert.equal(old.state, "stale");
});

test("invalid core payloads and HTTP errors are rejected", async () => {
  await assert.rejects(L.loadCoreReport(ctx({ "current.json": { schema_version: "nope" } }).context), /unsupported report/);
  await assert.rejects(L.loadCoreReport(ctx({ "current.json": { status: 503 } }).context), /503/);
  await assert.rejects(L.loadCollectionStatus(ctx({ "collection-status.json": { foo: 1 } }).context), /unsupported/);
  await assert.rejects(L.loadAIValidation(ctx({ "ai-validation.json": new TypeError("network") }).context), /network/);
});

test("a hanging response or a hanging body both time out and abort the fetch signal", async () => {
  for (const mode of ["hang-headers", "hang-body"]) {
    const { context, fake } = ctx({ "collection-status.json": mode }, { timeoutMs: 25 });
    const started = Date.now();
    await assert.rejects(L.loadCollectionStatus(context), (error) => error.name === "PublicationTimeoutError");
    assert.ok(Date.now() - started < 2_000, `${mode} must be bounded`);
    assert.equal(fake.calls[0].init.signal.aborted, true, `${mode} aborts the underlying request`);
  }
  assert.equal(L.CORE_TIMEOUT_MS > 0 && Number.isFinite(L.CORE_TIMEOUT_MS), true);
  assert.equal(L.COMPANION_TIMEOUT_MS > 0 && Number.isFinite(L.COMPANION_TIMEOUT_MS), true);
});

test("an outer abort rejects in-flight work at once and companions do not report nulls after abort", async () => {
  const controller = new AbortController();
  const { context, fake } = ctx({ "current.json": "hang-body", "history-status.json": "hang-headers" }, { controller, timeoutMs: 60_000 });
  const core = L.loadCoreReport(context);
  const history = L.loadHistoryAndOutcomes(context, feed["current.json"]);
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(core, (error) => error.name === "AbortError");
  await assert.rejects(history, (error) => error.name === "AbortError");
  assert.ok(fake.calls.every(({ init }) => init.signal.aborted));
  await assert.rejects(L.loadAIValidation(context), (error) => error.name === "AbortError");
});

test("timers and abort listeners are released on success, failure, timeout and abort", async () => {
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  const active = new Set();
  globalThis.setTimeout = (fn, ms, ...args) => { const id = realSet(() => { active.delete(id); fn(...args); }, ms); active.add(id); return id; };
  globalThis.clearTimeout = (id) => { active.delete(id); realClear(id); };
  const controller = new AbortController();
  let listeners = 0;
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (...args) => { listeners += 1; add(...args); };
  controller.signal.removeEventListener = (...args) => { listeners -= 1; remove(...args); };
  try {
    const routes = { "collection-status.json": { status: 500 }, "ai-validation.json": "hang-body" };
    const { context } = ctx(routes, { controller, timeoutMs: 30 });
    await L.loadCoreReport({ ...context, timeoutMs: 60_000 });
    await assert.rejects(L.loadCollectionStatus({ ...context, timeoutMs: 60_000 }));
    await assert.rejects(L.loadAIValidation(context));
    assert.equal(active.size, 0, "no pending timers remain");
    assert.equal(listeners, 0, "no abort listeners remain");
  } finally {
    globalThis.setTimeout = realSet;
    globalThis.clearTimeout = realClear;
  }
});

test("merging history and labelling the feed never mutate the fetched report", async () => {
  const core = structuredClone(feed["current.json"]);
  const before = JSON.stringify(core);
  const status = structuredClone(feed["history-status.json"]);
  const merged = L.withHistoryStatus(core, status);
  assert.notEqual(merged, core);
  assert.equal(merged.history_status, status);
  assert.equal(L.withHistoryStatus(core, null), core);
  L.describePublishedFeed(core, new Date().toISOString(), null, true);
  assert.equal(JSON.stringify(core), before);
});

test("feed labels stay honest while companions load and after a failed refresh", () => {
  const core = structuredClone(feed["current.json"]);
  const fresh = { ...core, fixture_only: false, cutoff: new Date().toISOString() };
  assert.equal(L.describePublishedFeed(fresh, new Date().toISOString(), null, true).detail, "자동 연결됨 · 검증된 발행본 · 부가 자료 확인 중");
  assert.equal(L.describePublishedFeed(fresh, new Date().toISOString(), null, false).detail, "자동 연결됨 · 검증된 발행본");
  const stale = { ...core, fixture_only: false, cutoff: "2020-01-01T00:00:00+00:00" };
  const pending = L.describePublishedFeed(stale, new Date().toISOString(), null, true);
  assert.equal(pending.label, "STALE · REVIEW ONLY");
  assert.match(pending.detail, /수집 상태 확인 중$/);
  assert.match(L.describePublishedFeed(stale, new Date().toISOString(), null, false).detail, /현재 판단 잠금$/);
  assert.equal(L.describePublishedFeed({ ...core, fixture_only: true }, new Date().toISOString(), null, true).label, "PUBLISHED DEMO FEED");

  const failed = L.describeRefreshFailure({ kind: "published", label: "LIVE PUBLISHED FEED", detail: "x" });
  assert.equal(failed.kind, "published");
  assert.doesNotMatch(failed.label, /LIVE/);
  assert.match(failed.label, /REFRESH FAILED/);
  assert.equal(L.describeRefreshFailure({ kind: "uploaded", label: "LOCAL FILE", detail: "A.JSON" }).kind, "uploaded");
  assert.equal(L.FIRST_LOAD_FAILURE.label, "DEMO FALLBACK");
});
