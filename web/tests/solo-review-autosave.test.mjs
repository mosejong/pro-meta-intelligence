import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { createServer } from "vite";

// Stage 3 adapter: board + local practice notes autosave/restore. Real feed, real auto rules, real codec;
// storage is injected (the stage-2 storage pair has its own tests). No browser, no timers in the adapter.
const webRoot = fileURLToPath(new URL("../", import.meta.url));
let vite, A, agent, ui, hist, suggest, explain, autosave, report, ids, basisOf;
before(async () => {
  vite = await createServer({ root: webRoot, configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  A = await vite.ssrLoadModule("/app/solo-review-autosave.ts");
  agent = await vite.ssrLoadModule("/app/draft-agent.ts");
  ui = await vite.ssrLoadModule("/app/solo-draft-explanation.tsx");
  hist = await vite.ssrLoadModule("/app/solo-draft-history.ts");
  autosave = await vite.ssrLoadModule("/app/draft-autosave.ts");
  ({ suggestSoloDraftTurn: suggest, explainSoloDraftTurn: explain } = await vite.ssrLoadModule("/app/solo-draft.ts"));
  const { rosterBasis, basisKey } = await vite.ssrLoadModule("/app/roster-scenario.ts");
  basisOf = r => basisKey(rosterBasis(r));
  const { SHARE_CHAMPIONS } = await vite.ssrLoadModule("/app/share-champion-ids.ts");
  ids = SHARE_CHAMPIONS.map(([, id]) => id);
  report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
});
after(async () => { await vite?.close(); });

const sha = text => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }

/** Real board (draft-lab record shape, real append/prune), its exact scenario text and an autosave request. */
function board({ manualSide = "RED", firstPickSide = "BLUE", steps = 12 } = {}) {
  const [blueTeam, redTeam] = report.opponent_prep.teams;
  const context = hist.soloHistoryContext(ui.soloAutoContext(blueTeam.team_id, redTeam.team_id, firstPickSide, manualSide, []), basisOf(report));
  let selections = [], history = [];
  for (let step = 0; step < steps; step++) {
    const state = { report, blueTeam, redTeam, selections, previousPicks: [], firstPickSide, manualSide, seasonHistory: null };
    const chosen = suggest(state);
    let id;
    if (chosen) {
      const e = explain(state), turn = selections.length + 1;
      history = hist.appendSoloAutoHistory(history, { turn, champion_id: chosen.champion_id, reason: chosen.reason,
        prefix: selections.map(s => s.champion_id), context, explanation: e?.selected.champion_id === chosen.champion_id && e.turn === turn ? e : null });
      id = chosen.champion_id;
    } else id = ids.find(c => agent.applyDraftSelection(selections, c, [], firstPickSide) !== selections);
    selections = agent.applyDraftSelection(selections, id, [], firstPickSide);
    history = hist.pruneSoloAutoHistory(history, selections, context);
  }
  assert.ok(history.length > 0, "fixture has auto records");
  const scenario = agent.serializeDraftScenario(report, blueTeam, redTeam, selections, [], null, firstPickSide);
  return { scenario, manualSide, records: history };
}

/** Recording pair writer; each call can be settled by the test. */
function recorder({ manual = false } = {}) {
  const calls = [];
  const write = (scenario, review) => {
    const d = deferred();
    calls.push({ scenario, review, ...d });
    if (!manual) d.resolve();
    return d.promise;
  };
  return { calls, write };
}

test("WebCrypto digest is SHA-256 of the exact UTF-8 bytes", async () => {
  assert.equal(await A.webCryptoSha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const text = "가\u{1F600}\n\"x\"";
  assert.equal(await A.webCryptoSha256(text), sha(text));
});

test("digests finishing in reverse order cannot reorder writes; a failed write does not block the next", async () => {
  const first = board({ steps: 10 }), second = board({ steps: 12 });
  const digests = [];
  const { calls, write } = recorder({ manual: true });
  const save = A.createSoloReviewAutosave({ digest: text => { const d = deferred(); digests.push({ text, ...d }); return d.promise; }, write });
  const a = save(first), b = save(second);
  await flush();
  assert.deepEqual(digests.map(d => d.text), [first.scenario, second.scenario], "both digests start at once, on the exact board text");
  digests[1].resolve(sha(second.scenario));
  await flush();
  assert.equal(calls.length, 0, "the second request waits for the first even though its hash finished first");
  digests[0].resolve(sha(first.scenario));
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].scenario, first.scenario);
  assert.equal(JSON.parse(calls[0].review).scenario_sha256, sha(first.scenario));
  calls[0].reject(new Error("quota"));
  await assert.rejects(a, /quota/);
  await flush();
  assert.equal(calls.length, 2, "next request continues after a rejection");
  assert.equal(calls[1].scenario, second.scenario);
  assert.equal(JSON.parse(calls[1].review).scenario_sha256, sha(second.scenario));
  calls[1].resolve();
  await b;
});

