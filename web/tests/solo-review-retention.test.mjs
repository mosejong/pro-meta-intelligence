import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { createServer } from "vite";

// Stage-1 pure sidecar codec: real feed, real auto-choice/explanation rules, real scenario serializer/parser.
const webRoot = fileURLToPath(new URL("../", import.meta.url));
let vite, codec, suggest, explain, agent, ui, hist, sessions, report, season, ids, basisOf;
before(async () => {
  vite = await createServer({ root: webRoot, configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  codec = await vite.ssrLoadModule("/app/solo-review-retention.ts");
  ({ suggestSoloDraftTurn: suggest, explainSoloDraftTurn: explain } = await vite.ssrLoadModule("/app/solo-draft.ts"));
  agent = await vite.ssrLoadModule("/app/draft-agent.ts");
  ui = await vite.ssrLoadModule("/app/solo-draft-explanation.tsx");
  hist = await vite.ssrLoadModule("/app/solo-draft-history.ts");
  sessions = await vite.ssrLoadModule("/app/draft-session.ts");
  const { parsePlayerSeasonHistory } = await vite.ssrLoadModule("/app/player-season-history.ts");
  const { rosterBasis, basisKey } = await vite.ssrLoadModule("/app/roster-scenario.ts");
  basisOf = r => basisKey(rosterBasis(r));
  const { SHARE_CHAMPIONS } = await vite.ssrLoadModule("/app/share-champion-ids.ts");
  ids = SHARE_CHAMPIONS.map(([, id]) => id);
  report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  const parsed = parsePlayerSeasonHistory(await readFile(new URL("../public/history/player-season-2026.json", import.meta.url), "utf8"), { basis: rosterBasis(report), season: 2026 });
  season = parsed.ok ? parsed.value : null;
});
after(async () => { await vite?.close(); });

const SHA = "0123456789abcdef".repeat(4);
const OTHER_SHA = "f".repeat(64);
const other = side => side === "BLUE" ? "RED" : "BLUE";
const teamsOf = r => r.opponent_prep.teams;

/**
 * One real game: the manual side takes the first legal champion; the opponent auto-confirms through the
 * unchanged suggest/explain rules with draft-lab's record shape, real append/prune, then the board goes
 * through the real scenario serializer and session parser.
 */
function playGame({ r = report, manualSide = "RED", firstPickSide = "BLUE", games = [], seasonHistory = null, steps = 20 } = {}) {
  const [blueTeam, redTeam] = teamsOf(r);
  const previousPicks = agent.fearlessLocks(games);
  const context = hist.soloHistoryContext(ui.soloAutoContext(blueTeam.team_id, redTeam.team_id, firstPickSide, manualSide, previousPicks), basisOf(r));
  let selections = [], history = [];
  for (let step = 0; step < steps; step++) {
    const state = { report: r, blueTeam, redTeam, selections, previousPicks, firstPickSide, manualSide, seasonHistory };
    const chosen = suggest(state);
    let id;
    if (chosen) {
      const e = explain(state), turn = selections.length + 1;
      history = hist.appendSoloAutoHistory(history, { turn, champion_id: chosen.champion_id, reason: chosen.reason,
        prefix: selections.map(s => s.champion_id), context, explanation: e?.selected.champion_id === chosen.champion_id && e.turn === turn ? e : null });
      id = chosen.champion_id;
    } else id = ids.find(c => agent.applyDraftSelection(selections, c, previousPicks, firstPickSide) !== selections);
    selections = agent.applyDraftSelection(selections, id, previousPicks, firstPickSide);
    history = hist.pruneSoloAutoHistory(history, selections, context);
  }
  const parsed = sessions.parseDraftSession(agent.serializeDraftScenario(r, blueTeam, redTeam, selections, games, null, firstPickSide));
  assert.equal(parsed.ok, true, "real board text parses");
  return { r, selections, history, session: parsed.session, manualSide, firstPickSide, games, context };
}

const serialize = (fx, records = fx.history, sha = SHA) => codec.serializeSoloReview(sha, fx.manualSide, records);
function docOf(fx, records = fx.history) {
  const result = serialize(fx, records);
  assert.equal(result.ok, true, `serialize ok (${result.reason})`);
  return JSON.parse(result.text);
}
const reasonOf = result => result.ok ? "OK" : result.reason;
const parseDoc = (fx, doc, session = fx.session, sha = SHA) => codec.parseSoloReview(typeof doc === "string" ? doc : JSON.stringify(doc), session, sha);
/** Reason for a single-record review after mutating a detached copy of that record. */
const mutateOne = (fx, record, change) => { const doc = docOf(fx, [record]); change(doc.records[0], doc); return reasonOf(parseDoc(fx, doc)); };

function assertDeepFrozen(value, path = "records") {
  if (value && typeof value === "object") {
    assert.ok(Object.isFrozen(value), `${path} frozen`);
    for (const [key, child] of Object.entries(value)) assertDeepFrozen(child, `${path}.${key}`);
  }
}

/** Every board turn as a structurally valid record (manual turns included: no real board has 20 auto turns). */
const allTurns = (fx, reason = "연습 기록") => fx.selections.map((s, index) => ({ turn: index + 1, champion_id: s.champion_id, reason,
  prefix: fx.selections.slice(0, index).map(x => x.champion_id), context: fx.context, explanation: null }));

test("real BLUE/RED, first-pick, season/no-season sets roundtrip exactly into fresh deep-frozen copies", () => {
  const evidences = new Set();
  for (const seasonHistory of [null, season]) for (const manualSide of ["BLUE", "RED"]) for (const firstPickSide of ["BLUE", "RED"]) {
    const fx = playGame({ manualSide, firstPickSide, seasonHistory });
    assert.equal(fx.history.length, 10, "every opponent turn kept");
    const input = structuredClone(fx.history), sessionBefore = structuredClone(fx.session);
    const written = serialize(fx);
    assert.equal(written.ok, true);
    assert.deepEqual(structuredClone(fx.history), input, "serialize does not mutate");
    const read = codec.parseSoloReview(written.text, fx.session, SHA);
    assert.equal(read.ok, true, `parse ok (${read.reason})`);
    assert.deepEqual(fx.session, sessionBefore, "parse does not mutate the session");
    assert.equal(read.manualSide, manualSide);
    assert.deepEqual(read.records, fx.history);
    assertDeepFrozen(read.records);
    read.records.forEach((record, index) => {
      assert.notEqual(record, fx.history[index]);
      if (record.explanation) assert.notEqual(record.explanation, fx.history[index].explanation);
      for (const c of record.explanation ? [record.explanation.selected, ...record.explanation.alternatives] : []) evidences.add(c.evidence);
      assert.ok(fx.session.selections[record.turn - 1].side !== manualSide);
    });
    // Two parses never share objects; mutation attempts on the frozen result fail.
    const again = codec.parseSoloReview(written.text, fx.session, SHA);
    assert.notEqual(again.records, read.records);
    assert.throws(() => { read.records[0].reason = "changed"; }, TypeError);
    assert.throws(() => { read.records[0].prefix.push("Ahri"); }, TypeError);
    // record_team is the producer's value (team name, else id).
    for (const record of read.records.filter(x => x.explanation)) {
      const { kind, side, record_team } = record.explanation;
      const [blue, red] = teamsOf(fx.r);
      const target = kind === "BAN" ? (side === "BLUE" ? red : blue) : (side === "BLUE" ? blue : red);
      assert.equal(record_team, target.team_name || target.team_id);
    }
  }
  assert.ok(evidences.has("TEAM_PRIORITY"), "real team-record shape covered");
});

test("SYNTHETIC review-eligible fixture: unchanged rules produce the RADAR_META shape, which roundtrips", () => {
  // SYNTHETIC: the current real feed has no review-eligible entries, so this clones the real report and sets the
  // existing boolean `eligible_for_review` flag on its existing entries. It also clears both teams' priority
  // picks and player profiles so no competing team/player evidence exists. The shape is produced by the
  // unchanged suggest/explain rules (never edited here). This tests codec shape coverage only. It says nothing
  // about current meta quality.
  const canonicalOf = id => ids.find(c => c.toLowerCase() === String(id).toLowerCase().replace(/[^a-z0-9]/g, ""));
  const distinct = new Set(report.entries.map(e => canonicalOf(e.champion_id)).filter(Boolean));
  // Before the first opponent pick at most 7 champions are used (6 bans + 1 pick), so 10 always leaves a legal meta id.
  assert.ok(distinct.size >= 10, `real report has enough distinct canonical entries (${distinct.size})`);
  const metaOnly = t => ({ ...t, priority_picks: [], player_profiles: [] });
  const metaReport = { ...report, entries: report.entries.map(e => ({ ...e, eligible_for_review: true })),
    opponent_prep: { ...report.opponent_prep, teams: teamsOf(report).map(metaOnly) } };
  for (const manualSide of ["BLUE", "RED"]) {
    const fx = playGame({ r: metaReport, manualSide });
    const picks = fx.history.filter(x => x.explanation?.kind === "PICK");
    assert.ok(picks.length, "opponent picks explained");
    assert.ok(picks.some(x => x.explanation.selected.source === "RADAR" && x.explanation.selected.evidence === "RADAR_META"), "generator produced the current-meta shape");
    const read = codec.parseSoloReview(serialize(fx).text, fx.session, SHA);
    assert.equal(read.ok, true, `parse ok (${read.reason})`);
    assert.deepEqual(read.records, fx.history);
    assertDeepFrozen(read.records);
  }
});

test("real fallback shapes, partial boards, Fearless second game and null explanation", () => {
  const bare = t => ({ ...t, priority_picks: [], player_profiles: [] });
  const fallbackReport = { ...report, entries: [], opponent_prep: { ...report.opponent_prep, teams: teamsOf(report).map(bare) } };
  const fb = playGame({ r: fallbackReport });
  const fbChoices = fb.history.flatMap(x => x.explanation ? [x.explanation.selected, ...x.explanation.alternatives] : []);
  assert.ok(fbChoices.length && fbChoices.every(c => c.source === "FALLBACK" && c.evidence === "FALLBACK"));
  assert.ok(fb.history.some(x => x.explanation?.kind === "PICK" && typeof x.explanation.selected.role_supported === "boolean"));
  assert.deepEqual(codec.parseSoloReview(serialize(fb).text, fb.session, SHA).records, fb.history);

  const partial = playGame({ steps: 7 });
  assert.ok(partial.history.length > 0 && partial.history.length < 10);
  assert.deepEqual(codec.parseSoloReview(serialize(partial).text, partial.session, SHA).records, partial.history);

  const game1 = playGame({ seasonHistory: season });
  const [blue, red] = teamsOf(report);
  const games = agent.completeFearlessGame([], { blue_team_id: blue.team_id, red_team_id: red.team_id, selections: game1.selections });
  assert.equal(games.length, 1);
  const game2 = playGame({ games, seasonHistory: season });
  assert.ok(agent.fearlessLocks(games).every(id => game2.context.includes(id)), "Fearless locks are part of the context");
  assert.deepEqual(codec.parseSoloReview(serialize(game2).text, game2.session, SHA).records, game2.history);

  const withNull = structuredClone(game1.history);
  withNull[0].explanation = null; withNull[3].explanation = null;
  const read = codec.parseSoloReview(serialize(game1, withNull).text, game1.session, SHA);
  assert.equal(read.ok, true);
  assert.equal(read.records[0].explanation, null);
  assert.deepEqual(read.records, withNull);
});

test("serialize: empty means no sidecar, SHA/side/records are strict, hostile values never throw", () => {
  const fx = playGame();
  const rec = structuredClone(fx.history[1]);
  assert.equal(reasonOf(serialize(fx, [])), "EMPTY");
  for (const sha of ["", SHA.toUpperCase(), SHA.slice(1), `${SHA}0`, ` ${SHA.slice(1)}`, 1, null]) assert.equal(reasonOf(serialize(fx, fx.history, sha)), "BAD_SHA");
  for (const side of ["blue", "PURPLE", null]) assert.equal(reasonOf(codec.serializeSoloReview(SHA, side, fx.history)), "BAD_SIDE");
  const thrower = { ...rec }; Object.defineProperty(thrower, "reason", { get() { throw new Error("boom"); }, enumerable: true });
  const sparse = [rec]; sparse.length = 2;
  const extraProp = [rec]; extraProp.extra = 1;
  const hostile = [
    null, "records", {}, sparse, extraProp, [thrower], [Object.assign(Object.create({ x: 1 }), rec)], [{ ...rec, constructor: {} }],
    [{ ...rec, [Symbol("s")]: 1 }], [{ ...rec, extra: 1 }], [new Proxy(rec, { getOwnPropertyDescriptor() { throw new Error("trap"); } })],
    new Proxy([], { getPrototypeOf() { throw new Error("trap"); } }), Array.from({ length: 21 }, () => rec),
    [fx.history[2], fx.history[1]], [fx.history[1], fx.history[1]], [fx.history[1], { ...structuredClone(fx.history[2]), context: `${fx.context}x` }],
  ];
  for (const records of hostile) assert.equal(reasonOf(codec.serializeSoloReview(SHA, "RED", records)), "BAD_RECORDS");
});

test("bounds: 20 records, exact 64 KiB, UTF-8 byte size (not string length)", () => {
  const fx = playGame();
  const twenty = allTurns(fx);
  const doc = docOf(fx, twenty);
  assert.equal(doc.records.length, codec.MAX_SOLO_REVIEW_RECORDS);
  // Structurally storable, but manual-side turns are never auto records on the restored board.
  assert.equal(reasonOf(parseDoc(fx, doc)), "BOARD_MISMATCH");
  doc.records.push(doc.records[0]);
  assert.equal(reasonOf(parseDoc(fx, doc)), "BAD_RECORDS");
  assert.equal(reasonOf(codec.serializeSoloReview(SHA, "RED", [...twenty, twenty[0]])), "BAD_RECORDS");
  assert.equal(reasonOf(serialize(fx, allTurns(fx, "가".repeat(1200)))), "TOO_LARGE");

  const text = serialize(fx).text;
  const bytes = Buffer.byteLength(text);
  assert.ok(bytes > text.length, "real Korean reasons are multibyte");
  const exact = text + " ".repeat(codec.MAX_SOLO_REVIEW_BYTES - bytes);
  assert.equal(Buffer.byteLength(exact), codec.MAX_SOLO_REVIEW_BYTES);
  assert.equal(codec.parseSoloReview(exact, fx.session, SHA).ok, true);
  const over = `${exact} `;
  assert.ok(over.length <= codec.MAX_SOLO_REVIEW_BYTES, "under the limit in UTF-16 units");
  assert.equal(reasonOf(codec.parseSoloReview(over, fx.session, SHA)), "TOO_LARGE");
  assert.equal(reasonOf(codec.parseSoloReview(" ".repeat(codec.MAX_SOLO_REVIEW_BYTES + 1), fx.session, SHA)), "TOO_LARGE");
});

test("envelope: text type, JSON, exact keys including __proto__/constructor, schema/version/side/SHA", () => {
  const fx = playGame();
  const text = serialize(fx).text;
  const doc = () => JSON.parse(text);
  for (const value of [null, 1, {}, ["x"], undefined]) assert.equal(reasonOf(codec.parseSoloReview(value, fx.session, SHA)), "NOT_TEXT");
  for (const bad of ["", "{", "null"]) assert.ok(["INVALID_JSON", "BAD_FORMAT"].includes(reasonOf(codec.parseSoloReview(bad, fx.session, SHA))));
  assert.equal(reasonOf(codec.parseSoloReview("[]", fx.session, SHA)), "BAD_FORMAT");
  const changes = [
    d => { d.extra = 1; }, d => { delete d.records; }, d => { d.schema = "solo-review"; }, d => { d.version = "1"; }, d => { d.version = 2; },
    d => { d.manual_side = "red"; }, d => { d.scenario_sha256 = SHA.toUpperCase(); }, d => { d.scenario_sha256 = SHA.slice(1); },
  ];
  for (const change of changes) { const d = doc(); change(d); assert.equal(reasonOf(parseDoc(fx, d)), "BAD_FORMAT"); }
  assert.equal(reasonOf(parseDoc(fx, text.replace('{"schema"', '{"__proto__":{},"schema"'))), "BAD_FORMAT");
  assert.equal(reasonOf(parseDoc(fx, text.replace('{"schema"', '{"constructor":{},"schema"'))), "BAD_FORMAT");
  for (const records of [[], null, {}, "x"]) { const d = doc(); d.records = records; assert.equal(reasonOf(parseDoc(fx, d)), "BAD_RECORDS"); }
  // Full SHA matching only: the supplied board SHA must equal the stored one exactly.
  assert.equal(reasonOf(parseDoc(fx, text, fx.session, OTHER_SHA)), "SHA_MISMATCH");
  assert.equal(reasonOf(parseDoc(fx, text, fx.session, `${SHA.slice(0, 63)}0`)), "SHA_MISMATCH");
  for (const sha of [SHA.toUpperCase(), SHA.slice(1), null]) assert.equal(reasonOf(parseDoc(fx, text, fx.session, sha)), "BAD_SHA");
});

test("records/explanations: exact keys, enums, champion ids, roles, booleans, generator consistency", () => {
  const fx = playGame({ seasonHistory: season });
  const ban = fx.history.find(x => x.explanation?.kind === "BAN" && x.turn > 1);
  const pick = fx.history.find(x => x.explanation?.kind === "PICK");
  assert.ok(ban && pick);
  const unknownId = "NotARealChampion";
  const lower = ban.champion_id.toLowerCase();
  const rejects = [
    [ban, r => { r.extra = 1; }], [ban, r => { delete r.reason; }], [ban, r => { r.turn = 0; }], [ban, r => { r.turn = 1.5; }], [ban, r => { r.turn = String(r.turn); }],
    [ban, r => { r.turn = 21; }], [ban, r => { r.champion_id = unknownId; r.explanation.selected.champion_id = unknownId; }],
    [ban, r => { r.champion_id = lower; r.explanation.selected.champion_id = lower; }],
    [ban, r => { r.reason = ""; r.explanation.selected.reason = ""; }], [ban, r => { r.reason += "\u0000"; r.explanation.selected.reason = r.reason; }],
    [ban, r => { r.prefix.pop(); }], [ban, r => { r.prefix[0] = 7; }], [ban, r => { r.context = ""; }], [ban, r => { r.explanation = "x"; }],
    [ban, r => { r.explanation.extra = 1; }], [ban, r => { r.explanation.kind = "DRAFT"; }], [ban, r => { r.explanation.side = "GREEN"; }],
    [ban, r => { r.explanation.record_scope = "ACTING_TEAM"; }], [ban, r => { r.explanation.record_team = ""; }],
    [ban, r => { r.explanation.season_evidence = "true"; }], [ban, r => { r.explanation.turn += 1; }],
    [ban, r => { r.explanation.selected.reason = "다른 이유"; }], [ban, r => { r.explanation.selected.source = "ORACLE"; }],
    [ban, r => { r.explanation.selected.evidence = "MAGIC"; }], [ban, r => { r.explanation.selected.source = "FALLBACK"; r.explanation.selected.evidence = "TEAM_PRIORITY"; }],
    [ban, r => { r.explanation.selected.source = "TEAM_RECORD"; r.explanation.selected.evidence = "PLAYER_CURRENT"; }],
    [ban, r => { r.explanation.selected.source = "PLAYER_SEASON"; r.explanation.selected.evidence = "PLAYER_SEASON"; r.explanation.season_evidence = true; }],
    [ban, r => { r.explanation.selected.inferred_roles = ["MID"]; }], [ban, r => { r.explanation.selected.role_supported = true; }],
    [ban, r => { r.explanation.alternatives = "x"; }], [ban, r => { r.explanation.alternatives = [...r.explanation.alternatives, r.explanation.selected, r.explanation.selected].slice(0, 3); }],
    [ban, r => { r.explanation.alternatives = [{ ...r.explanation.selected }]; }],
    [ban, r => { r.explanation.alternatives = [{ ...r.explanation.selected, champion_id: unknownId }]; }],
    [pick, r => { delete r.explanation.selected.role_supported; }], [pick, r => { r.explanation.selected.role_supported = "yes"; }],
    [pick, r => { r.explanation.selected.inferred_roles = ["ADC"]; }], [pick, r => { r.explanation.selected.inferred_roles = ["MID", "MID"]; }],
    [pick, r => { r.explanation.selected.inferred_roles = "MID"; }], [pick, r => { r.explanation.record_scope = "OPPOSING_TEAM"; }],
    [pick, r => { r.explanation.selected.source = "PLAYER_SEASON"; r.explanation.selected.evidence = "PLAYER_SEASON"; r.explanation.season_evidence = false; }],
    [pick, r => { r.explanation.selected.source = "RADAR"; r.explanation.selected.evidence = "TEAM_PRIORITY"; }],
  ];
  for (const [record, change] of rejects) assert.equal(mutateOne(fx, record, change), "BAD_RECORDS", change.toString());
  // Real-shaped variants the generator can produce stay accepted.
  const accepts = [
    [pick, r => { r.explanation.selected.source = "PLAYER_SEASON"; r.explanation.selected.evidence = "PLAYER_SEASON"; r.explanation.season_evidence = true; }],
    [pick, r => { r.explanation.selected.inferred_roles = []; r.explanation.selected.role_supported = false; }],
    [pick, r => { r.explanation.alternatives = []; }], [ban, r => { r.explanation.selected.source = "RADAR"; r.explanation.selected.evidence = "RADAR_FRAME"; }],
    [ban, r => { r.explanation = null; }],
  ];
  for (const [record, change] of accepts) assert.equal(mutateOne(fx, record, change), "OK", change.toString());
  // Raw-text prototype keys at record and choice level.
  const text = serialize(fx, [ban]).text;
  for (const key of ["__proto__", "constructor"]) {
    assert.equal(reasonOf(parseDoc(fx, text.replace('{"turn":', `{"${key}":{},"turn":`))), "BAD_RECORDS");
    assert.equal(reasonOf(parseDoc(fx, text.replace('{"champion_id":', `{"${key}":{},"champion_id":`))), "BAD_RECORDS");
  }
});

test("restored board context: every field, saved manual side and report basis must match", () => {
  const fx = playGame({ seasonHistory: season });
  const text = serialize(fx).text;
  const s = fx.session;
  const ei = s.report.evidence_index;
  const variants = [
    { ...s, firstPickSide: other(s.firstPickSide) }, { ...s, blueTeamId: s.redTeamId, redTeamId: s.blueTeamId },
    { ...s, games: agent.completeFearlessGame([], { blue_team_id: s.blueTeamId, red_team_id: s.redTeamId, selections: s.selections }) },
    { ...s, report: { ...s.report, patch_id: `${s.report.patch_id}x` } }, { ...s, report: { ...s.report, cutoff: "2000-01-01T00:00:00Z" } },
    { ...s, report: { ...s.report, fixture_only: !s.report.fixture_only } },
    { ...s, report: { ...s.report, evidence_index: { ...ei, source_versions: [...ei.source_versions, { source_id: "x", source_version: "1", content_hash: "h" }] } } },
  ];
  for (const session of variants) assert.equal(reasonOf(codec.parseSoloReview(text, session, SHA)), "CONTEXT_MISMATCH");
  const flipped = JSON.parse(text); flipped.manual_side = other(flipped.manual_side);
  assert.equal(reasonOf(parseDoc(fx, flipped)), "CONTEXT_MISMATCH");
  const altered = JSON.parse(text); for (const r of altered.records) r.context = hist.soloHistoryContext(JSON.parse(r.context)[0], "[]");
  assert.equal(reasonOf(parseDoc(fx, altered)), "CONTEXT_MISMATCH");
  for (const session of [{ ...s, blueTeamId: "missing-team" }, { ...s, redTeamId: s.blueTeamId }, null, { ...s, report: { ...s.report, opponent_prep: undefined } }])
    assert.equal(reasonOf(codec.parseSoloReview(text, session, SHA)), "BAD_SESSION");
  const throwing = { ...s }; Object.defineProperty(throwing, "selections", { get() { throw new Error("boom"); } });
  assert.equal(reasonOf(codec.parseSoloReview(text, throwing, SHA)), "BAD_RECORDS", "never throws");
});

test("board/prefix/selected/turn/kind/side/team mismatches and order are rejected", () => {
  const fx = playGame({ seasonHistory: season });
  const text = serialize(fx).text;
  const short = sessions.parseDraftSession(agent.serializeDraftScenario(fx.r, ...teamsOf(fx.r).slice(0, 2), fx.selections.slice(0, 5), [], null, fx.firstPickSide));
  assert.equal(reasonOf(codec.parseSoloReview(text, short.session, SHA)), "BOARD_MISMATCH");
  const ban = fx.history.find(x => x.explanation?.kind === "BAN" && x.turn > 1);
  const later = fx.history.find(x => x.turn > ban.turn && x.champion_id !== ban.champion_id);
  const freeId = ids.find(id => !fx.selections.some(s => s.champion_id === id));
  assert.equal(mutateOne(fx, ban, r => { r.prefix[0] = freeId; }), "BOARD_MISMATCH", "prefix");
  assert.equal(mutateOne(fx, ban, r => { r.champion_id = freeId; r.explanation.selected.champion_id = freeId; r.explanation.alternatives = r.explanation.alternatives.filter(a => a.champion_id !== freeId); }), "BOARD_MISMATCH", "selected");
  assert.equal(mutateOne(fx, ban, r => { r.turn = later.turn; r.explanation.turn = later.turn; r.prefix = fx.selections.slice(0, later.turn - 1).map(x => x.champion_id); }), "BOARD_MISMATCH", "turn");
  const manualTurn = fx.selections.findIndex(x => x.side === fx.manualSide) + 1;
  const manual = { turn: manualTurn, champion_id: fx.selections[manualTurn - 1].champion_id, reason: "연습", prefix: fx.selections.slice(0, manualTurn - 1).map(x => x.champion_id), context: fx.context, explanation: null };
  assert.equal(reasonOf(parseDoc(fx, docOf(fx, [manual]))), "BOARD_MISMATCH", "manual-side turn");
  assert.equal(mutateOne(fx, ban, r => { const e = r.explanation; e.kind = "PICK"; e.record_scope = "ACTING_TEAM"; for (const c of [e.selected, ...e.alternatives]) c.role_supported = true; }), "EXPLANATION_MISMATCH", "kind");
  assert.equal(mutateOne(fx, ban, r => { r.explanation.side = other(r.explanation.side); }), "EXPLANATION_MISMATCH", "side");
  const [blue, red] = teamsOf(fx.r);
  assert.equal(mutateOne(fx, ban, r => { r.explanation.record_team = r.explanation.record_team === blue.team_name ? red.team_name : blue.team_name; }), "EXPLANATION_MISMATCH", "team");
  // Unsorted / duplicate / inconsistent entries (raw text, bypassing serialize).
  const d = JSON.parse(text);
  for (const records of [[...d.records].reverse(), [d.records[0], ...d.records], [d.records[1], d.records[1]]]) assert.equal(reasonOf(parseDoc(fx, { ...d, records })), "BAD_RECORDS");
  const inconsistent = structuredClone(d); inconsistent.records[3].prefix[inconsistent.records[0].turn - 1] = freeId;
  assert.equal(reasonOf(parseDoc(fx, inconsistent)), "BAD_RECORDS");
});

test("module stays a pure codec: no storage, hashing, network or rule reruns", async () => {
  const source = await readFile(new URL("../app/solo-review-retention.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /indexedDB|localStorage|sessionStorage|crypto|subtle|fetch\(|suggestSoloDraftTurn|explainSoloDraftTurn|writeLocalDraft|readLocalDraft/);
  assert.match(source, /import type \{ DraftSession \} from "\.\/draft-session"/);
});
