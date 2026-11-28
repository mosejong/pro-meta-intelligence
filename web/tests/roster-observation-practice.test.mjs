import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { createServer } from "vite";

// Practice bundle v3 (observation context) + library entry v4: v1/v2 compatibility, save gating
// (reviewer criterion 5), tampering and late verification.
let vite, B, L, R, S, C, OS, PR, agent, report, rawCatalog, catalog, blue, red, ids, nuguri;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false,
    server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  B = await vite.ssrLoadModule("/app/practice-roster-bundle.ts");
  L = await vite.ssrLoadModule("/app/draft-practice-library.ts");
  R = await vite.ssrLoadModule("/app/roster-scenario.ts");
  S = await vite.ssrLoadModule("/app/season-player-cards.ts");
  C = await vite.ssrLoadModule("/app/roster-observation-context.ts");
  OS = await vite.ssrLoadModule("/app/roster-observation-session.ts");
  PR = await vite.ssrLoadModule("/app/roster-observation-practice.ts");
  agent = await vite.ssrLoadModule("/app/draft-agent.ts");
  report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  [blue, red] = report.opponent_prep.teams;
  const fixture = JSON.parse(await readFile(new URL("./fixtures/champion-asset-ids-16.16.1.json", import.meta.url), "utf8"));
  ids = fixture.champions.map(c => c.id);
  rawCatalog = JSON.parse(await readFile(new URL("../public/history/season-player-cards.json", import.meta.url), "utf8"));
  catalog = S.parseSeasonCardCatalog(rawCatalog);
  nuguri = catalog.cards.find(c => c.player_name === "Nuguri" && c.season === 2022 && c.role === "TOP");
});
after(async () => { await vite?.close(); });

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
                delete: k => req(t => { t.delete(k); }), add: (v, k) => req(t => { t.set(keyPath ? v[keyPath] : k, structuredClone(v)); }),
                put: (v, k) => req(t => { t.set(keyPath ? v[keyPath] : k, structuredClone(v)); }) };
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
  newId: () => `obs-${String(++seq).padStart(6, "0")}`, now: () => new Date(Date.UTC(2026, 10, 28, 1, 0, seq)) });
const stores = idb => idb.databases.get(L.PRACTICE_DB_NAME).stores;
const teamIds = () => [blue.team_id, red.team_id].sort();

function draftText(source = report) {
  let selections = [];
  for (const id of ids.slice(0, 4)) selections = agent.applyDraftSelection(selections, id, [], "BLUE");
  return agent.serializeDraftScenario(source, blue, red, selections, [], null, "BLUE", null);
}
function mixed() {
  const index = R.buildRosterIndex(report.opponent_prep.teams);
  const rosters = R.observedRosters(report.opponent_prep.teams, teamIds(), index);
  rosters[blue.team_id].TOP = null;
  const lineups = Object.fromEntries(teamIds().map(id => [id, S.emptySeasonSlots()]));
  lineups[blue.team_id].TOP = { catalog_id: catalog.catalog_id, card_id: nuguri.id, player_id: nuguri.player_id };
  const roster = R.serializeRosterScenario({ basis: R.rosterBasis(report), team_ids: teamIds(), rosters }, index);
  const season = { catalog_id: catalog.catalog_id, cutoff: catalog.cutoff, lineups };
  return { rosters, roster, season };
}
// One hour after the later data cutoff: feed/current.json is refreshed several times a day by the collector.
function asOf() {
  const ms = Math.max(Date.parse(report.cutoff), Date.parse(catalog.cutoff));
  return new Date(Math.ceil(ms / 1000) * 1000 + 3_600_000).toISOString().replace(".000Z", "Z");
}
async function prepared(state = mixed()) {
  const teams = OS.observationSlotsOf(teamIds(), state.rosters, state.season.lineups, catalog.catalog_id);
  const built = await C.buildRosterObservationContext({ report, catalog, analysis_as_of: asOf(), teams: teams.teams });
  assert.equal(built.ok, true, built.message);
  return built.context;
}