test("no records, missing crypto, hash failure, malformed hash or codec refusal: board-only write (deletes sidecar), never skipped", async () => {
  const fx = board();
  const cases = [
    [{ ...fx, records: [] }, async () => { throw new Error("digest must not run without notes"); }],
    [fx, async () => null],
    [fx, async () => { throw new Error("subtle failed"); }],
    [fx, () => { throw new Error("sync failure"); }],
    [fx, async () => "NOT-HEX"],
    // Codec refusal: a structurally invalid record (turn out of range).
    [{ ...fx, records: [{ ...structuredClone(fx.records[0]), turn: 0 }] }, async text => sha(text)],
    [{ ...fx, manualSide: "GREEN" }, async text => sha(text)],
  ];
  for (const [request, digest] of cases) {
    const { calls, write } = recorder();
    await A.createSoloReviewAutosave({ digest, write })(request);
    assert.deepEqual(calls.map(c => [c.scenario, c.review]), [[fx.scenario, null]]);
  }
  // Real default digest with WebCrypto absent (Node exposes `crypto` as a configurable global).
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  assert.ok(descriptor?.configurable, "test can hide WebCrypto");
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true, writable: true });
  try {
    assert.equal(await A.webCryptoSha256("x"), null, "no WebCrypto: null, not a throw");
    const { calls, write } = recorder();
    await A.createSoloReviewAutosave({ write })(fx);
    assert.deepEqual(calls.map(c => [c.scenario, c.review]), [[fx.scenario, null]]);
  } finally { Object.defineProperty(globalThis, "crypto", descriptor); }
});

test("save -> restore with real WebCrypto: saved RED side and frozen records come back unchanged", async () => {
  const fx = board({ manualSide: "RED" });
  const { calls, write } = recorder();
  await A.createSoloReviewAutosave({ write })(fx);
  const [{ scenario, review }] = calls;
  assert.ok(review, "sidecar written");
  const restored = await A.readLocalDraftForRestore({ read: async () => ({ scenario, review }) });
  assert.equal(restored.kind, "RESTORED");
  assert.equal(restored.notes.manualSide, "RED");
  assert.deepEqual(restored.notes.records, JSON.parse(JSON.stringify(fx.records)), "records equal the frozen originals");
  assert.ok(Object.isFrozen(restored.notes.records) && restored.notes.records.every(r => Object.isFrozen(r)));
  assert.deepEqual(restored.session.selections.map(s => s.champion_id), JSON.parse(scenario).selections.map(s => s.champion_id));
  const blue = board({ manualSide: "BLUE" });
  const out = recorder();
  await A.createSoloReviewAutosave({ write: out.write })(blue);
  assert.equal((await A.readLocalDraftForRestore({ read: async () => out.calls[0] })).notes.manualSide, "BLUE");
});

test("restore: missing/corrupt/mismatched notes or hash failure keep the board; only board problems fail", async () => {
  const fx = board();
  const { calls, write } = recorder();
  await A.createSoloReviewAutosave({ write })(fx);
  const { scenario, review } = calls[0];
  const other = board({ steps: 10 });
  const variants = [
    [{ scenario, review: null }, undefined],
    [{ scenario, review: "{not json" }, undefined],
    [{ scenario, review: review.replace(/"manual_side":"RED"/, "\"manual_side\":\"BLUE\"") }, undefined],
    [{ scenario: other.scenario, review }, undefined], // SHA mismatch: notes belong to another board
    [{ scenario, review }, async () => null],
    [{ scenario, review }, async () => { throw new Error("digest failed"); }],
  ];
  for (const [pair, digest] of variants) {
    const restored = await A.readLocalDraftForRestore({ read: async () => pair, ...(digest ? { digest } : {}) });
    assert.equal(restored.kind, "RESTORED", "board is restored");
    assert.equal(restored.notes, null, "notes dropped silently");
  }
  assert.deepEqual(await A.readLocalDraftForRestore({ read: async () => ({ scenario: null, review }) }), { kind: "EMPTY" });
  const invalid = await A.readLocalDraftForRestore({ read: async () => ({ scenario: "{}", review }) });
  assert.equal(invalid.kind, "INVALID");
  assert.equal(invalid.result.code, "UNSUPPORTED_FORMAT");
  await assert.rejects(A.readLocalDraftForRestore({ read: async () => { throw new Error("storage blocked"); } }), /storage blocked/);
  // Without a sidecar the digest never runs.
  let hashed = 0;
  await A.readLocalDraftForRestore({ read: async () => ({ scenario, review: null }), digest: async () => { hashed++; return null; } });
  assert.equal(hashed, 0);
});

