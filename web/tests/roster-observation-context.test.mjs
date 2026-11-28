import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { createServer } from "vite";

// Observation context builder/verifier and the explicit preparation controller (reviewer criteria 1-4).
let vite, C, S, R, P, report, rawCatalog, catalog, blue, red, teamIds, nuguri, spare;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false,
    server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  C = await vite.ssrLoadModule("/app/roster-observation-context.ts");
  S = await vite.ssrLoadModule("/app/roster-observation-session.ts");
  R = await vite.ssrLoadModule("/app/roster-scenario.ts");
  P = await vite.ssrLoadModule("/app/season-player-cards.ts");
  report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  rawCatalog = JSON.parse(await readFile(new URL("../public/history/season-player-cards.json", import.meta.url), "utf8"));
  catalog = P.parseSeasonCardCatalog(rawCatalog);
  [blue, red] = report.opponent_prep.teams;
  teamIds = [blue.team_id, red.team_id].sort();
  nuguri = catalog.cards.find(c => c.player_name === "Nuguri" && c.season === 2022 && c.role === "TOP");
  const index = R.buildRosterIndex(report.opponent_prep.teams);
  const third = R.observedRosters(report.opponent_prep.teams, [report.opponent_prep.teams[2].team_id, report.opponent_prep.teams[3].team_id], index);
  spare = third[report.opponent_prep.teams[2].team_id].JUNGLE;
});
after(async () => { await vite?.close(); });

/** Mixed lineup: every observed current player, except BLUE TOP which holds the 2022 Nuguri season card. */
function lineup() {
  const index = R.buildRosterIndex(report.opponent_prep.teams);
  const rosters = R.observedRosters(report.opponent_prep.teams, teamIds, index);
  rosters[blue.team_id].TOP = null;
  const seasonLineups = { [blue.team_id]: { ...P.emptySeasonSlots(), TOP: { catalog_id: catalog.catalog_id, card_id: nuguri.id, player_id: nuguri.player_id } }, [red.team_id]: P.emptySeasonSlots() };
  return { rosters, seasonLineups };
}
function slots({ rosters, seasonLineups }) {
  const r = S.observationSlotsOf(teamIds, rosters, seasonLineups, catalog.catalog_id);
  assert.equal(r.ok, true, r.message);
  return r.teams;
}
const AS_OF = "2026-11-28T00:00:00Z";
const build = (over = {}) => C.buildRosterObservationContext({ report, catalog, analysis_as_of: AS_OF, teams: slots(lineup()), ...over });

test("builds a verified mixed context with refs and data basis only; refuses empty, duplicate and unresolved refs without touching inputs", async () => {
  const ok = await build();
  assert.equal(ok.ok, true, ok.message);
  const ctx = ok.context;
  assert.deepEqual(Object.keys(ctx).sort(), ["analysis_as_of", "artifact_type", "catalog_cutoff", "catalog_id", "catalog_provenance_digest", "context_key", "purpose", "report_cutoff", "report_evidence_digest", "schema_version", "team_ids", "teams"]);
  assert.equal(ctx.teams[blue.team_id].TOP.kind, "SEASON");
  assert.equal(ctx.report_cutoff, report.cutoff);
  assert.equal(ctx.catalog_cutoff, catalog.cutoff);
  assert.equal(ctx.purpose, "OBSERVATION_CONTEXT_ONLY");
  assert.ok(Object.isFrozen(ctx) && Object.isFrozen(ctx.teams[blue.team_id].TOP));
  // No ability/effect/win-rate style field anywhere.
  assert.doesNotMatch(JSON.stringify(ctx), /win|rate|ability|effect|rating|strength|player_name/i);

  const empty = lineup(); empty.rosters[red.team_id].MID = null;
  const before = structuredClone(empty);
  const emptyResult = S.observationSlotsOf(teamIds, empty.rosters, empty.seasonLineups, catalog.catalog_id);
  assert.equal(emptyResult.ok, false); assert.equal(emptyResult.reason, "SLOT_INVALID");
  assert.deepEqual(empty, before);

  const dup = lineup(); dup.rosters[red.team_id].MID = dup.rosters[blue.team_id].MID;
  const dupResult = await C.buildRosterObservationContext({ report, catalog, analysis_as_of: AS_OF, teams: slots(dup) });
  assert.equal(dupResult.ok, false); assert.match(dupResult.reason, /DUPLICATE_PLAYER|CURRENT_INVALID/);

  const bad = slots(lineup()); bad[blue.team_id].TOP = { kind: "SEASON", card_id: "0".repeat(64), player_id: nuguri.player_id };
  const badResult = await C.buildRosterObservationContext({ report, catalog, analysis_as_of: AS_OF, teams: bad });
  assert.equal(badResult.ok, false); assert.equal(badResult.reason, "CARD_NOT_FOUND");

  const allCurrent = R.observedRosters(report.opponent_prep.teams, teamIds, R.buildRosterIndex(report.opponent_prep.teams));
  const noSeason = await C.buildRosterObservationContext({ report, catalog, analysis_as_of: AS_OF, teams: slots({ rosters: allCurrent, seasonLineups: {} }) });
  assert.equal(noSeason.ok, false); assert.equal(noSeason.reason, "NO_SEASON_SLOT");
});