test("v1/v2 practices (plain, roster bundle v1, season bundle v2) load unchanged and are never rewritten", async () => {
  const idb = fakeIDB(); const lib = make(idb);
  const text = draftText(); const { roster, season } = mixed();
  const plain = await lib.save("밴픽만", text);
  const v1 = await lib.save("현재 선수", text, roster);
  const v2 = await lib.save("시즌 선수", text, roster, season);
  assert.deepEqual([plain.schema_version, v1.schema_version, v2.schema_version], [1, 2, 3]);
  const snapshot = new Map([...stores(idb).get("scenarios").data]);
  const entriesBefore = JSON.stringify([...stores(idb).get("entries").data]);
  for (const entry of [plain, v1, v2]) {
    const back = await lib.read(entry.id);
    assert.equal(back.observation, null); assert.equal(back.observationDropped, false);
    assert.equal(L.entryHasObservation(back.entry), false);
  }
  assert.equal(JSON.parse(snapshot.get(v2.id)).schema_version, 2, "bundle v2 stays bundle v2");
  assert.equal(snapshot.get(plain.id), text, "legacy plain draft string stays verbatim");
  assert.deepEqual([...stores(idb).get("scenarios").data], [...snapshot], "reads never rewrite stored bodies");
  assert.equal(JSON.stringify([...stores(idb).get("entries").data]), entriesBefore);
  // Same raw value through the codec: identical text, no observation part added.
  for (const raw of snapshot.values()) { const parsed = B.parsePracticeContent(raw); assert.equal(parsed.ok, true); assert.equal(parsed.text, raw); assert.equal(parsed.observation, null); }
});

test("criterion 5: attach only with flag on, same report, roster and season present; otherwise the ordinary v1/v2 save", async () => {
  const text = draftText(); const { roster, season } = mixed();
  const ctx = await prepared();
  assert.ok(await PR.practiceObservationForSave({ enabled: true, prepared: ctx, scenario: text, roster, season }));
  assert.equal(await PR.practiceObservationForSave({ enabled: false, prepared: ctx, scenario: text, roster, season }), null, "flag off (default)");
  assert.equal(await PR.practiceObservationForSave({ enabled: true, prepared: ctx, scenario: text, roster, season: null }), null, "no season part");
  assert.equal(await PR.practiceObservationForSave({ enabled: true, prepared: ctx, scenario: text, roster: null, season: null }), null, "no roster");
  assert.equal(await PR.practiceObservationForSave({ enabled: true, prepared: null, scenario: text, roster, season }), null);
  // Different report (same cutoff, other content) → digest differs → not attached.
  const otherReport = structuredClone(report); otherReport.entries = otherReport.entries.slice(1);
  assert.equal(await PR.practiceObservationForSave({ enabled: true, prepared: ctx, scenario: draftText(otherReport), roster, season }), null, "other report");
  // Different lineup than the prepared one → not attached.
  const other = mixed(); const otherCtx = structuredClone(ctx);
  otherCtx.teams[red.team_id].MID = { kind: "CURRENT", source_team_id: red.team_id, player_id: "oe:player:not-in-roster" };
  assert.equal(await PR.practiceObservationForSave({ enabled: true, prepared: otherCtx, scenario: text, roster: other.roster, season: other.season }), null);

  const idb = fakeIDB(); const lib = make(idb);
  const ordinary = await lib.save("일반 저장", text, roster, season, null);
  assert.equal(ordinary.schema_version, L.PRACTICE_SCHEMA_VERSION_SEASON);
  assert.equal(JSON.parse(stores(idb).get("scenarios").data.get(ordinary.id)).schema_version, B.PRACTICE_BUNDLE_VERSION_SEASON);
  // The codec itself refuses a context without its season/roster.
  assert.equal(B.buildPracticeContent(text, roster, null, ctx).code, "INVALID_OBSERVATION");
  assert.equal(B.buildPracticeContent(text, null, null, ctx).code, "INVALID_OBSERVATION");
});

test("bundle v3 + entry v4 round trip; numbers are separate (entry 4 ↔ bundle 3)", async () => {
  const idb = fakeIDB(); const lib = make(idb);
  const text = draftText(); const { roster, season } = mixed();
  const ctx = await prepared();
  const entry = await lib.save("관측 문맥", text, roster, season, ctx);
  assert.equal(entry.schema_version, L.PRACTICE_SCHEMA_VERSION_OBSERVATION);
  assert.equal(L.PRACTICE_SCHEMA_VERSION_OBSERVATION, 4); assert.equal(B.PRACTICE_BUNDLE_VERSION_OBSERVATION, 3);
  assert.deepEqual(entry.summary, { ...entry.summary, roster: true, season: true, observation: true });
  const stored = JSON.parse(stores(idb).get("scenarios").data.get(entry.id));
  assert.equal(stored.schema_version, 3);
  assert.deepEqual(Object.keys(stored).sort(), ["artifact_type", "draft", "observation", "roster", "schema_version", "season"]);
  const back = await lib.read(entry.id);
  assert.equal(C.canonicalText(back.observation), C.canonicalText(ctx));
  const verdict = await PR.verifyPracticeObservation({ observation: back.observation, catalog, savedReport: back.session.report });
  assert.equal(verdict.ok, true, verdict.message);
  assert.equal(verdict.expected.context_key, ctx.context_key);
});