test("restore result is pending until a late digest settles (the lab's active/generation guard covers it)", async () => {
  const fx = board();
  const { calls, write } = recorder();
  await A.createSoloReviewAutosave({ write })(fx);
  const late = deferred();
  let settled = false;
  const pending = A.readLocalDraftForRestore({ read: async () => calls[0], digest: () => late.promise }).then(r => { settled = true; return r; });
  await flush();
  assert.equal(settled, false, "no partial result is delivered before the hash");
  late.resolve(sha(fx.scenario));
  assert.equal((await pending).notes.manualSide, fx.manualSide);

  const lab = await readFile(new URL("../app/draft-lab.tsx", import.meta.url), "utf8");
  const startup = lab.slice(lab.indexOf("readLocalDraftForRestore().then"), lab.indexOf("}, [restoreSession]);"));
  assert.match(startup, /^readLocalDraftForRestore\(\)\.then\(\(saved\) => \{\s*if \(!active \|\| generation !== restoreGeneration\.current\) return;/, "stale read/hash never applies");
  assert.doesNotMatch(startup, /setSoloEnabled\(true\)|setLastAuto\(/, "restored notes keep automatic play off and no last choice");
  assert.match(lab, /const restoreSession = useCallback\(\(session: DraftSession\) => \{\s*restoreGeneration\.current \+= 1;/);
  assert.match(lab, /onSnapshot=\{\(session, reset\) => \{\s*restoreGeneration\.current \+= 1;/, "room snapshots invalidate a pending startup restore");
  assert.match(lab, /setAutoHistory\(\[\]\); setRestoredNotes\(\[\]\);/, "every restore path clears notes and provenance");
  assert.doesNotMatch(lab, /explainSoloDraftTurn\([^)]*saved/, "restored notes are never re-explained");
});

test("generic tracker/session with requests: latest-only retry, no auto retry, leave guard until saved", async () => {
  const fx = board();
  const { calls, write } = recorder({ manual: true });
  const tracker = autosave.createDraftSaveTracker(A.createSoloReviewAutosave({ digest: async text => sha(text), write }));
  const statuses = [];
  const session = autosave.createDraftSaveSession(tracker, code => statuses.push(code));
  const listeners = new Map();
  const release = autosave.guardDraftUnload({ addEventListener: (n, f) => listeners.set(n, f), removeEventListener: n => listeners.delete(n) }, tracker);
  const older = { ...fx, records: fx.records.slice(0, 1) };
  const latest = { ...fx };
  const removed = { ...fx, records: [] }; // identical board bytes, notes removed: still a new request
  assert.equal(session.submit(null), null, "not ready: nothing submitted");
  void session.submit(older).catch(() => {});
  const failed = session.submit(latest);
  await flush();
  calls[0].resolve(); await flush();
  calls[1].reject(new Error("quota"));
  await assert.rejects(failed, /quota/); await flush();
  assert.equal(statuses.at(-1), "SAVE_FAILED");
  assert.equal(tracker.hasUnsavedChanges(), true);
  assert.equal(calls.length, 2, "no automatic retry");
  const retried = session.retry();
  assert.ok(retried); await flush();
  assert.equal(calls[2].scenario, latest.scenario);
  assert.equal(JSON.parse(calls[2].review).records.length, latest.records.length, "retry writes the latest request, not the older one");
  calls[2].resolve(); await retried;
  assert.equal(tracker.hasUnsavedChanges(), false);
  const cleared = session.submit(removed); await flush();
  assert.deepEqual([calls[3].scenario, calls[3].review], [fx.scenario, null], "removing notes on the same board deletes the sidecar");
  release();
  assert.equal(listeners.has("beforeunload"), true, "guard kept while the delete is pending");
  calls[3].resolve(); await cleared;
  assert.equal(listeners.has("beforeunload"), false);
});

test("app files, links and rooms carry no notes: scenario serializer output is unchanged by notes", () => {
  const fx = board();
  const text = fx.scenario;
  assert.ok(!text.includes("solo-review-retention") && !text.includes("scenario_sha256") && !text.includes(fx.records[0].context));
});