test("criterion 2: as_of exactly equal to a microsecond cutoff is allowed; 1ns earlier is refused (not Date.parse)", async () => {
  const cutoff = "2026-11-19T03:22:57.035668Z";
  const exactReport = { ...structuredClone(report), cutoff };
  const equal = await build({ report: exactReport, analysis_as_of: cutoff });
  assert.equal(equal.ok, true, equal.message);
  assert.equal(equal.context.analysis_as_of, cutoff);
  // Same catalog cutoff written with an offset is the same instant and also accepted.
  assert.equal((await build({ report: exactReport, analysis_as_of: "2026-11-19T03:22:57.035668+00:00" })).ok, true);
  const earlier = "2026-11-19T03:22:57.035667999Z";
  assert.equal(Date.parse(earlier), Date.parse(cutoff), "millisecond parsing cannot tell these apart");
  const refused = await build({ report: exactReport, analysis_as_of: earlier });
  assert.equal(refused.ok, false); assert.equal(refused.reason, "CUTOFF_AFTER_AS_OF");
  const microEarlier = await build({ report: exactReport, analysis_as_of: "2026-11-19T03:22:57.035667Z" });
  assert.equal(microEarlier.reason, "CUTOFF_AFTER_AS_OF");
  assert.equal(C.compareInstants(earlier, cutoff), -1);
  assert.equal(C.compareInstants("2026-11-19T03:22:57.035668000Z", "2026-11-19T03:22:57.035668+00:00"), 0);
});

test("criterion 1: a catalog differing only in sources.retrieved_at is a provenance change; verified with the saved report", async () => {
  const ctx = (await build()).context;
  const ok = await C.verifyRosterObservationContext(ctx, { report, catalog });
  assert.equal(ok.ok, true, ok.message);
  assert.equal(C.canonicalText(ok.context), C.canonicalText(ctx));

  const moved = structuredClone(rawCatalog);
  moved.sources[0].retrieved_at = "2026-11-18T00:45:22.279928+00:00";
  const parsed = P.parseSeasonCardCatalog(moved);
  await P.verifySeasonCardIntegrity(parsed); // cards, catalog_id and cutoff are unchanged
  assert.equal(parsed.catalog_id, catalog.catalog_id);
  const changed = await C.verifyRosterObservationContext(ctx, { report, catalog: parsed });
  assert.equal(changed.ok, false); assert.equal(changed.reason, "CATALOG_CHANGED");

  const otherReport = structuredClone(report); otherReport.entries = otherReport.entries.slice(1);
  const reportChanged = await C.verifyRosterObservationContext(ctx, { report: otherReport, catalog });
  assert.equal(reportChanged.ok, false); assert.equal(reportChanged.reason, "REPORT_CHANGED");

  const keyTampered = { ...structuredClone(ctx), context_key: "f".repeat(64) };
  assert.equal((await C.verifyRosterObservationContext(keyTampered, { report, catalog })).reason, "CONTEXT_KEY_MISMATCH");
  const digestTampered = { ...structuredClone(ctx), report_evidence_digest: "e".repeat(64) };
  assert.equal((await C.verifyRosterObservationContext(digestTampered, { report, catalog })).reason, "REPORT_CHANGED");
  const extra = { ...structuredClone(ctx), win_rate: 0.5 };
  assert.equal((await C.verifyRosterObservationContext(extra, { report, catalog })).reason, "FORMAT_INVALID");
});

function deferredBuild() {
  const calls = [];
  const build = (input) => new Promise((resolve) => calls.push({ input, resolve }));
  return { calls, build };
}
const request = (state, over = {}) => ({ ownerKey: "owner", report, catalog, teamIds, rosters: state.rosters, seasonLineups: state.seasonLineups, analysisAsOf: AS_OF, blocked: false, ...over });