async function storedV3(mutate) {
  const idb = fakeIDB(); const lib = make(idb);
  const text = draftText(); const { roster, season } = mixed();
  const entry = await lib.save("변조", text, roster, season, await prepared());
  const data = stores(idb).get("scenarios").data;
  const value = JSON.parse(data.get(entry.id)); mutate(value); data.set(entry.id, JSON.stringify(value));
  return { lib, entry, roster, season };
}

test("v3 tampering: digest/context_key mismatch → not restored, draft/roster/season still valid; slot ref mismatch → dropped", async () => {
  for (const [field, reason] of [["context_key", "CONTEXT_KEY_MISMATCH"], ["report_evidence_digest", "REPORT_CHANGED"], ["catalog_provenance_digest", "CATALOG_CHANGED"]]) {
    const { lib, entry, season } = await storedV3(v => { v.observation[field] = "a".repeat(64); });
    const back = await lib.read(entry.id);
    assert.ok(back.observation, "structurally valid → handed on for full verification");
    assert.ok(B.verifySeasonPart(back.season, back.roster, catalog).ok, "season part still restorable");
    assert.deepEqual(back.season, season);
    const verdict = await PR.verifyPracticeObservation({ observation: back.observation, catalog, savedReport: back.session.report });
    assert.equal(verdict.ok, false); assert.equal(verdict.reason, reason, field);
  }
  // A ref that disagrees with the stored roster/season is dropped structurally, never repaired.
  const { lib, entry } = await storedV3(v => { v.observation.teams[v.observation.team_ids[0]].MID.player_id = "oe:player:someone-else"; });
  const back = await lib.read(entry.id);
  assert.equal(back.observation, null); assert.equal(back.observationDropped, true);
  assert.ok(back.roster && back.season && back.session);
  // Unknown extra key in the observation part is dropped too.
  const extra = await storedV3(v => { v.observation.win_rate = 0.6; });
  const extraBack = await extra.lib.read(extra.entry.id);
  assert.equal(extraBack.observation, null); assert.equal(extraBack.observationDropped, true);
  // Entry v4 whose bundle lost its observation key is corrupt (metadata disagreement), not silently v2.
  const lost = await storedV3(v => { delete v.observation; v.schema_version = 2; });
  await assert.rejects(lost.lib.read(lost.entry.id), e => e.code === "CORRUPT");
});

test("late verification: a newer action (stale ticket) or abort discards the verified result", async () => {
  const ctx = await prepared();
  let release;
  const slowVerify = (...args) => new Promise(resolve => { release = () => resolve(C.verifyRosterObservationContext(...args)); });
  let currentTicket = 1;
  const ticket = currentTicket;
  const pending = PR.verifyPracticeObservation({ observation: ctx, catalog, savedReport: report, isCurrent: () => ticket === currentTicket, verify: slowVerify });
  currentTicket++; // e.g. lineup edit / room entry / another load
  release();
  const stale = await pending;
  assert.equal(stale.ok, false); assert.equal(stale.reason, "STALE");

  const controller = new AbortController();
  const aborted = PR.verifyPracticeObservation({ observation: ctx, catalog, savedReport: report, signal: controller.signal, verify: slowVerify });
  controller.abort(); release();
  assert.equal((await aborted).reason, "ABORTED");

  // A catalog whose only change is sources.retrieved_at (same id/cutoff, passes the season check) refuses the preparation.
  const moved = structuredClone(rawCatalog); moved.sources[1].retrieved_at = "2026-08-25T06:39:37.755252+00:00";
  const movedCatalog = S.parseSeasonCardCatalog(moved);
  const { roster, season } = mixed();
  assert.ok(B.verifySeasonPart(season, B.buildPracticeContent(draftText(), roster).roster, movedCatalog).ok);
  assert.equal((await PR.verifyPracticeObservation({ observation: ctx, catalog: movedCatalog, savedReport: report })).reason, "CATALOG_CHANGED");
});