test("criterion 3: A→B→A with 2→1 completion order publishes only the newest; invalidate (room) / dispose discard late READY; inputs copied at click", async () => {
  const real = await build();
  const { calls, build: slow } = deferredBuild();
  const published = [];
  const session = S.createObservationPreparationSession({ onPublish: v => published.push(v), build: slow });
  const A = lineup();
  const B = lineup(); B.rosters[red.team_id].MID = spare;
  const p1 = session.prepare(request(A));
  const p2 = session.prepare(request(B));
  const p3 = session.prepare(request(A));
  // Mutating the owner state after the click cannot reach the captured input.
  A.rosters[red.team_id].JUNGLE = spare;
  assert.equal(calls[2].input.teams[red.team_id].JUNGLE.player_id, lineup().rosters[red.team_id].JUNGLE.player_id);
  calls[1].resolve(real); assert.equal(await p2, null);
  calls[0].resolve(real); assert.equal(await p1, null);
  assert.deepEqual(published, []);
  calls[2].resolve(real);
  const ready = await p3;
  assert.equal(ready.phase, "READY");
  assert.equal(published.length, 1);
  // An edit A→B→A after READY withdraws (generation bump per edit, not value comparison).
  session.invalidate(); session.invalidate();
  assert.equal(published.at(-1), null);
  assert.equal(session.status().phase, "IDLE");

  // Room entry (invalidate) while building: the late READY is discarded.
  const p4 = session.prepare(request(lineup()));
  session.invalidate();
  calls[3].resolve(real);
  assert.equal(await p4, null);
  assert.equal(published.filter(Boolean).length, 1);
  // Dispose while building.
  const p5 = session.prepare(request(lineup()));
  session.dispose();
  calls[4].resolve(real);
  assert.equal(await p5, null);
  assert.equal(published.filter(Boolean).length, 1);
  assert.equal(await session.prepare(request(lineup())), null);

  // Blocked owner (room/restore/read) is refused without building.
  const other = S.createObservationPreparationSession({ onPublish: () => {}, build: slow });
  const blocked = await other.prepare(request(lineup(), { blocked: true }));
  assert.equal(blocked.reason, "BLOCKED");
  assert.equal(calls.length, 5);
});

test("criterion 4: after a successful saved-context verify, one CURRENT slot changed in the applied owner state → RESTORE_MISMATCH (full canonical compare)", async () => {
  const expected = (await build()).context;
  const verified = await C.verifyRosterObservationContext(expected, { report, catalog });
  assert.equal(verified.ok, true);
  const published = [];
  const session = S.createObservationPreparationSession({ onPublish: v => published.push(v) });
  const same = await session.prepare(request(lineup(), { analysisAsOf: expected.analysis_as_of, expected: verified.context }));
  assert.equal(same.phase, "READY");
  assert.equal(same.ready.restored, true);
  assert.equal(same.ready.context.context_key, expected.context_key);

  const changed = lineup(); changed.rosters[red.team_id].JUNGLE = spare;
  // The changed lineup is itself valid: a fresh build succeeds, only the restore comparison refuses it.
  assert.equal((await C.buildRosterObservationContext({ report, catalog, analysis_as_of: expected.analysis_as_of, teams: slots(changed) })).ok, true);
  const mismatch = await session.prepare(request(changed, { analysisAsOf: expected.analysis_as_of, expected: verified.context }));
  assert.equal(mismatch.phase, "REFUSED"); assert.equal(mismatch.reason, "RESTORE_MISMATCH"); assert.equal(mismatch.restoring, true);
  assert.equal(published.at(-1), null);

  // A context_key-only forgery (same key, different slot) is still a full mismatch.
  const forged = structuredClone(verified.context);
  forged.teams[red.team_id].JUNGLE = { kind: "CURRENT", ...spare };
  const forgedResult = await session.prepare(request(lineup(), { analysisAsOf: expected.analysis_as_of, expected: forged }));
  assert.equal(forgedResult.reason, "RESTORE_MISMATCH");

  // A restore superseded by a newer edit is withdrawn (late result discarded).
  const { calls, build: slow } = deferredBuild();
  const s2 = S.createObservationPreparationSession({ onPublish: v => published.push(v), build: slow });
  const late = s2.prepare(request(lineup(), { analysisAsOf: expected.analysis_as_of, expected: verified.context }));
  s2.invalidate();
  calls[0].resolve({ ok: true, context: verified.context });
  assert.equal(await late, null);
  assert.equal(s2.status().phase, "IDLE");
});
